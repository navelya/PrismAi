'use client';

import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { useChatScroll } from '@/lib/hooks/use-chat-scroll';
import { useParams, useRouter } from 'next/navigation';
import { X, ImagePlus, Pen } from 'lucide-react';
import { MessageList } from './MessageList';
import ChatInput from './ChatInput';
import { ChatEmptyState } from './ChatEmptyState';
import { WorkflowEmptyState, ChatSkeletons } from './ChatHelpers';

// Re-export helpers that may be consumed by other modules
export { ExecutionUserFeedback, ChatSkeletons } from './ChatHelpers';
import { Workflow } from '@/lib/nodes/types';
import { useAppStore } from '@/lib/store/app-store';
import { Toast } from '@/components/ui/Toast';

import { useIsMobile } from '@/lib/hooks/use-mobile';
import { useFileUpload } from '@/lib/hooks/use-file-upload';
import { useChatMessages } from '@/lib/hooks/use-chat-messages';
import { useSession } from '@/lib/hooks/use-session';
import { useChatRealtime } from '@/lib/hooks/use-chat-realtime';
import { sessionsApi, uploadApi, userApi } from '@/lib/api/client';
import { convertImageToWebP } from '@/lib/utils/image-processing';
import { useSubscription } from '@/lib/billing/use-subscription';

interface Message {
    id: string;
    type: 'user' | 'assistant';
    content: string;
    images?: string[];
    result?: any;
    workflow?: Workflow;
    timestamp: Date;
    status?: 'running' | 'completed' | 'error';
    executionResult?: any;
    thinking?: string;
    isThinking?: boolean;
    thinkingDurationMs?: number;
}

interface ChatInterfaceProps {
    onWorkflowGenerated: (workflow: Workflow) => void;
    currentWorkflow?: Workflow | null;
    onReady?: (addResult: (result: any) => void) => void;
    userName?: string;
    sessionId?: string | null;
}


export default function ChatInterface({ onWorkflowGenerated, currentWorkflow, onReady, userName: initialUserName, sessionId: propSessionId }: ChatInterfaceProps) {
    const params = useParams();
    const router = useRouter();
    const sessionId = (propSessionId || params?.sessionId || params?.id) as string;

    // 👑 STABILITY FIX: מוחק את הזיכרון ברגע שחוזרים לעמוד ריק (New Chat)
    const [prevSessionId, setPrevSessionId] = useState(sessionId);
    useEffect(() => {
        if (sessionId !== prevSessionId) {
            setPrevSessionId(sessionId);
            if (!sessionId) {
                useAppStore.getState().setActiveSessionId(null);
                useAppStore.getState().clearMessages();
                useAppStore.getState().setCurrentWorkflow(null);
            }
        }
    }, [sessionId, prevSessionId]);

    const storeActiveSessionId = useAppStore((state) => state.activeSessionId);
    const isCanvasMode = useAppStore((state) => state.isCanvasMode);
    const selectedChatModel = useAppStore((state) => state.selectedChatModel);
    const setSelectedChatModel = useAppStore((state) => state.setSelectedChatModel);
    const { subscription } = useSubscription();
    const isPaid = subscription?.planId !== 'free' && subscription !== null;

    const effectiveSessionId = sessionId || storeActiveSessionId;
    const isEmptyState = !effectiveSessionId;

    const isMobile = useIsMobile();
    const messages = useAppStore((state) => state.chatMessages);
    const addMessage = useAppStore((state) => state.addMessage);

    const [input, setInput] = useState('');
    const isLoading = useAppStore((state) => state.isLoading);
    const statusMessage = useAppStore((state) => state.statusMessage);
    const isLoadingSession = useAppStore((state) => state.isLoadingSession);

    const [isListening, setIsListening] = useState(false);
    const recognitionRef = useRef<any>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);

    const {
        attachedImages,
        attachedBlobsRef,
        isDragOver,
        handleImageFiles,
        handleChatDragOver,
        handleChatDragLeave,
        handleChatDrop,
        removeAttachedImage,
        clearAttachments,
        evictionToast,
        evictionToastMessage,
        dismissEvictionToast,
    } = useFileUpload();

    const { createNewSession } = useSession();
    const {
        editingMessageId,
        setEditingMessageId,
        saveMessageToDb,
        handleRevert,
        handleStop,
        handleSend: sendMessage,
        retryLast
    } = useChatMessages({
        sessionId: effectiveSessionId || undefined,
        onWorkflowGenerated,
        abortControllerRef
    });

    // 👑 פונקציית ה-Send המעודכנת שכוללת ניווט ויצירת סשן
    const handleSend = () => {
        sendMessage(input.trim(), attachedBlobsRef.current, attachedImages, clearAttachments, setInput);
    };

    useChatRealtime({
        sessionId: effectiveSessionId || null,
        onWorkflowGenerated,
        handleRevert
    });

    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const scroll = useChatScroll({ messages, isLoading, sessionId: effectiveSessionId });

    const toggleListening = () => {
        if (typeof window === 'undefined') return;

        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
            alert('Speech recognition is not supported in your browser. Please use Chrome, Edge, or Safari.');
            return;
        }

        if (isListening) {
            try {
                if (recognitionRef.current) {
                    recognitionRef.current.stop();
                }
            } catch (e) {
                console.error('Error stopping recognition:', e);
            }
            setIsListening(false);
        } else {
            const startingText = input;

            try {
                const recognition = new SpeechRecognition();
                recognition.continuous = true;
                recognition.interimResults = true;
                recognition.lang = 'en-US';

                recognition.onstart = () => {
                    setIsListening(true);
                };

                recognition.onresult = (event: any) => {
                    const transcript = Array.from(event.results)
                        .map((result: any) => result[0].transcript)
                        .join('');

                    const separator = startingText && !startingText.endsWith(' ') ? ' ' : '';
                    setInput(startingText + separator + transcript);
                };

                recognition.onend = () => {
                    setIsListening(false);
                    recognitionRef.current = null;
                };

                recognition.onerror = (event: any) => {
                    if (event.error === 'no-speech') {
                        setIsListening(false);
                    }
                    else if (event.error === 'not-allowed') {
                        setIsListening(false);
                        alert('Microphone access denied. Please allow microphone access in browser settings.');
                    }
                    else {
                        setIsListening(false);
                    }
                };

                recognitionRef.current = recognition;
                recognition.start();

            } catch (err: any) {
                console.error('Initialization error:', err);
                setIsListening(false);
            }
        }
    };

    const handleEdit = (message: Message) => {
        setEditingMessageId(message.id);
        setInput(message.content);
        setTimeout(() => {
            textareaRef.current?.focus();
            if (textareaRef.current) {
                textareaRef.current.style.height = 'auto';
                textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
            }
        }, 100);
    };

    const cancelEdit = () => {
        setEditingMessageId(null);
        setInput('');
    };

    const onReadyRef = useRef(onReady);
    const latestDepsRef = useRef({ sessionId: effectiveSessionId, saveMessageToDb, router, addMessage });

    useLayoutEffect(() => {
        onReadyRef.current = onReady;
        latestDepsRef.current = { sessionId: effectiveSessionId, saveMessageToDb, router, addMessage };
    });

    useEffect(() => {
        if (onReadyRef.current) {
            onReadyRef.current(async (result: any) => {
                const { sessionId: currentSessionId, saveMessageToDb: currentSave, router: currentRouter, addMessage: currentAdd } = latestDepsRef.current;

                let activeSessionId = currentSessionId;

                if (!activeSessionId) {
                    try {
                        const { session } = await sessionsApi.create('');
                        if (session) {
                            activeSessionId = session.id;
                            useAppStore.getState().setActiveSessionId(session.id);
                            currentRouter.replace(`/chat/${session.id}`, { scroll: false });
                        }
                    } catch (err) {
                        console.error("Failed to create session for editor result:", err);
                        return;
                    }
                }

                let processedResult = result;
                let resultImagePaths: string[] = [];

                try {
                    if (Array.isArray(result)) {
                        for (let i = 0; i < result.length; i++) {
                            const item = result[i];
                            const isDataUri = item.url?.startsWith('data:');
                            const isExternalUrl = item.url?.startsWith('http') &&
                                !item.url.includes(window.location.hostname) &&
                                !item.url.includes('.supabase.co');

                            if (item?.url && (isDataUri || isExternalUrl)) {
                                try {
                                    const response = await fetch(item.url);
                                    const blob = await response.blob();
                                    const uploaded = await uploadApi.upload(blob, {
                                        sessionId: activeSessionId || undefined
                                    });
                                    resultImagePaths.push(uploaded.path);
                                    result[i] = { ...item, url: uploaded.publicUrl };
                                } catch (e) {
                                    console.error("Failed to upload editor result image:", e);
                                }
                            }
                        }
                        processedResult = result;
                    }
                } catch (e) {
                    console.error("Failed to process editor result images:", e);
                }

                const assistantMessage: Message = {
                    id: Date.now().toString(),
                    type: 'assistant',
                    content: 'Workflow executed from editor:',
                    result: processedResult,
                    timestamp: new Date(),
                };

                currentAdd(assistantMessage);
                currentSave(assistantMessage, resultImagePaths);
            });
        }
    }, []);

    // Derive effective model: default to 'sonnet' for paid, 'haiku' for free
    const effectiveModel: 'haiku' | 'sonnet' =
        selectedChatModel ?? (isPaid ? 'sonnet' : 'haiku');

    const chatInputProps = {
        value: input,
        onChange: setInput,
        onSend: handleSend,
        onStop: handleStop,
        isLoading,
        onOpenImagePicker: () => imageInputRef.current?.click(),
        onToggleVoice: toggleListening,
        isVoiceActive: isListening,
        isCanvasMode,
        attachedImages,
        onRemoveAttachedImage: removeAttachedImage,
        isPaid,
        selectedModel: effectiveModel,
        onModelSelect: setSelectedChatModel,
    };

    const [userName, setUserName] = useState<string>(initialUserName || '');

    useEffect(() => {
        const getUserName = async () => {
            try {
                const { user } = await userApi.me();
                const name = user?.user_metadata?.display_name || user?.user_metadata?.full_name;
                if (name) {
                    setUserName(name);
                }
            } catch {
            }
        };

        getUserName();
    }, []);

    if (isEmptyState) {
        return (
            <ChatEmptyState
                userName={userName}
                isMobile={isMobile}
                isDragOver={isDragOver}
                onDragOver={handleChatDragOver}
                onDragLeave={handleChatDragLeave}
                onDrop={handleChatDrop}
                imageInputRef={imageInputRef}
                onImageInputChange={(e) => {
                    handleImageFiles(e.target.files);
                    if (imageInputRef.current) imageInputRef.current.value = '';
                }}
                chatInputProps={chatInputProps}
                textareaRef={textareaRef}
                onCreateNewSession={createNewSession}
                onSuggestionClick={(prompt) => setInput(prompt)}
                evictionToast={evictionToast}
                evictionToastMessage={evictionToastMessage}
                onDismissEvictionToast={dismissEvictionToast}
            />
        );
    }

    return (
        <div
            className="relative flex flex-col h-full bg-surface-primary"
            onDragOver={handleChatDragOver}
            onDragLeave={handleChatDragLeave}
            onDrop={handleChatDrop}
        >
            <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => {
                    handleImageFiles(e.target.files);
                    if (imageInputRef.current) imageInputRef.current.value = '';
                }}
                className="hidden"
            />

            {isDragOver && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-surface-primary/90 backdrop-blur-sm">
                    <div className="text-center">
                        <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-premium flex items-center justify-center">
                            <ImagePlus className="w-10 h-10 text-white" />
                        </div>
                        <h2 className="text-xl font-semibold text-content-primary">Add images</h2>
                        <p className="text-content-secondary mt-1">Drop files here to add to your message</p>
                    </div>
                </div>
            )}

            <MessageList
                messages={messages}
                editingMessageId={editingMessageId}
                isLoading={isLoading}
                isLoadingSession={isLoadingSession}
                statusMessage={statusMessage}
                isCanvasMode={isCanvasMode}
                onRevert={handleRevert}
                onEdit={handleEdit}
                onRetry={retryLast}
                scrollContainerRef={scroll.scrollContainerRef}
                contentRef={scroll.contentRef}
                messagesEndRef={scroll.messagesEndRef}
                spacerRef={scroll.spacerRef}
                onScroll={scroll.handleScroll}
                emptyState={
                    <WorkflowEmptyState
                        userName={userName}
                        isCanvasMode={isCanvasMode}
                        onSuggestionClick={(text) => {
                            setInput(text);
                            textareaRef.current?.focus();
                        }}
                    />
                }
                skeletonSlot={<ChatSkeletons isCanvasMode={isCanvasMode} />}
            />

            <div className="sticky bottom-0 p-3 bg-surface-primary/80 backdrop-blur-sm">
                {editingMessageId && (
                    <div className="flex items-center justify-between p-3 mb-3 bg-surface-secondary border border-stroke-subtle rounded-xl animate-in slide-in-from-bottom-2 shadow-lg">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-accent-primary/10 rounded-lg text-accent-primary">
                                <Pen className="w-4 h-4" />
                            </div>
                            <div className="flex flex-col">
                                <span className="text-sm font-medium text-content-primary">Edit this message and revert later changes</span>
                                <span className="text-xs text-content-secondary">Changes made after this message will be reverted.</span>
                            </div>
                        </div>
                        <button
                            onClick={cancelEdit}
                            className="p-2 hover:bg-surface-tertiary rounded-lg transition-colors text-content-secondary hover:text-content-primary"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                )}
                <ChatInput ref={textareaRef} {...chatInputProps} />
            </div>
            {evictionToast && (
                <Toast
                    message={evictionToastMessage}
                    duration={4000}
                    onClose={dismissEvictionToast}
                />
            )}
        </div>
    );
}

