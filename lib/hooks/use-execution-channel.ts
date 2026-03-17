'use client';

import { useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAppStore } from '@/lib/store/app-store';

/**
 * Subscribes to the Supabase Realtime execution broadcast channel.
 *
 * CRITICAL: This hook MUST be instantiated at a component level that is
 * NEVER unmounted while the session is active. Specifically, it must NOT
 * live inside ChatInterface, because ChatInterface can be unmounted when
 * the Copilot is minimized to a FAB (AnimatePresence popLayout swap).
 *
 * Recommended mount point: ChatClientPage.tsx (always in DOM for a session).
 *
 * It handles:
 *  - node status updates (pending/running/success/error)
 *  - live node output delivery (thumbnailUrls → image objects)
 *  - text/non-image node output delivery
 */
export function useExecutionChannel(sessionId: string | null | undefined) {
    const executionChannelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null);
    const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);

    useEffect(() => {
        if (!sessionId) return;

        const supabase = createClient();
        supabaseRef.current = supabase;

        const handleExecutionBroadcast = (payload: any) => {
            const store = useAppStore.getState();
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

        const channel = supabase
            .channel(`execution_${sessionId}`)
            .on('broadcast', { event: 'node_execution' }, handleExecutionBroadcast)
            .subscribe((status: string, err?: any) => {
                if (err) {
                    console.error('[ExecutionChannel] Subscription error:', err);
                } else {
                }
            });

        executionChannelRef.current = channel;

        // Reconnect when tab becomes visible again
        const handleVisibilityChange = async () => {
            if (document.visibilityState !== 'visible') return;
            const channelState = (executionChannelRef.current as any)?.state;
            if (channelState === 'closed' || channelState === 'errored') {
                if (executionChannelRef.current) supabase.removeChannel(executionChannelRef.current);
                const reconnected = supabase
                    .channel(`execution_${sessionId}`)
                    .on('broadcast', { event: 'node_execution' }, handleExecutionBroadcast)
                    .subscribe();
                executionChannelRef.current = reconnected;
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
