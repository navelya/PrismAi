import { useState, useRef, useEffect, MutableRefObject, Dispatch, SetStateAction } from 'react';
import { useRouter } from 'next/navigation';
import { Workflow, NodeStatus } from '@/lib/nodes/types';
import { Message } from '@/lib/store/app-store';
import { useAppStore } from '@/lib/store/app-store';
import { messagesApi, sessionsApi, uploadApi, chatApi } from '@/lib/api/client';
import { createClient } from '@/lib/supabase/client';
import { autoLayoutNodesAsync } from '@/lib/utils/graph-layout';

export interface UseChatMessagesProps {
    sessionId?: string;
    realtimeHandledRef: MutableRefObject<boolean>;
    activePollsRef: MutableRefObject<Set<NodeJS.Timeout>>;
    onWorkflowGenerated: (workflow: Workflow) => void;
    abortControllerRef: MutableRefObject<AbortController | null>;
}

export function useChatMessages({
    sessionId,
    realtimeHandledRef,
    activePollsRef,
    onWorkflowGenerated,
    abortControllerRef
}: UseChatMessagesProps) {
    const router = useRouter();
    const messages = useAppStore((state) => state.chatMessages);
    const addMessage = useAppStore((state) => state.addMessage);
    const isLoading = useAppStore((state) => state.isLoading);
    const setIsLoading = useAppStore((state) => state.setIsLoading);
    const setStatusMessage = useAppStore((state) => state.setStatusMessage);
    const [editingMessageId, setEditingMessageId] = useState<string | null>(null);

    // Helper to save messages via BFF API
    const saveMessageToDb = async (msg: Message, imagePaths?: string[]) => {
        const activeSessionId = sessionId;
        if (!activeSessionId) return;

        const role = msg.type;
        const imagesToSave = imagePaths || [];

        try {
            const { message } = await messagesApi.create(activeSessionId, {
                role,
                content: msg.content || '',
                images: imagesToSave,
                created_at: msg.timestamp.toISOString(),
                canvas_state: msg.workflow || undefined,
            });

            if (message && message.id) {
                useAppStore.getState().updateMessage(msg.id, { id: message.id });
                msg.id = message.id;
            }
        } catch (err: any) {
            console.error('Failed to save message:', err);
        }
    };

    const handleRevert = async (messageId: string, skipConfirmation = false) => {
        const isInitial = messageId === 'initial';
        const confirmMsg = isInitial
            ? 'This will clear the current session and restart. Are you sure?'
            : 'Are you sure you want to rewind to this state? Future messages will be lost.';

        if (!skipConfirmation && !confirm(confirmMsg)) return;

        try {
            setIsLoading(true);

            if (isInitial) {
                const activeSessionId = sessionId;
                if (activeSessionId) {
                    await sessionsApi.reset(activeSessionId);
                }
                useAppStore.getState().setCurrentWorkflow(null);
                useAppStore.getState().clearMessages();
            } else {
                const { success, workflow } = await messagesApi.revert(messageId);

                if (success && workflow) {
                    useAppStore.getState().setCurrentWorkflow(workflow);

                    const targetIndex = messages.findIndex(m => m.id === messageId);
                    if (targetIndex !== -1) {
                        const newMessages = messages.slice(0, targetIndex + 1);
                        useAppStore.getState().clearMessages();
                        newMessages.forEach(msg => {
                            addMessage(msg);
                        });
                    }
                }
            }
        } catch (error) {
            console.error('Revert failed:', error);
            alert('Failed to rewind workflow.');
        } finally {
            setIsLoading(false);
            setStatusMessage(null);
        }
    };

    const handleStop = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        setIsLoading(false);
        setStatusMessage(null);

        const stopMessage: Message = {
            id: Date.now().toString(),
            type: 'assistant',
            content: '⏹️ Workflow stopped by user.',
            timestamp: new Date(),
        };
        addMessage(stopMessage);
    };

    const handleSend = async (
        trimmedInput: string,
        attachedBlobs: Blob[],
        attachedImages: string[],
        clearAttachments: () => void,
        setInput: (val: string) => void
    ) => {
        if (!trimmedInput || isLoading) return;

        // EDIT MODE LOGIC: Revert before sending
        if (editingMessageId) {
            const msgIndex = messages.findIndex(m => m.id === editingMessageId);
            if (msgIndex !== -1) {
                let undoSnapshotId = 'initial';
                for (let i = msgIndex - 1; i >= 0; i--) {
                    const m = messages[i];
                    if (m.type === 'assistant' && m.workflow) {
                        undoSnapshotId = m.id;
                        break;
                    }
                }
                await handleRevert(undoSnapshotId, true);
                setEditingMessageId(null);
            }
        }

        const blobsToSend = [...attachedBlobs];
        const imagesToSend = [...attachedImages];

        clearAttachments();
        setInput('');

        const userMessage: Message = {
            id: Date.now().toString(),
            type: 'user',
            content: trimmedInput,
            images: imagesToSend.length > 0 ? imagesToSend : undefined,
            timestamp: new Date(),
        };
        addMessage(userMessage);
        setIsLoading(true);

        let activeSessionId = sessionId;
        if (!activeSessionId) {
            // Optimistic instantaneous navigation for new chats!
            activeSessionId = crypto.randomUUID();
            useAppStore.getState().setActiveSessionId(activeSessionId);

            // Break the synchronous event loop so React 18 paints the optimistic Chat bubbles INSTANTLY!
            // If we don't use setTimeout, React will batch the store update inside the Next.js transition, freezing the screen.
            setTimeout(() => {
                router.replace(`/chat/${activeSessionId}`, { scroll: false });
            }, 0);

            try {
                // We MUST await this so the row exists in Postgres before `chatApi.send` fires.
                // Since `handleSend` is async, this await does NOT block the UI thread from painting.
                await sessionsApi.create('New Workflow', activeSessionId);
            } catch (err) {
                console.error('[Optimistic Navigation] Failed to quietly create DB session:', err);
                // We don't abort here because the local optimistic state is already live.
            }
        }

        let uploadedPaths: string[] = [];
        if (blobsToSend.length > 0 && activeSessionId) {
            try {
                const results = await Promise.all(
                    blobsToSend.map(blob => uploadApi.upload(blob, undefined, activeSessionId || undefined))
                );
                uploadedPaths = results.map(r => r.path);
            } catch (e) {
                console.error('[DEBUG] Image upload failed', e);
            }
        }

        try {
            const currentWorkflow = useAppStore.getState().currentWorkflow;
            const response = await chatApi.send({
                sessionId: activeSessionId!,
                prompt: trimmedInput,
                previousWorkflow: currentWorkflow,
                attachedImages: imagesToSend.length > 0 ? imagesToSend : undefined,
                imagePaths: uploadedPaths.length > 0 ? uploadedPaths : undefined,
            });

            if (response.userMessage?.id) {
                useAppStore.getState().updateMessage(userMessage.id, { id: response.userMessage.id });
            }

            const assistantPlaceholder: Message = {
                id: response.assistantMessage.id,
                type: 'assistant',
                content: '',
                timestamp: new Date(),
            };
            addMessage(assistantPlaceholder);

            realtimeHandledRef.current = false;

            // Polling Fallback Implementation
            const pollMessageId = response.assistantMessage.id;
            const pollSupabase = createClient();
            let pollCount = 0;
            const maxPolls = 60; // 3 mins

            const pollInterval = setInterval(async () => {
                pollCount++;
                if (pollCount > maxPolls || realtimeHandledRef.current) {
                    clearInterval(pollInterval);
                    activePollsRef.current.delete(pollInterval);
                    if (pollCount > maxPolls) {
                        useAppStore.getState().setIsLoading(false);
                        useAppStore.getState().setStatusMessage(null);
                    }
                    return;
                }

                try {
                    const { data: msg } = await pollSupabase
                        .from('messages')
                        .select('*')
                        .eq('id', pollMessageId)
                        .single();

                    if (!msg) return;
                    if (msg.status !== 'completed' && msg.status !== 'failed') return;
                    if (realtimeHandledRef.current) {
                        clearInterval(pollInterval);
                        activePollsRef.current.delete(pollInterval);
                        return;
                    }

                    clearInterval(pollInterval);
                    activePollsRef.current.delete(pollInterval);

                    let responseType = msg.metadata?.type || (msg.workflow ? 'workflow' : undefined);
                    if (!responseType && useAppStore.getState().currentWorkflow) {
                        responseType = 'workflow';
                    }

                    if (msg.status === 'failed') {
                        useAppStore.getState().updateMessage(pollMessageId, {
                            content: msg.content || 'Sorry, an error occurred.',
                        });
                        useAppStore.getState().setIsLoading(false);
                        useAppStore.getState().setStatusMessage(null);
                        return;
                    }

                    if (responseType === 'chat') {
                        useAppStore.getState().updateMessage(pollMessageId, {
                            content: msg.content,
                        });
                        useAppStore.getState().setIsLoading(false);
                        useAppStore.getState().setStatusMessage(null);
                        return;
                    }

                    if (responseType === 'workflow') {
                        let workflow = msg.workflow || useAppStore.getState().currentWorkflow;
                        if (workflow) {
                            if (workflow.nodes?.length > 0) {
                                try {
                                    const positions = await autoLayoutNodesAsync(workflow.nodes, workflow.edges, 'elk');
                                    workflow.nodes = workflow.nodes.map((n: any) => {
                                        const pos = positions.get(n.id);
                                        return pos ? { ...n, position: pos } : n;
                                    });
                                } catch (e) {
                                    console.error('[Polling] Auto-layout failed:', e);
                                }
                            }

                            onWorkflowGenerated(workflow);

                            const processedResult = msg.metadata?.execution_result || null;
                            const executionError = msg.metadata?.execution_error || null;

                            useAppStore.getState().updateMessage(pollMessageId, {
                                content: msg.content ?? '',
                                result: processedResult,
                                workflow,
                            });

                            const store = useAppStore.getState();
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
                            return;
                        }
                    }

                    useAppStore.getState().updateMessage(pollMessageId, {
                        content: msg.content ?? 'Response received.',
                    });
                    useAppStore.getState().setIsLoading(false);
                    useAppStore.getState().setStatusMessage(null);
                } catch (pollErr) {
                    console.warn('[Polling] Check failed:', pollErr);
                }
            }, 3000);



            activePollsRef.current.add(pollInterval);

        } catch (error) {
            console.error('Failed to send message:', error);
            const errorMessage: Message = {
                id: (Date.now() + 1).toString(),
                type: 'assistant',
                content: `Sorry, I failed to send the message: ${error instanceof Error ? error.message : 'Unknown error'}`,
                timestamp: new Date(),
            };
            addMessage(errorMessage);
            setIsLoading(false);
            setStatusMessage(null);
        }
    };

    return {
        editingMessageId,
        setEditingMessageId,
        saveMessageToDb,
        handleRevert,
        handleStop,
        handleSend
    };
}
