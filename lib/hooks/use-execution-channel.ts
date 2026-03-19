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
 * Subscribes to both Supabase Realtime broadcast AND postgres_changes for session updates.
 *
 * CRITICAL: This hook MUST be instantiated at a component level that is
 * NEVER unmounted while the session is active. Specifically, it must NOT
 * live inside ChatInterface, because ChatInterface can be unmounted when
 * the Copilot is minimized to a FAB (AnimatePresence popLayout swap).
 *
 * Recommended mount point: ChatClientPage.tsx (always in DOM for a session).
 *
 * STAGE 2: Now listens to postgres_changes on sessions table for authoritative state
 * It handles:
 *  - DB changes (primary source of truth for node states)
 *  - Broadcast events (low-latency updates, secondary)
 *  - node status updates (pending/running/success/error)
 *  - live node output delivery (thumbnailUrls → image objects)
 *  - text/non-image node output delivery
 *  - RETRY LOGIC: Exponential backoff on subscription failures
 */
export function useExecutionChannel(sessionId: string | null | undefined) {
    const executionChannelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null);
    const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);

    useEffect(() => {
        if (!sessionId) return;

        const supabase = createClient();
        supabaseRef.current = supabase;
        const store = useAppStore.getState();

        // Handler for postgres_changes (PRIMARY SOURCE OF TRUTH)
        const handleDatabaseChange = (payload: any) => {
            if (payload.eventType === 'UPDATE' && payload.new?.canvas_state) {
                const canvasState = payload.new.canvas_state;
                const nodes = canvasState?.nodes || [];

                // EXECUTION GUARD: Prevent stale 'idle' resets from clobbering live execution states
                // Check if ANY node in Zustand has a "live" status (pending/running)
                const hasLiveStatuses = Object.values(store.nodeStatuses).some(
                    (s: any) => s === 'pending' || s === 'running'
                );

                // Update all node states from the authoritative DB state
                // CRITICAL: Only update if status actually changed to prevent infinite loops
                nodes.forEach((node: any) => {
                    const status = node.data?.status;
                    const output = node.data?.output;
                    const outputMetadata = node.data?.outputMetadata;

                    // Only update status if it changed (prevents React Error #185 infinite loop)
                    if (status) {
                        const currentStatus = store.nodeStatuses[node.id];
                        
                        // EXECUTION GUARD: If we have live statuses and DB says 'idle',
                        // it's likely a stale reset from the API initialization before execution started.
                        // Only allow this transition if:
                        // 1. No live statuses exist (safe to reset), OR
                        // 2. Current status is also 'idle' (no-op), OR
                        // 3. DB status is NOT 'idle' (forward progress allowed)
                        const isStaleReset = hasLiveStatuses && 
                                           status === 'idle' && 
                                           currentStatus !== 'idle';
                        
                        if (!isStaleReset && status !== currentStatus) {
                            store.setNodeStatus(node.id, status);
                        } else if (isStaleReset) {
                            console.log(`[ExecutionChannel] Blocked stale 'idle' reset for node ${node.id} (current: ${currentStatus})`);
                        }
                    }

                    // Hydrate outputs from DB (only for successful nodes)
                    if (status === 'success') {
                        const currentOutput = store.nodeOutputs[node.id];
                        
                        if (outputMetadata?.thumbnailUrls && Array.isArray(outputMetadata.thumbnailUrls) && outputMetadata.thumbnailUrls.length > 0) {
                            const imageObjects = outputMetadata.thumbnailUrls.map((url: string, idx: number) => ({
                                url,
                                resolution: { width: 1024, height: 1024 },
                                metadata: { title: `Output ${idx + 1}`, source: 'Database' },
                            }));
                            
                            // Only update output if changed
                            const outputChanged = !currentOutput || 
                                JSON.stringify(currentOutput) !== JSON.stringify(imageObjects);
                            if (outputChanged) {
                                store.setNodeOutput(node.id, imageObjects);
                            }
                        } else if (output !== undefined) {
                            const outputChanged = !currentOutput || 
                                JSON.stringify(currentOutput) !== JSON.stringify(output);
                            if (outputChanged) {
                                store.setNodeOutput(node.id, output);
                            }
                        }
                    }
                });
            }
        };

        // Handler for broadcast (SECONDARY, LOW-LATENCY)
        const handleExecutionBroadcast = (payload: any) => {
            const { nodeId, status, output, outputMetadata, executionId } = payload.payload ?? {};
            const activeExecutionId = store.activeExecutionId;

            if (!nodeId || !status) {
                console.warn('[ExecutionChannel] Received malformed broadcast payload', payload);
                return;
            }

            // Ignore stale runs if we have an active execution token
            if (activeExecutionId && executionId && executionId !== activeExecutionId) {
                return;
            }

            store.setNodeStatus(nodeId, status);

            if (status === 'success') {
                if (outputMetadata?.thumbnailUrls && Array.isArray(outputMetadata.thumbnailUrls) && outputMetadata.thumbnailUrls.length > 0) {
                    // Preferred: use persisted Supabase Storage URLs (avoids large base64 blobs in WS)
                    const imageObjects = outputMetadata.thumbnailUrls.map((url: string, idx: number) => ({
                        url,
                        resolution: { width: 1024, height: 1024 },
                        metadata: { title: `Output ${idx + 1}`, source: 'Live' },
                    }));
                    store.setNodeOutput(nodeId, imageObjects);
                } else if (output !== undefined) {
                    // Fallback: text/non-image node inline output
                    store.setNodeOutput(nodeId, output);
                }
            }
        };

        // STAGE 2: Subscribe to both postgres_changes AND broadcast with retry logic
        const channel = supabase
            .channel(`execution_${sessionId}`)
            // PRIMARY: Database changes (authoritative state)
            .on(
                'postgres_changes',
                {
                    event: 'UPDATE',
                    schema: 'public',
                    table: 'sessions',
                    filter: `id=eq.${sessionId}`
                },
                handleDatabaseChange
            )
            // SECONDARY: Broadcast events (low-latency)
            .on('broadcast', { event: 'node_execution' }, handleExecutionBroadcast);

        executionChannelRef.current = channel;

        // Subscribe with retry logic (prevents permanent subscription failures)
        subscribeWithRetry(channel, 3, 1000).catch((err) => {
            console.error('[ExecutionChannel] Failed to subscribe after all retries:', err);
        });

        // Reconnect when tab becomes visible again (with retry logic)
        const handleVisibilityChange = async () => {
            if (document.visibilityState !== 'visible') return;
            const channelState = (executionChannelRef.current as any)?.state;
            if (channelState === 'closed' || channelState === 'errored') {
                console.log('[ExecutionChannel] Reconnecting due to visibility change...');
                if (executionChannelRef.current) supabase.removeChannel(executionChannelRef.current);
                
                const reconnected = supabase
                    .channel(`execution_${sessionId}`)
                    .on(
                        'postgres_changes',
                        {
                            event: 'UPDATE',
                            schema: 'public',
                            table: 'sessions',
                            filter: `id=eq.${sessionId}`
                        },
                        handleDatabaseChange
                    )
                    .on('broadcast', { event: 'node_execution' }, handleExecutionBroadcast);
                    
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
    }, [sessionId]);
}
