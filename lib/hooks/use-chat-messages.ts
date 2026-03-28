import { useState, useRef, useEffect, MutableRefObject, Dispatch, SetStateAction, startTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Workflow, NodeStatus } from '@/lib/nodes/types';
import { Message } from '@/lib/store/app-store';
import { useAppStore } from '@/lib/store/app-store';
import { useShallow } from 'zustand/react/shallow';
import { messagesApi, sessionsApi, uploadApi } from '@/lib/api/client';
import { createClient } from '@/lib/supabase/client';


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
    const messages = useAppStore(useShallow((state) =>
        sessionId ? state.chatMessages.filter(m => m.sessionId === sessionId) : state.chatMessages
    ));
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
                // Intentionally omit canvas_state to avoid heavy snapshots per message
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

        // --- Initial Session Check (CRITICAL: Before adding messages) ---
        let activeSessionId = sessionId || useAppStore.getState().activeSessionId;
        let sessionCreationPromise: Promise<any> | null = null;

        if (!activeSessionId) {
            activeSessionId = crypto.randomUUID();
            useAppStore.getState().setActiveSessionId(activeSessionId);

            // Background initialization
            sessionCreationPromise = sessionsApi.create('', activeSessionId).catch(err => console.error("[Session Create] Error:", err));
            sessionsApi.generateTitle({
                sessionId: activeSessionId,
                message: trimmedInput
            }).catch(err => console.error('[TitleGen] Error:', err));

            // Smooth background transition (URL change only)
            startTransition(() => {
                router.replace(`/chat/${activeSessionId}`, { scroll: false });
            });
        }

        // 👑 Immediate UI update with guaranteed activeSessionId in store
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
            status: 'running',
            timestamp: new Date(),
        });

        setIsLoading(true);
        setStatusMessage('Prism is thinking...');

        // --- קריאה לשרת הסטרימינג ---
        try {
            if (sessionCreationPromise) {
                // Ensure the database has the session row BEFORE hitting the stream API
                // so the user message insert doesn't fail due to foreign key constraints!
                await sessionCreationPromise;
            }

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
                
                // Update message with final workflow after streaming completes
                if (finalWorkflow) {
                    useAppStore.getState().updateMessage(assistantMsgId, {
                        content: displayedText,
                        workflow: finalWorkflow
                    });
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
                else if (parsed.type === 'tool' && parsed.name === 'add_node') {
                    if (parsed.message) {
                        networkText += (networkText ? '\n\n' : '') + parsed.message;
                    }
                    
                    // Process the new incoming node
                    const existingBaseCount = useAppStore.getState().currentWorkflow?.nodes?.length || 0;
                    const newNode = {
                        ...parsed.workflow,
                        position: parsed.workflow.position?.x
                            ? parsed.workflow.position
                            : { x: 100 + (existingBaseCount * 400), y: 100 }
                    };

                    // Just append to React Flow - don't update message workflow yet
                    useAppStore.getState().appendNodeStream(newNode);
                    
                    // Track for final workflow
                    const appStore = useAppStore.getState();
                    const currentWorkflow = appStore.currentWorkflow;
                    finalWorkflow = currentWorkflow;
                }
                else if (parsed.type === 'tool' && parsed.name === 'add_connection') {
                    // Process the new incoming edge
                    const newEdge = {
                        ...parsed.edge,
                        type: 'smoothstep',
                        animated: true
                    };
                    
                    // Just append to React Flow - don't update message workflow yet
                    useAppStore.getState().appendEdgeStream(newEdge);
                    
                    // Track for final workflow
                    const appStore = useAppStore.getState();
                    const currentWorkflow = appStore.currentWorkflow;
                    finalWorkflow = currentWorkflow;
                }
                else if (parsed.type === 'error') {
                    networkText += (networkText ? '\n\n' : '') + `⚠️ ${parsed.content}`;
                }
            };

            // Queue-based line processor: ensures sequential processing
            const lineQueue: string[] = [];

            const drainQueue = async () => {
                while (lineQueue.length > 0) {
                    const line = lineQueue.shift()!;
                    if (!line.trim()) continue;
                    try {
                        const parsed = JSON.parse(line);
                        processStreamLine(parsed);
                        // NO DELAYS - stream naturally as fast as it arrives
                    } catch (e) {}
                }
            };

            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    if (buffer.trim()) lineQueue.push(buffer);
                    await drainQueue();
                    streamDone = true;
                    break;
                }

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                for (const line of lines) lineQueue.push(line);

                // Drain after each network chunk so nodes appear as they arrive
                await drainQueue();
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

    /**
     * Finds the last user message and resubmits it.
     */
    const retryLast = async () => {
        const lastUserMsg = [...messages].reverse().find(m => m.type === 'user');
        if (!lastUserMsg) return;

        // Reset the assistant's previous error state by simply sending again
        handleSend(lastUserMsg.content, [], lastUserMsg.images || [], () => { }, () => { });
    };

    return {
        editingMessageId,
        setEditingMessageId,
        saveMessageToDb,
        handleRevert,
        handleStop,
        handleSend,
        retryLast
    };
}
