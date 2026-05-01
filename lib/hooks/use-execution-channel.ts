'use client';

import { useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAppStore } from '@/lib/store/app-store';
import { coerceResultDataArray, inferResultTypeFromValue, normalizeNodeResultType, toOutputEnvelope } from '@/lib/workflow/result-format';

/**
 * Apply a node_results record directly to the Zustand store.
 * Used both by the realtime handler and the hydration catch-up query.
 */
function applyNodeResult(record: any, sessionId: string) {
    const store = useAppStore.getState();
    const {
        node_id: nodeId,
        status,
        result_type: resultType,
        result_data: resultData,
        error,
        session_id: recordSessionId
    } = record;

    // Client-side session guard — only process rows belonging to this session.
    // We removed the server-side filter to avoid RLS blocking service-role UPDATE events.
    if (recordSessionId && recordSessionId !== sessionId) return;
    if (!nodeId || !status) return;

    // Don't allow a 'pending' DB event to downgrade a node that's already
    // 'running' or 'success' in the UI. This prevents the flash caused by
    // the server inserting non-root nodes as 'pending' after the client has
    // already optimistically set them to 'running' from the user's click.
    if (status === 'pending') {
        const currentStatus = useAppStore.getState().nodeStatuses[nodeId];
        if (currentStatus === 'running' || currentStatus === 'success') return;
    }

    // Map DB statuses to UI statuses
    if (status === 'completed') {
        store.setNodeStatus(nodeId, 'success');
        const finalType = resultType
            ? normalizeNodeResultType(resultType)
            : inferResultTypeFromValue(resultData);
        const finalData = coerceResultDataArray(resultData ?? []);

        if (finalData.length > 0) {
            store.setNodeOutput(nodeId, toOutputEnvelope(finalType, finalData));
        }
    } else if (status === 'failed') {
        store.setNodeStatus(nodeId, 'error');
        store.setNodeOutput(nodeId, null);
        console.error(`[ExecutionChannel] Node ${nodeId} failed:`, error);
    } else {
        // 'pending' and 'running' pass through directly
        store.setNodeStatus(nodeId, status);
    }
}

/**
 * After the subscription is confirmed SUBSCRIBED, query the DB for the latest
 * node_results rows for this session and apply them to the store.
 *
 * WHY: There is a window between component mount and subscription confirmation
 * (~200-500ms). Any DB writes during that window are missed by the realtime
 * listener. This catch-up query ensures the UI always reflects the true DB state
 * regardless of subscription timing or page refreshes.
 */
async function hydrateFromDb(supabase: ReturnType<typeof createClient>, sessionId: string) {
    console.log(`[ExecutionChannel] Hydrating current state from DB for session ${sessionId}`);
    
    const { data: rows, error } = await supabase
        .from('node_results')
        .select('node_id, status, result_type, result_data, error, session_id, updated_at')
        .eq('session_id', sessionId)
        .order('updated_at', { ascending: false });

    if (error) {
        console.warn('[ExecutionChannel] Hydration query failed:', error.message);
        return;
    }

    if (!rows || rows.length === 0) return;

    // De-duplicate: keep only the most recent row per node_id (already ordered by updated_at desc)
    const seenNodes = new Set<string>();
    for (const row of rows) {
        if (seenNodes.has(row.node_id)) continue;
        seenNodes.add(row.node_id);
        applyNodeResult(row, sessionId);
    }

    console.log(`[ExecutionChannel] Hydrated ${seenNodes.size} node(s) from DB`);
}

/**
 * Subscribe to a channel with exponential backoff retry.
 * Resolves when SUBSCRIBED, rejects after all retries exhausted.
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
                        reject(err);
                    } else if (status === 'SUBSCRIBED') {
                        console.log(`[ExecutionChannel] Subscribed (attempt ${attempt + 1})`);
                        resolve();
                    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                        reject(new Error(`Subscription failed: ${status}`));
                    }
                });
            });
            return;
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
 * Subscribes to Supabase Realtime for execution updates on node_results.
 * Mounted at the top-level layout (ChatClientPage) so it is NEVER unmounted
 * while the session is active.
 *
 * Key design decisions:
 * - NO server-side filter: prevents RLS from silently dropping service-role
 *   UPDATE events (e.g. from the Replicate webhook). Filters client-side instead.
 * - On-subscribe hydration: queries current DB state immediately after the
 *   WebSocket connection is confirmed, closing the missed-event window.
 */
export function useExecutionChannel(sessionId: string | null | undefined) {
    const executionChannelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null);
    const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
    const visibilityHandlerRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        if (!sessionId) {
            console.log('[ExecutionChannel] No sessionId, skipping');
            return;
        }

        const supabase = createClient();
        supabaseRef.current = supabase;

        const handleResultChange = (payload: any) => {
            const record = payload.new;
            if (!record) return;
            console.log(`[ExecutionChannel] ${payload.eventType} → node ${record.node_id}: ${record.status}`);
            applyNodeResult(record, sessionId);
        };

        const buildChannel = () =>
            supabase
                .channel(`session_results_${sessionId}`)
                .on(
                    'postgres_changes',
                    {
                        event: '*',
                        schema: 'public',
                        table: 'node_results',
                        // No server-side filter — see hydrateFromDb and applyNodeResult
                    },
                    handleResultChange
                );

        const channel = buildChannel();
        executionChannelRef.current = channel;

        // Subscribe, then immediately hydrate from DB to catch any missed events
        subscribeWithRetry(channel, 3, 1000)
            .then(() => hydrateFromDb(supabase, sessionId))
            .catch((err) => {
                console.error('[ExecutionChannel] Failed to subscribe:', err);
            });

        // Reconnect + re-hydrate when the tab becomes visible again
        const handleVisibilityChange = async () => {
            if (document.visibilityState !== 'visible') return;
            const channelState = (executionChannelRef.current as any)?.state;
            if (channelState === 'closed' || channelState === 'errored') {
                console.log('[ExecutionChannel] Reconnecting after visibility change...');
                if (executionChannelRef.current) supabase.removeChannel(executionChannelRef.current);
                const reconnected = buildChannel();
                executionChannelRef.current = reconnected;
                subscribeWithRetry(reconnected, 3, 1000)
                    .then(() => hydrateFromDb(supabase, sessionId))
                    .catch((err) => {
                        console.error('[ExecutionChannel] Reconnection failed:', err);
                    });
            }
        };

        visibilityHandlerRef.current = handleVisibilityChange;
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            if (executionChannelRef.current && supabaseRef.current) {
                try {
                    executionChannelRef.current.unsubscribe();
                    supabaseRef.current.removeChannel(executionChannelRef.current);
                } catch (e) {
                    console.log('[ExecutionChannel] Cleanup error:', e);
                }
                executionChannelRef.current = null;
            }
        };
    }, [sessionId]);
}
