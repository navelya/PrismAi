'use client';

import { useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAppStore } from '@/lib/store/app-store';

/**
 * Helper function to subscribe to channel with exponential backoff retry
 */
async function subscribeWithRetry(
    channel: ReturnType<ReturnType<typeof createClient>['channel']>,
    maxRetries: number = 3,
    initialDelay: number = 1000
): Promise<void> {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            await new Promise<void>((resolve, reject) => {
                channel.subscribe((status: string, err?: any) => {
                    if (err) {
                        console.error(`[ExecutionChannel] Subscription attempt ${attempt + 1} failed:`, err);
                        reject(err);
                    } else if (status === 'SUBSCRIBED') {
                        console.log(`[ExecutionChannel] Successfully subscribed on attempt ${attempt + 1}`);
                        resolve();
                    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                        reject(new Error(`Subscription failed with status: ${status}`));
                    }
                });
            });
            return; // Success - exit retry loop
        } catch (err) {
            if (attempt < maxRetries - 1) {
                const delay = initialDelay * Math.pow(2, attempt);
                console.warn(`[ExecutionChannel] Retrying in ${delay}ms...`);
                await new Promise(res => setTimeout(res, delay));
            } else {
                console.error('[ExecutionChannel] All retry attempts exhausted');
                throw err;
            }
        }
    }
}

/**
 * Subscribes to Supabase Realtime for execution updates on executions_v2 table.
 *
 * CRITICAL: This hook MUST be instantiated at a component level that is
 * NEVER unmounted while the session is active.
 *
 * V2 Changes:
 *  - Listens to executions_v2 table instead of node_executions
 *  - Parses node_states JSONB column for individual node statuses
 *  - Provides better real-time performance via event-driven architecture
 */
export function useExecutionChannel(executionId: string | null | undefined) {
    const executionChannelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null);
    const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);

    useEffect(() => {
        if (!executionId) return;

        const supabase = createClient();
        supabaseRef.current = supabase;
        const store = useAppStore.getState();

        // V2: Handler for executions_v2 changes
        const handleExecutionChange = (payload: any) => {
            const eventType = payload.eventType; // INSERT, UPDATE, DELETE
            const record = payload.new || payload.old;

            if (!record) return;

            const { node_states: nodeStates } = record;

            if (!nodeStates || typeof nodeStates !== 'object') return;

            console.log(`[ExecutionChannel] executions_v2 ${eventType}: ${Object.keys(nodeStates).length} nodes`);

            // Update each node from node_states JSONB
            Object.entries(nodeStates).forEach(([nodeId, state]: [string, any]) => {
                const { status, result_url, error, output } = state;

                // Update status in Zustand
                if (status) {
                    store.setNodeStatus(nodeId, status);
                }

                // Update output if completed
                if (status === 'completed' && result_url) {
                    // V2 stores result_url for images
                    const imageObject = {
                        url: result_url,
                        resolution: { width: 1024, height: 1024 },
                        metadata: { title: 'Output', source: 'V2 Execution' },
                    };
                    store.setNodeOutput(nodeId, [imageObject]);
                } else if (status === 'completed' && output !== undefined) {
                    // For non-image outputs (text, JSON, etc.)
                    store.setNodeOutput(nodeId, output);
                }

                // Clear output on error
                if (status === 'failed' && error) {
                    console.error(`[ExecutionChannel] Node ${nodeId} error:`, error);
                    store.setNodeStatus(nodeId, 'error');
                    store.setNodeOutput(nodeId, null);
                }
            });
        };

        // V2: Subscribe to executions_v2 table changes
        const channel = supabase
            .channel(`execution_${executionId}`)
            .on(
                'postgres_changes',
                {
                    event: '*', // Listen to INSERT, UPDATE, DELETE
                    schema: 'public',
                    table: 'executions_v2',
                    filter: `id=eq.${executionId}`
                },
                handleExecutionChange
            );

        executionChannelRef.current = channel;

        // Subscribe with retry logic
        subscribeWithRetry(channel, 3, 1000).catch((err) => {
            console.error('[ExecutionChannel] Failed to subscribe after all retries:', err);
        });

        // Reconnect when tab becomes visible again
        const handleVisibilityChange = async () => {
            if (document.visibilityState !== 'visible') return;
            const channelState = (executionChannelRef.current as any)?.state;
            if (channelState === 'closed' || channelState === 'errored') {
                console.log('[ExecutionChannel] Reconnecting due to visibility change...');
                if (executionChannelRef.current) supabase.removeChannel(executionChannelRef.current);
                
                const reconnected = supabase
                    .channel(`execution_${executionId}`)
                    .on(
                        'postgres_changes',
                        {
                            event: '*',
                            schema: 'public',
                            table: 'executions_v2',
                            filter: `id=eq.${executionId}`
                        },
                        handleExecutionChange
                    );
                    
                executionChannelRef.current = reconnected;
                
                // Retry reconnection
                subscribeWithRetry(reconnected, 3, 1000).catch((err) => {
                    console.error('[ExecutionChannel] Reconnection failed after all retries:', err);
                });
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            if (executionChannelRef.current) {
                supabase.removeChannel(executionChannelRef.current);
                executionChannelRef.current = null;
            }
        };
    }, [executionId]);
}
