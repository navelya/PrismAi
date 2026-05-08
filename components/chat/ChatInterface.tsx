'use client';

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
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

    const effectiveSessionId = sessionId || storeActiveSessionId;
    const isEmptyState = !effectiveSessionId;

    const isMobile = useIsMobile();
    const messages = useAppStore((state) => state.chatMessages);
    const addMessage = useAppStore((state) => state.addMessage);

    const [input, setInput] = useState('');
    const isLoading = useAppStore((state) => state.isLoading);
    const setIsLoading = useAppStore((state) => state.setIsLoading);
    const statusMessage = useAppStore((state) => state.statusMessage);
    const setStatusMessage = useAppStore((state) => state.setStatusMessage);
    const chatScrollTop = useAppStore((state) => state.chatScrollTop);
    const setChatScrollTop = useAppStore((state) => state.setChatScrollTop);
    const isLoadingSession = useAppStore((state) => state.isLoadingSession);

    const [isListening, setIsListening] = useState(false);
    const recognitionRef = useRef<any>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const lastScrollTime = useRef<number>(0);

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

    const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
    const lastScrollTopRef = useRef(0);

    const [pinnedUserMessageId, setPinnedUserMessageId] = useState<string | null>(null);
    const pinnedUserMessageIdRef = useRef<string | null>(null);
    const prevMessagesLengthRef = useRef(messages.length);
    const lastPinnedScrolledIdRef = useRef<string | null>(null);
    const spacerRef = useRef<HTMLDivElement>(null);
    // Viewport offset of the pinned user message — what we try to preserve
    // across chat-panel resizes (min↔full screen). Initialized to 16 (pin
    // position) and updated as the user scrolls.
    const userMsgViewportOffsetRef = useRef<number>(16);
    const isProgrammaticScrollRef = useRef(false);

    useEffect(() => {
        pinnedUserMessageIdRef.current = pinnedUserMessageId;
    }, [pinnedUserMessageId]);

    const handleScroll = useCallback(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        const { scrollTop, scrollHeight, clientHeight } = container;
        const isNearBottom = scrollHeight - scrollTop - clientHeight < 50;

        // Sync scroll position to global store for persistence across views
        setChatScrollTop(scrollTop);

        // Strictly tie auto-scroll to whether the user is at the bottom
        setAutoScrollEnabled(isNearBottom);

        lastScrollTopRef.current = scrollTop;

        // Track where the pinned user message sits in the viewport, so we can
        // restore that exact offset after a chat-panel resize. Skip while we
        // are mid-programmatic-scroll to avoid feedback loops.
        if (pinnedUserMessageIdRef.current && !isProgrammaticScrollRef.current) {
            const el = container.querySelector(
                `[data-message-id="${pinnedUserMessageIdRef.current}"]`
            ) as HTMLElement | null;
            if (el) {
                const containerRect = container.getBoundingClientRect();
                const elRect = el.getBoundingClientRect();
                userMsgViewportOffsetRef.current = elRect.top - containerRect.top;
            }
        }
    }, [isLoading, setChatScrollTop]);

    // RESTORE scroll position instantly on mount (avoid eye-jump)
    useLayoutEffect(() => {
        if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = chatScrollTop;
            lastScrollTopRef.current = chatScrollTop;
        }
    }, []); // Only on mount

    // 🛡️ ROBUST PINNING: Use ResizeObserver to stay at bottom during any layout shift
    useEffect(() => {
        const content = contentRef.current;
        const container = scrollContainerRef.current;
        if (!content || !container) return;

        const resizeObserver = new ResizeObserver(() => {
            if (autoScrollEnabled && !pinnedUserMessageIdRef.current) {
                container.scrollTop = container.scrollHeight;
                lastScrollTopRef.current = container.scrollTop;
            }
        });

        resizeObserver.observe(content);
        return () => resizeObserver.disconnect();
    }, [autoScrollEnabled]);


    // Reset auto-scroll and position memory when a new request starts
    useEffect(() => {
        if (isLoading) {
            setAutoScrollEnabled(true);
            setChatScrollTop(9999999);
        }
    }, [isLoading, setChatScrollTop]);

    // Force reset scroll memory when switching sessions (fresh start at bottom)
    useEffect(() => {
        if (sessionId) {
            setChatScrollTop(9999999);
            setAutoScrollEnabled(true);
            setPinnedUserMessageId(null);
            if (spacerRef.current) spacerRef.current.style.height = '0px';
            lastPinnedScrolledIdRef.current = null;
            prevMessagesLengthRef.current = 0;
        }
    }, [sessionId, setChatScrollTop]);

    // ChatGPT-style pin: when a new user message is appended, anchor it to the
    // top of the viewport with a spacer below so the assistant reply has the
    // full chat height to render into before scrolling kicks in.
    // handleSend adds user + empty assistant placeholder in one batch, so the
    // last message is the assistant — scan backward through the newly-added
    // range to find the most recent user message.
    useLayoutEffect(() => {
        if (messages.length > prevMessagesLengthRef.current) {
            let newUserMessageId: string | null = null;
            for (let i = messages.length - 1; i >= prevMessagesLengthRef.current; i--) {
                if (messages[i]?.type === 'user') {
                    newUserMessageId = messages[i].id;
                    break;
                }
            }
            if (newUserMessageId) {
                const container = scrollContainerRef.current;
                // Generous initial spacer so the smooth-scroll has room. The
                // dynamic-spacer effect will tighten this to the exact value
                // once the assistant content settles.
                if (container && spacerRef.current) {
                    spacerRef.current.style.height = `${container.clientHeight}px`;
                }
                // Reset the viewport-offset target to the pin position. The
                // smooth-scroll will land the user message at 16px from top.
                userMsgViewportOffsetRef.current = 16;
                // Set ref synchronously so the ResizeObserver bottom-pin gate
                // sees it on the very next tick, before our smooth scroll runs.
                pinnedUserMessageIdRef.current = newUserMessageId;
                setPinnedUserMessageId(newUserMessageId);
            }
        }
        prevMessagesLengthRef.current = messages.length;
    }, [messages]);

    useLayoutEffect(() => {
        if (!pinnedUserMessageId) return;
        if (lastPinnedScrolledIdRef.current === pinnedUserMessageId) return;

        const container = scrollContainerRef.current;
        if (!container) return;
        const el = container.querySelector(
            `[data-message-id="${pinnedUserMessageId}"]`
        ) as HTMLElement | null;
        if (!el) return;

        const containerRect = container.getBoundingClientRect();
        const elRect = el.getBoundingClientRect();
        const targetScrollTop = container.scrollTop + (elRect.top - containerRect.top) - 16;
        container.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'smooth' });
        lastPinnedScrolledIdRef.current = pinnedUserMessageId;
    }, [pinnedUserMessageId]);

    // Dynamic spacer: keep the spacer sized so that max-scrollTop equals the
    // pinned-position scrollTop. That way the user can't scroll past the pin,
    // and the pin survives chat-panel resizes (e.g. min↔full screen).
    // spacer = max(0, clientHeight − (content below the user message))
    //
    // Two observers: container resize also restores the user-msg viewport
    // offset (because reflow changes message heights and shifts user-msg
    // position); content resize only adjusts the spacer (offset is invariant
    // when content above the user message doesn't change).
    useEffect(() => {
        if (!pinnedUserMessageId) return;

        const container = scrollContainerRef.current;
        if (!container) return;

        const updateSpacer = (restoreOffset: boolean) => {
            const userMsgEl = container.querySelector(
                `[data-message-id="${pinnedUserMessageId}"]`
            ) as HTMLElement | null;
            const spacer = spacerRef.current;
            if (!userMsgEl || !spacer) return;

            const containerHeight = container.clientHeight;
            const containerRect = container.getBoundingClientRect();
            const userMsgRect = userMsgEl.getBoundingClientRect();

            // Invariant offset of the user message inside the scrollable content.
            const userMsgTopInContent =
                userMsgRect.top - containerRect.top + container.scrollTop;

            const currentSpacerHeight = spacer.offsetHeight;
            const naturalScrollHeight = container.scrollHeight - currentSpacerHeight;

            // We want max-scrollTop = userMsgTopInContent − 16.
            //   max-scrollTop = scrollHeight − clientHeight
            // → scrollHeight = userMsgTopInContent − 16 + clientHeight
            const desiredScrollHeight = userMsgTopInContent - 16 + containerHeight;
            const desiredSpacer = Math.max(0, desiredScrollHeight - naturalScrollHeight);

            if (Math.abs(desiredSpacer - currentSpacerHeight) > 1) {
                spacer.style.height = `${desiredSpacer}px`;
            }

            // After a chat-panel resize, message reflow may have shifted the
            // user message — adjust scrollTop so its viewport position matches
            // the previously-captured offset.
            if (restoreOffset) {
                const containerRectAfter = container.getBoundingClientRect();
                const userMsgRectAfter = userMsgEl.getBoundingClientRect();
                const currentOffset = userMsgRectAfter.top - containerRectAfter.top;
                const adjustment = currentOffset - userMsgViewportOffsetRef.current;
                if (Math.abs(adjustment) > 1) {
                    isProgrammaticScrollRef.current = true;
                    container.scrollTop += adjustment;
                    requestAnimationFrame(() => {
                        isProgrammaticScrollRef.current = false;
                    });
                }
            }
        };

        updateSpacer(false);

        const containerRO = new ResizeObserver(() => updateSpacer(true));
        containerRO.observe(container);

        const contentRO = new ResizeObserver(() => updateSpacer(false));
        if (contentRef.current) contentRO.observe(contentRef.current);

        return () => {
            containerRO.disconnect();
            contentRO.disconnect();
        };
    }, [pinnedUserMessageId]);

    useEffect(() => {
        if (autoScrollEnabled && !pinnedUserMessageId) {
            const container = scrollContainerRef.current;
            if (!container) return;

            const now = Date.now();
            if (now - lastScrollTime.current > 100) {
                // Use 'auto' for streaming (performance) and 'smooth' for the very first scroll
                const isStreaming = isLoading && messages.length > 0;
                messagesEndRef.current?.scrollIntoView({
                    behavior: isStreaming ? 'auto' : 'smooth',
                    block: 'end'
                });
                lastScrollTime.current = now;
            }
        }
    }, [messages, autoScrollEnabled, isLoading, pinnedUserMessageId]);

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
                scrollContainerRef={scrollContainerRef}
                contentRef={contentRef}
                messagesEndRef={messagesEndRef}
                spacerRef={spacerRef}
                onScroll={handleScroll}
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

