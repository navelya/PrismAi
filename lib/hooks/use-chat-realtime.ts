import { useEffect, MutableRefObject } from 'react';
import { useAppStore } from '@/lib/store/app-store';
import { createClient } from '@/lib/supabase/client';
import { autoLayoutNodesAsync } from '@/lib/utils/graph-layout';
import { Workflow } from '@/lib/nodes/types';

export interface UseChatRealtimeProps {
    sessionId: string | null;
    realtimeHandledRef: MutableRefObject<boolean>;
    onWorkflowGenerated: (workflow: Workflow) => void;
    handleRevert: (messageId: string, skipConfirmation?: boolean) => Promise<void>;
}

export function useChatRealtime({
    sessionId,
    realtimeHandledRef,
    onWorkflowGenerated,
    handleRevert
}: UseChatRealtimeProps) {
    // =========================================================================
    // SUPABASE REALTIME: Listen for completed AI responses & session status
    // =========================================================================
    useEffect(() => {
        const activeSessionId = sessionId;
        if (!activeSessionId) return;

        const supabase = createClient();

        // 1. Listen for full message completions (chat or workflow)
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
                async (payload: any) => {
                    const updatedMessage = payload.new;
                    if (updatedMessage.role !== 'assistant') return;
                    if (updatedMessage.status !== 'completed' && updatedMessage.status !== 'failed' && updatedMessage.status !== 'processing') return;

                    console.log('[Realtime] Assistant message update received:', updatedMessage.id, updatedMessage.status);

                    if (updatedMessage.status === 'completed' || updatedMessage.status === 'failed') {
                        realtimeHandledRef.current = true; // Signal polling to skip
                    }

                    const store = useAppStore.getState();
                    let responseType = updatedMessage.metadata?.type || (updatedMessage.workflow ? 'workflow' : undefined);

                    if (!responseType && store.currentWorkflow && (updatedMessage.status === 'completed' || updatedMessage.status === 'failed')) {
                        // The UI expects a workflow, so assume Realtime stripped the large JSON columns
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
                                    const positions = await autoLayoutNodesAsync(workflow.nodes, workflow.edges, 'elk');
                                    workflow.nodes = workflow.nodes.map((n: any) => {
                                        const pos = positions.get(n.id);
                                        return pos ? { ...n, position: pos } : n;
                                    });
                                } catch (e) {
                                    console.error('[Realtime] Auto-layout failed:', e);
                                }
                            }
                        }

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
                }
            )
            .subscribe();

        // 2. Listen for intermediate live session status updates (running nodes, thumbnails)
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
                (payload: any) => {
                    const store = useAppStore.getState();
                    if (!payload.new) return;

                    const updated = payload.new;

                    if (updated.status_message) {
                        store.setStatusMessage(updated.status_message);
                    }

                    if (updated.canvas_state) {
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

                        store.setCurrentWorkflow(newWorkflow);

                        // Live Sync Node Statuses & outputs from Worker execution
                        if (newWorkflow.nodes) {
                            newWorkflow.nodes.forEach((node: any) => {
                                if (node.data?.status) {
                                    const currentStatus = store.nodeStatuses[node.id];
                                    if (currentStatus !== 'success' && currentStatus !== 'error') {
                                        store.setNodeStatus(node.id, node.data.status);
                                    }
                                }
                                if (node.data?.output !== undefined) {
                                    store.setNodeOutput(node.id, node.data.output);
                                }
                            });
                        }
                    }
                }
            )
            .subscribe();

        return () => {
            supabase.removeChannel(messagesChannel);
            supabase.removeChannel(sessionsChannel);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId]);
}
