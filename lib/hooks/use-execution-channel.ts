'use client';

import { useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAppStore } from '@/lib/store/app-store';
import { coerceResultDataArray, extractRenderableMedia, inferResultTypeFromValue, normalizeNodeResultType, toOutputEnvelope } from '@/lib/workflow/result-format';

/**
 * Apply a node_results record directly to the Zustand store.
 * Used both by the realtime handler and the hydration catch-up query.
 */
function applyNodeResult(record: any, sessionId: string, source: 'realtime' | 'hydrate' = 'realtime') {
    const store = useAppStore.getState();
    const {
        node_id: nodeId,
        status,
        result_type: resultType,
        result_data: resultData,
        error,
        session_id: recordSessionId,
        execution_id: executionId
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
        store.setNodeError(nodeId, null);
        const finalType = resultType
            ? normalizeNodeResultType(resultType)
            : inferResultTypeFromValue(resultData);
        const finalData = coerceResultDataArray(resultData ?? []);

        if (finalData.length > 0) {
            store.setNodeOutput(nodeId, toOutputEnvelope(finalType, finalData), executionId);

            // Accumulate into the node's persisted collection — ONLY for live
            // results. Hydration runs applyNodeResult AFTER the saved workflow
            // (with its config.outputs) is already loaded into the store, so
            // appending on 'hydrate' would re-append on top of what's already
            // there. appendAiGeneratorRun is a no-op for non-ai_generator nodes
            // and is idempotent per execution_id.
            if (source === 'realtime') {
                store.appendAiGeneratorRun(nodeId, finalType, finalData, executionId);
            }
        }
        store.clearPartialIterationResults(nodeId);
    } else if (status === 'failed') {
        store.setNodeStatus(nodeId, 'error');
        store.setNodeOutput(nodeId, null);
        // Surface the server's failure message (usually the Replicate prediction
        // error) on the node's error badge. `error` may be a string or, for some
        // failures, a structured value — normalize to a readable string.
        store.setNodeError(
            nodeId,
            typeof error === 'string'
                ? error
                : error
                    ? (() => { try { return JSON.stringify(error); } catch { return String(error); } })()
                    : 'Generation failed',
        );
        if (source === 'realtime') {
            console.error(`[ExecutionChannel] Node ${nodeId} failed:`, error);
        }
        store.clearPartialIterationResults(nodeId);
    } else {
        // 'pending' and 'running' pass through directly. Clear any stale error
        // from a prior failed run so a re-run doesn't show an outdated tooltip.
        store.setNodeStatus(nodeId, status);
        store.setNodeError(nodeId, null);
    }
}

function applyPredictionResult(record: any) {
    const store = useAppStore.getState();
    const { node_id: nodeId, execution_id: executionId, prediction_index: index, status, result_data: resultData } = record;
    if (!nodeId || !executionId || typeof index !== 'number') return;

    if (status === 'completed') {
        const type = inferResultTypeFromValue(resultData);
        const media = extractRenderableMedia(toOutputEnvelope(type, coerceResultDataArray(resultData ?? [])))
            .filter((m) => m.type === 'image' || m.type === 'video');
        store.addPartialIterationResult(nodeId, executionId, { index, status: 'completed', media });
    } else if (status === 'failed') {
        store.addPartialIterationResult(nodeId, executionId, { index, status: 'failed', media: [] });
    }
    // 'pending' rows carry no result yet — ignore.
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
    
    // Bounded fetch: a long-lived session accumulates hundreds of rows across
    // many executions. We only need the latest row per node, and the
    // de-duplication below already keeps just that, so a generous cap is fine.
    // 200 rows handles ~50 nodes × 4 recent runs without truncating live data,
    // while preventing a multi-hundred-millisecond hydration on busy sessions.
    const { data: rows, error } = await supabase
        .from('node_results')
        .select('node_id, status, result_type, result_data, error, session_id, updated_at')
        .eq('session_id', sessionId)
        .order('updated_at', { ascending: false })
        .limit(200);

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
        applyNodeResult(row, sessionId, 'hydrate');
    }

    console.log(`[ExecutionChannel] Hydrated ${seenNodes.size} node(s) from DB`);
}

/**
 * Live handle to the active channel's supabase client + session, published by the
 * hook so imperative callers (e.g. the run trigger) can reconcile after a request
 * without prop-drilling. Null when no session channel is mounted.
 */
let activeChannelHandle: { supabase: ReturnType<typeof createClient>; sessionId: string } | null = null;

/**
 * Reconcile a SPECIFIC execution's node_results straight from the DB and apply
 * them to the store, with 'realtime' semantics (so a fresh run is appended to the
 * node's collection — appendAiGeneratorRun is idempotent per execution_id, so this
 * never double-appends if the realtime event already landed).
 *
 * WHY THIS EXISTS: synchronous adapter nodes (e.g. ElevenLabs speech) complete
 * server-side *inside* the /api/executions/start request — the node goes
 * running→completed in one tight window, and that 'completed' realtime event can
 * fire before the client processes it, leaving the node stuck on its optimistic
 * "loading" until a manual refresh. Calling this right after the start request
 * returns is deterministic: by then the row is guaranteed committed. Async
 * (Replicate) nodes are still 'running' at that point — re-applying 'running' is a
 * harmless no-op, and the webhook + realtime path completes them later as before.
 */
export async function reconcileExecutionFromDb(executionId: string): Promise<void> {
    if (!executionId || !activeChannelHandle) return;
    const { supabase, sessionId } = activeChannelHandle;
    const { data, error } = await supabase
        .from('node_results')
        .select('node_id, status, result_type, result_data, error, session_id, execution_id')
        .eq('execution_id', executionId);
    if (error) {
        console.warn('[ExecutionChannel] Post-run reconcile failed:', error.message);
        return;
    }
    for (const row of data || []) applyNodeResult(row, sessionId, 'realtime');
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
    // node_results and node_predictions live on SEPARATE channels — see the
    // buildResultsChannel comment below for why. Each gets its own ref so they can
    // be subscribed, reconnected, and cleaned up independently.
    const resultsChannelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null);
    const predictionsChannelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null);
    const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
    const visibilityHandlerRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        if (!sessionId) {
            console.log('[ExecutionChannel] No sessionId, skipping');
            return;
        }

        const supabase = createClient();
        supabaseRef.current = supabase;
        // Publish the handle so reconcileExecutionFromDb() can run a targeted
        // post-run catch-up for synchronously-completed nodes.
        activeChannelHandle = { supabase, sessionId };

        const handleResultChange = (payload: any) => {
            const record = payload.new;
            if (!record) return;
            applyNodeResult(record, sessionId, 'realtime');
        };

        const handlePredictionChange = (payload: any) => {
            const record = payload.new;
            if (record) applyPredictionResult(record);
        };

        // CRITICAL: node_results and node_predictions live on SEPARATE channels.
        // Supabase validates EVERY postgres_changes binding on a channel at
        // subscribe() time (publication membership + RLS). If any one binding
        // fails — e.g. node_predictions isn't in the realtime publication / lacks
        // an RLS SELECT grant in a given environment — the WHOLE channel is
        // rejected with CHANNEL_ERROR and NO events are delivered for ANY binding
        // on it. Putting the critical result-delivery binding (node_results) on
        // its own channel guarantees it can never be poisoned by the non-critical
        // streaming-partials binding (node_predictions).
        const buildResultsChannel = () =>
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

        const buildPredictionsChannel = () =>
            supabase
                .channel(`session_predictions_${sessionId}`)
                .on(
                    'postgres_changes',
                    { event: '*', schema: 'public', table: 'node_predictions' },
                    handlePredictionChange
                );

        const resultsChannel = buildResultsChannel();
        resultsChannelRef.current = resultsChannel;

        // Subscribe the results channel, then hydrate from the DB to catch the
        // missed-event window. Hydrate runs on FAILURE too: if the subscribe ever
        // fails, the bounded DB catch-up still reconciles node status/output so a
        // finished run never hangs on "loading".
        subscribeWithRetry(resultsChannel, 3, 1000)
            .then(() => hydrateFromDb(supabase, sessionId))
            .catch((err) => {
                console.error('[ExecutionChannel] Results subscribe failed; hydrating from DB instead:', err);
                return hydrateFromDb(supabase, sessionId);
            });

        // Predictions channel is non-critical (per-iteration streaming tiles).
        // Subscribe independently; a failure here must NOT affect node_results.
        const predictionsChannel = buildPredictionsChannel();
        predictionsChannelRef.current = predictionsChannel;
        subscribeWithRetry(predictionsChannel, 3, 1000).catch((err) => {
            console.warn('[ExecutionChannel] Predictions subscribe failed (streaming tiles only):', err);
        });

        // Reconnect + re-hydrate when the tab becomes visible again. Always
        // re-hydrate node_results (cheap, bounded) so events missed while the tab
        // was backgrounded or the socket briefly dropped are reconciled; rebuild a
        // dead channel if needed.
        const handleVisibilityChange = async () => {
            if (document.visibilityState !== 'visible') return;

            // Always reconcile results from the DB — covers any missed events.
            void hydrateFromDb(supabase, sessionId);

            const resultsState = (resultsChannelRef.current as any)?.state;
            if (resultsState === 'closed' || resultsState === 'errored') {
                console.log('[ExecutionChannel] Reconnecting results channel after visibility change...');
                if (resultsChannelRef.current) supabase.removeChannel(resultsChannelRef.current);
                const reconnected = buildResultsChannel();
                resultsChannelRef.current = reconnected;
                subscribeWithRetry(reconnected, 3, 1000)
                    .then(() => hydrateFromDb(supabase, sessionId))
                    .catch((err) => {
                        console.error('[ExecutionChannel] Results reconnection failed:', err);
                    });
            }

            const predState = (predictionsChannelRef.current as any)?.state;
            if (predState === 'closed' || predState === 'errored') {
                if (predictionsChannelRef.current) supabase.removeChannel(predictionsChannelRef.current);
                const reconnectedPred = buildPredictionsChannel();
                predictionsChannelRef.current = reconnectedPred;
                subscribeWithRetry(reconnectedPred, 3, 1000).catch((err) => {
                    console.warn('[ExecutionChannel] Predictions reconnection failed:', err);
                });
            }
        };

        visibilityHandlerRef.current = handleVisibilityChange;
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            activeChannelHandle = null;
            const cleanupChannel = (ref: typeof resultsChannelRef) => {
                if (ref.current && supabaseRef.current) {
                    try {
                        ref.current.unsubscribe();
                        supabaseRef.current.removeChannel(ref.current);
                    } catch (e) {
                        console.log('[ExecutionChannel] Cleanup error:', e);
                    }
                    ref.current = null;
                }
            };
            cleanupChannel(resultsChannelRef);
            cleanupChannel(predictionsChannelRef);
        };
    }, [sessionId]);
}
