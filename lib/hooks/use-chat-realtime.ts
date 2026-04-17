import { useEffect, useRef } from 'react';
import { useAppStore } from '@/lib/store/app-store';
import { createClient } from '@/lib/supabase/client';
import { autoLayoutNodesAsync } from '@/lib/utils/graph-layout';
import { Workflow } from '@/lib/nodes/types';
import { stableStringify, cleanWorkflowForSave } from '@/lib/utils/stable-stringify';

export interface UseChatRealtimeProps {
    sessionId: string | null;
    onWorkflowGenerated: (workflow: Workflow) => void;
    handleRevert: (messageId: string, skipConfirmation?: boolean) => Promise<void>;
}

/**
 * A module-level hash of the last workflow received from the server (via Realtime or DB load).
 *
 * The autosave pipeline compares outgoing workflow hashes against this value.
 * If they match, the workflow hasn't been user-edited since the last server write,
 * so autosave is skipped — breaking the feedback loop:
 *
 *   Server writes canvas_state → Realtime → store update → debouncedWorkflow
 *   → auto-save checks hash → SAME → skip → no DB write → no Realtime echo → ✅ loop broken
 *
 * When the user makes manual changes in the editor, their local hash will differ,
 * so the save WILL fire correctly.
 *
 * Exported so:
 * - useChatRealtime can update it when realtime fires
 * - use-session can update it when loading from DB
 * - ChatInterface auto-save can read & compare it
 */
export let serverWorkflowHash: string | null = null;

export function setServerWorkflowHash(workflow: any) {
    serverWorkflowHash = workflow ? stableStringify(cleanWorkflowForSave(workflow)) : null;
}

export function useChatRealtime({
    sessionId,
    onWorkflowGenerated,
    handleRevert
}: UseChatRealtimeProps) {
    const messagesChannelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null);
    const sessionsChannelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null);
    const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);

    // =========================================================================
    // SUPABASE REALTIME: Listen for completed AI responses & session status
    // =========================================================================
    useEffect(() => {
        const activeSessionId = sessionId;

        const supabase = createClient();
        supabaseRef.current = supabase;

        // ─── Handlers ────────────────────────────────────────────────────────

        const handleMessageUpdate = async (payload: any) => {
            const updatedMessage = payload.new;
            if (updatedMessage.role !== 'assistant') return;
            if (
                updatedMessage.status !== 'completed' &&
                updatedMessage.status !== 'failed' &&
                updatedMessage.status !== 'processing'
            ) return;


            const store = useAppStore.getState();
            let responseType = updatedMessage.metadata?.type || (updatedMessage.workflow ? 'workflow' : undefined);

            if (!responseType && store.currentWorkflow && (updatedMessage.status === 'completed' || updatedMessage.status === 'failed')) {
                responseType = 'workflow';
            }

            if (updatedMessage.status === 'failed') {
                store.updateMessage(updatedMessage.id, {
                    content: updatedMessage.content || 'Sorry, an error occurred.',
                });
                store.setIsLoading(false);
                store.setStatusMessage(null);
                return;
            }

            if (responseType === 'undo') {
                store.updateMessage(updatedMessage.id, { content: updatedMessage.content });
                const snapshots = store.chatMessages
                    .filter(m => m.type === 'assistant' && m.workflow)
                    .sort((a, b) => Number(b.id) - Number(a.id));

                if (snapshots.length >= 2) {
                    await handleRevert(snapshots[1].id, true);
                }
                store.setIsLoading(false);
                store.setStatusMessage(null);
                return;
            }

            if (responseType === 'chat') {
                store.updateMessage(updatedMessage.id, { content: updatedMessage.content });
                store.setIsLoading(false);
                store.setStatusMessage(null);
                return;
            }

            if (responseType === 'workflow') {
                let workflow = updatedMessage.workflow;
                let processedResult = updatedMessage.metadata?.execution_result || null;
                let executionError = updatedMessage.metadata?.execution_error || null;
                let contentToRender = updatedMessage.content;

                if (!workflow && !updatedMessage.metadata && (updatedMessage.status === 'completed' || updatedMessage.status === 'failed')) {
                    console.log('[Realtime] Payload likely truncated by Postgres. Fetching full row directly...');
                    try {
                        const { data: fullMsg } = await supabase.from('messages').select('*').eq('id', updatedMessage.id).single();
                        if (fullMsg) {
                            workflow = fullMsg.workflow;
                            processedResult = fullMsg.metadata?.execution_result || null;
                            executionError = fullMsg.metadata?.execution_error || null;
                            contentToRender = fullMsg.content;
                        }
                    } catch (e) {
                        console.error('[Realtime] Backup block-fetch failed', e);
                    }
                }

                workflow = workflow || store.currentWorkflow;
                if (!workflow) return;

                const existingWorkflow = store.currentWorkflow;

                if (workflow.nodes?.length > 0) {
                    let needsLayout = true;
                    if (existingWorkflow && existingWorkflow.nodes) {
                        let hasReusedPosition = false;
                        workflow.nodes = workflow.nodes.map((n: any) => {
                            const existingNode = existingWorkflow.nodes.find((en: any) => en.id === n.id);
                            if (existingNode && existingNode.position && (existingNode.position.x !== 0 || existingNode.position.y !== 0)) {
                                hasReusedPosition = true;
                                return { ...n, position: existingNode.position };
                            }
                            return n;
                        });
                        if (hasReusedPosition) needsLayout = false;
                    }

                    if (needsLayout) {
                        try {
                            const positions = await autoLayoutNodesAsync(workflow.nodes, workflow.edges);
                            workflow.nodes = workflow.nodes.map((n: any) => {
                                const pos = positions.get(n.id);
                                return pos ? { ...n, position: pos } : n;
                            });
                        } catch (e) {
                            console.error('[Realtime] Auto-layout failed:', e);
                        }
                    }
                }

                // Mark this workflow as coming from the server so auto-save skips it
                setServerWorkflowHash(workflow);

                onWorkflowGenerated(workflow);

                const isCompleted = updatedMessage.status === 'completed' || updatedMessage.status === 'failed';

                if (isCompleted) {
                    store.updateMessage(updatedMessage.id, {
                        content: contentToRender || '',
                        result: processedResult,
                        workflow,
                    });

                    store.resetNodeStatuses();
                    store.clearExecutionResults();
                    store.clearNodeOutputs();

                    if (executionError && !processedResult) {
                        workflow.nodes?.forEach((node: any) => store.setNodeStatus(node.id, 'error'));
                    } else {
                        workflow.nodes?.forEach((node: any) => store.setNodeStatus(node.id, 'success'));
                    }

                    store.setIsLoading(false);
                    store.setStatusMessage(null);
                } else {
                    store.updateMessage(updatedMessage.id, { workflow });
                }
                return;
            }

            store.updateMessage(updatedMessage.id, { content: updatedMessage.content || 'Response received.' });
            store.setIsLoading(false);
            store.setStatusMessage(null);
        };

        const handleSessionUpdate = (payload: any) => {
            const store = useAppStore.getState();
            if (!payload.new) return;

            const updated = payload.new;

            if (updated.status_message !== undefined) {
                store.setStatusMessage(updated.status_message || null);
            }

            if (updated.canvas_state) {
                if (store.isDragging) {
                    return;
                }

                const existingWorkflow = store.currentWorkflow;
                let newWorkflow = updated.canvas_state;

                // Preserve node positions to stop screen-jumping
                if (existingWorkflow && existingWorkflow.nodes && newWorkflow && newWorkflow.nodes) {
                    newWorkflow.nodes = newWorkflow.nodes.map((n: any) => {
                        const existingNode = existingWorkflow.nodes.find((en: any) => en.id === n.id);
                        if (existingNode && existingNode.position) {
                            return { ...n, position: existingNode.position };
                        }
                        return n;
                    });
                }

                // ─── HASH GUARD ────────────────────────────────────────────────────
                // Break the echo loop: if the incoming workflow hash structurally matches 
                // what the server/we already know, ignore it to preserve volatile local state (like .output).
                const incomingHash = stableStringify(cleanWorkflowForSave(newWorkflow));
                if (incomingHash === serverWorkflowHash) {
                    return;
                }

                const localHash = existingWorkflow
                    ? stableStringify(cleanWorkflowForSave(existingWorkflow))
                    : null;

                if (incomingHash === localHash) {
                    return;
                }

                setServerWorkflowHash(newWorkflow);
                // Server-origin updates must not mark the workflow as dirty,
                // otherwise autosave writes them back and creates an echo loop.
                store.setCurrentWorkflow(newWorkflow, false);

                // V3.1: Live state (status, output) is now handled EXCLUSIVELY by node_results table
                // via useExecutionChannel. We no longer sync it from canvas_state to avoid 
                // clobbering live execution state with stale data from the sessions table.
                console.log('[Realtime] Workflow structure updated from server. Ignoring execution state in canvas_state.');
            }
        };

        // ─── Subscribe ───────────────────────────────────────────────────────

        const subscribe = () => {
            if (activeSessionId) {
                const messagesChannel = supabase
                    .channel(`chat-messages-${activeSessionId}`)
                    .on(
                        'postgres_changes',
                        {
                            event: 'UPDATE',
                            schema: 'public',
                            table: 'messages',
                            filter: `session_id=eq.${activeSessionId}`,
                        },
                        handleMessageUpdate
                    )
                    .subscribe((status: string, err?: any) => {
                        if (err) console.error('[Realtime] Messages channel error:', err);
                    });

                messagesChannelRef.current = messagesChannel;

                const sessionsChannel = supabase
                    .channel(`chat-sessions-${activeSessionId}`)
                    .on(
                        'postgres_changes',
                        {
                            event: 'UPDATE',
                            schema: 'public',
                            table: 'sessions',
                            filter: `id=eq.${activeSessionId}`,
                        },
                        handleSessionUpdate
                    )
                    .subscribe((status: string, err?: any) => {
                        if (err) console.error('[Realtime] Sessions channel error:', err);
                    });

                sessionsChannelRef.current = sessionsChannel;
            }
        };

        subscribe();

        // ─── Tab Visibility Reconnect ─────────────────────────────────────────
        // When the user leaves and returns to the tab, re-check the live state.
        const handleVisibilityChange = async () => {
            if (document.visibilityState !== 'visible') return;

            const store = useAppStore.getState();

            if (activeSessionId) {
                try {
                    const { data: latestMessages } = await supabase
                        .from('messages')
                        .select('*')
                        .eq('session_id', activeSessionId)
                        .eq('role', 'assistant')
                        .order('created_at', { ascending: false })
                        .limit(1);

                    const latestAssistant = latestMessages?.[0];

                    if (
                        latestAssistant &&
                        store.isLoading &&
                        (latestAssistant.status === 'completed' || latestAssistant.status === 'failed')
                    ) {
                        await handleMessageUpdate({ new: latestAssistant });
                    }

                    const { data: sessionData } = await supabase
                        .from('sessions')
                        .select('canvas_state, status_message')
                        .eq('id', activeSessionId)
                        .single();

                    if (sessionData) {
                        if (sessionData.status_message !== undefined) {
                            store.setStatusMessage(sessionData.status_message || null);
                        }
                        if (sessionData.canvas_state && !store.isLoading) {
                            setServerWorkflowHash(sessionData.canvas_state);
                            store.setCurrentWorkflow(sessionData.canvas_state, false);
                        }
                    }
                } catch (e) {
                    console.error('[Realtime] Tab-return state check failed:', e);
                }
            }

            // Resubscribe if channels are closed
            const getMsgState = () => (messagesChannelRef.current as any)?.state;
            const getSessState = () => (sessionsChannelRef.current as any)?.state;

            if (getMsgState() === 'closed' || getSessState() === 'closed') {
                if (messagesChannelRef.current) supabase.removeChannel(messagesChannelRef.current);
                if (sessionsChannelRef.current) supabase.removeChannel(sessionsChannelRef.current);
                subscribe();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            if (messagesChannelRef.current) supabase.removeChannel(messagesChannelRef.current);
            if (sessionsChannelRef.current) supabase.removeChannel(sessionsChannelRef.current);
            messagesChannelRef.current = null;
            sessionsChannelRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId]);
}
