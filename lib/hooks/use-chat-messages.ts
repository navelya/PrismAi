import { useState, useRef, useEffect, MutableRefObject, Dispatch, SetStateAction, startTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Workflow, NodeStatus } from '@/lib/nodes/types';
import { Message } from '@/lib/store/app-store';
import { useAppStore } from '@/lib/store/app-store';
import { messagesApi, sessionsApi, uploadApi } from '@/lib/api/client';
import { createClient } from '@/lib/supabase/client';
import { autoLayoutNodesAsync } from '@/lib/utils/graph-layout';

export interface UseChatMessagesProps {
    sessionId?: string;
    onWorkflowGenerated: (workflow: Workflow) => void;
    abortControllerRef: MutableRefObject<AbortController | null>;
}

export function useChatMessages({
    sessionId,
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
        if (!trimmedInput && attachedImages.length === 0) return;

        // 📸 Capture history snapshot BEFORE any optimistic updates or clearing
        const historySnapshot = useAppStore.getState().chatMessages;

        if (editingMessageId) {
            // ... (לוגיקת ה-Revert המקורית שלך נשארת כאן כרגיל)
            const msgIndex = messages.findIndex((m: any) => m.id === editingMessageId);
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

        const imagesToSend = [...attachedImages];
        clearAttachments();
        setInput('');

        // 👑 החזרנו את העדכון המיידי של ה-UI לראש הפונקציה! (לפני ה-await)
        const userMsgId = `user-${Date.now()}`;
        const assistantMsgId = `assistant-${Date.now()}`;

        addMessage({
            id: userMsgId,
            type: 'user',
            content: trimmedInput,
            images: imagesToSend.length > 0 ? imagesToSend : undefined,
            timestamp: new Date(),
        });

        addMessage({
            id: assistantMsgId,
            type: 'assistant',
            content: '',
            timestamp: new Date(),
        });

        setIsLoading(true);
        setStatusMessage('Prism is thinking...');

        let activeSessionId = sessionId || useAppStore.getState().activeSessionId;

        if (!activeSessionId) {
            activeSessionId = crypto.randomUUID();
            useAppStore.getState().setActiveSessionId(activeSessionId);

            // 👑 התיקון נגד ההבהוב! מעבר חלק לגמרי ברקע בלי להרוס את המסך
            startTransition(() => {
                router.replace(`/chat/${activeSessionId}`, { scroll: false });
            });

            try {
                // רק עכשיו מחכים לשרת!
                await sessionsApi.create('', activeSessionId);

                sessionsApi.generateTitle({
                    sessionId: activeSessionId,
                    message: trimmedInput
                }).catch(err => console.error('[TitleGen] Error:', err));
            } catch (err) {
                console.error("[Session Create] Error:", err);
            }
        }

        // --- קריאה לשרת הסטרימינג ---
        try {
            const userMsg: Message = {
                id: userMsgId,
                type: 'user',
                content: trimmedInput,
                images: imagesToSend.length > 0 ? imagesToSend : undefined,
                timestamp: new Date(),
            };

            // Build the full history using the snapshot taken BEFORE optimistic updates
            const fullHistory = [...historySnapshot, userMsg];

            const response = await fetch('/api/chat/stream', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    messages: fullHistory,
                    sessionId: activeSessionId,
                    previousWorkflow: useAppStore.getState().currentWorkflow,
                    attachedImages: imagesToSend
                }),
            });

            if (!response.ok) {
                const errText = await response.text();
                throw new Error(`Server error: ${errText}`);
            }
            if (!response.body) throw new Error('No response body');

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let networkText = '';
            let displayedText = '';
            let streamDone = false;
            let buffer = '';
            let finalWorkflow: Workflow | undefined = undefined;

            const nextFrame = () => new Promise(resolve => requestAnimationFrame(resolve));

            const renderLoop = async () => {
                while (!streamDone || displayedText.length < networkText.length) {
                    if (displayedText.length < networkText.length) {
                        const remaining = networkText.length - displayedText.length;
                        const charsToAdd = Math.max(1, Math.ceil(remaining * 0.3));
                        displayedText += networkText.substring(displayedText.length, displayedText.length + charsToAdd);

                        useAppStore.getState().updateMessage(assistantMsgId, {
                            content: displayedText
                        });
                    }
                    await nextFrame();
                }
                setIsLoading(false);
                setStatusMessage(null);

                // Assistant message generation and local state update are finished.
                // 🛑 DELETED: saveMessageToDb call removed.
                // Persistence is handled server-side in stream/route.ts.
            };

            renderLoop();

            const processStreamLine = (parsed: any) => {
                if (parsed.type === 'text') {
                    networkText += parsed.content;
                }
                else if (parsed.type === 'tool' && parsed.name === 'build_workflow') {
                    if (parsed.message) {
                        networkText += (networkText ? '\n\n' : '') + parsed.message;
                    }
                    const safeNodes = (parsed.workflow.nodes || []).map((node: any) => ({
                        ...node,
                        position: node.position || { x: 0, y: 0 }
                    }));
                    const safeWorkflow = { ...parsed.workflow, nodes: safeNodes };
                    finalWorkflow = safeWorkflow;

                    useAppStore.getState().updateMessage(assistantMsgId, {
                        workflow: safeWorkflow
                    });

                    if (onWorkflowGenerated) onWorkflowGenerated(safeWorkflow);
                }
            };

            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    if (buffer.trim()) {
                        try { processStreamLine(JSON.parse(buffer)); } catch (e) { }
                    }
                    streamDone = true;
                    break;
                }

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim()) continue;
                    try { processStreamLine(JSON.parse(line)); } catch (e) { }
                }
            }

        } catch (error) {
            console.error("Stream failed:", error);
            useAppStore.getState().updateMessage(assistantMsgId, {
                content: "Sorry, I encountered a network error while streaming."
            });
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
