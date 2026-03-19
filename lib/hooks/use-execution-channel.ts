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

        // ✅ PHASE 3 FIX: Handler for node_executions changes (PRIMARY SOURCE OF TRUTH)
        const handleExecutionChange = (payload: any) => {
            const eventType = payload.eventType; // INSERT, UPDATE, DELETE
            const record = payload.new || payload.old;

            if (!record) return;

            const { node_id: nodeId, status, output, error, output_metadata: outputMetadata } = record;

            if (!nodeId) return;

            console.log(`[ExecutionChannel] node_executions ${eventType}: ${nodeId} → ${status}`);

            // Update status in Zustand
            if (status) {
                store.setNodeStatus(nodeId, status);
            }

            // Update output if present
            if (status === 'success') {
                // Priority 1: Check the new output_metadata column for storage URLs (thumbnails/previews)
                if (outputMetadata?.preview_urls && Array.isArray(outputMetadata.preview_urls) && outputMetadata.preview_urls.length > 0) {
                    const imageObjects = outputMetadata.preview_urls.map((url: string, idx: number) => ({
                        url,
                        resolution: { width: 1024, height: 1024 },
                        metadata: { title: `Output ${idx + 1}`, source: 'Database' },
                    }));
                    store.setNodeOutput(nodeId, imageObjects);
                } 
                // Priority 2: Check legacy _metadata inside output
                else if (output?._metadata?.preview_urls && Array.isArray(output._metadata.preview_urls) && output._metadata.preview_urls.length > 0) {
                    const metadata = output._metadata;
                    const imageObjects = metadata.preview_urls.map((url: string, idx: number) => ({
                        url,
                        resolution: { width: 1024, height: 1024 },
                        metadata: { title: `Output ${idx + 1}`, source: 'Database' },
                    }));
                    store.setNodeOutput(nodeId, imageObjects);
                }
                // Priority 3: Fallback to raw output (text, JSON, etc.)
                else if (output !== undefined) {
                    store.setNodeOutput(nodeId, output);
                }
            }

            // Clear output on error
            if (status === 'error' && error) {
                console.error(`[ExecutionChannel] Node ${nodeId} error:`, error);
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
            // ✅ PHASE 3 FIX: Listen to node_executions table (authoritative state)
            .on(
                'postgres_changes',
                {
                    event: '*', // Listen to INSERT, UPDATE, DELETE
                    schema: 'public',
                    table: 'node_executions',
                    filter: `session_id=eq.${sessionId}`
                },
                handleExecutionChange
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
                            event: '*',
                            schema: 'public',
                            table: 'node_executions',
                            filter: `session_id=eq.${sessionId}`
                        },
                        handleExecutionChange
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
