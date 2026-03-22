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
 * Subscribes to Supabase Realtime for execution updates on node_results table.
 *
 * CRITICAL: This hook MUST be instantiated at a component level that is
 * NEVER unmounted while the session is active.
 *
 * V3 Changes:
 *  - Listens to node_results table instead of executions_v2
 *  - Each row corresponds to a single node's state change
 */
export function useExecutionChannel(executionId: string | null | undefined) {
    const executionChannelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null);
    const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);

    useEffect(() => {
        if (!executionId) return;

        const supabase = createClient();
        supabaseRef.current = supabase;
        const store = useAppStore.getState();

        // V3: Handler for node_results changes
        const handleResultChange = (payload: any) => {
            console.log(`[ExecutionChannel] Received payload:`, payload.eventType, payload);
            
            const record = payload.new;
            if (!record) return;

            const { node_id: nodeId, status, result_url: resultUrl, error } = record;

            console.log(`[ExecutionChannel] node_results ${payload.eventType} for ${nodeId}: status=${status}`);

            // Update status in Zustand - use the exact status from the database
            if (status) {
                // Map database statuses to UI statuses
                if (status === 'completed') {
                    store.setNodeStatus(nodeId, 'success');
                } else if (status === 'failed') {
                    store.setNodeStatus(nodeId, 'error');
                } else {
                    // 'pending' and 'running' pass through directly
                    store.setNodeStatus(nodeId, status);
                }
            }

            // Update output if completed
            if (status === 'completed' && resultUrl) {
                const imageObject = {
                    url: resultUrl,
                    resolution: { width: 1024, height: 1024 },
                    metadata: { title: 'Output', source: 'V3 Execution' },
                };
                store.setNodeOutput(nodeId, [imageObject]);
            }

            // Clear output on error
            if (status === 'failed') {
                console.error(`[ExecutionChannel] Node ${nodeId} error:`, error);
                store.setNodeOutput(nodeId, null);
            }
        };

        // V3: Subscribe to node_results table changes for this execution
        const channel = supabase
            .channel(`results_${executionId}`)
            .on(
                'postgres_changes',
                {
                    event: '*', 
                    schema: 'public',
                    table: 'node_results',
                    filter: `execution_id=eq.${executionId}`
                },
                handleResultChange
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
                    .channel(`results_${executionId}`)
                    .on(
                        'postgres_changes',
                        {
                            event: '*',
                            schema: 'public',
                            table: 'node_results',
                            filter: `execution_id=eq.${executionId}`
                        },
                        handleResultChange
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
