'use client';

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Sparkles, X, ImagePlus, Pen, MessageCircleMore, Camera, Megaphone, HelpCircle, Workflow as WorkflowIcon } from 'lucide-react';
import { MessageList } from './MessageList';
import ChatInput from './ChatInput';
import { Workflow } from '@/lib/nodes/types';
import { useAppStore } from '@/lib/store/app-store';
import { Skeleton } from '@/components/ui/Skeleton';
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

    if (isEmptyState && !isMobile) {
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
                            <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center">
                                <ImagePlus className="w-10 h-10 text-white" />
                            </div>
                            <h2 className="text-xl font-semibold text-content-primary">Add images</h2>
                            <p className="text-content-secondary mt-1">Drop files here to add to your message</p>
                        </div>
                    </div>
                )}

                <div className="flex-1 flex items-center justify-center p-6">
                    <div className="w-full max-w-2xl text-center">
                        <div className="flex items-center justify-center gap-3 mb-2">
                            {/* <div className="w-10 h-10 rounded-xl bg-gradient-premium flex items-center justify-center shadow-md shadow-accent-primary/20">
                                <Sparkles className="w-5 h-5 text-content-inverted" />
                            </div> */}
                            <h1 className="text-2xl font-bold text-content-primary">
                                {userName ? `Welcome, ${userName.trim().split(" ")[0].replace(/^./, c => c.toUpperCase())}` : 'Welcome to Prisfol'}
                            </h1>
                        </div>
                        <p className="text-content-secondary mb-8">
                            Tell me what you'd like to do with images, and I'll create an automation workflow for you.
                        </p>

                        <ChatInput ref={textareaRef} {...chatInputProps} />

                        <div className="mt-8 flex flex-wrap justify-center gap-2">
                            <button
                                onClick={createNewSession}
                                className="px-4 py-2 text-sm bg-accent-primary hover:bg-accent-hover text-white flex items-center gap-2
                                           rounded-full transition-colors font-medium shadow-md shadow-accent-primary/20"
                            >
                                <Pen className="w-4 h-4" />
                                Start Empty Canvas
                            </button>
                            {['Find 10 cat images', 'Remove backgrounds', 'Upscale my photos'].map((prompt) => (
                                <button
                                    key={prompt}
                                    onClick={() => setInput(prompt)}
                                    className="px-4 py-2 text-sm bg-surface-secondary hover:bg-accent-primary/5 text-content-secondary hover:text-accent-primary 
                                               rounded-full transition-colors border border-stroke-subtle hover:border-accent-primary/30"
                                >
                                    {prompt}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (isEmptyState && isMobile) {
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
                            <div className="w-16 h-16 mx-auto mb-3 rounded-xl bg-gradient-premium flex items-center justify-center">
                                <ImagePlus className="w-8 h-8 text-white" />
                            </div>
                            <h2 className="text-lg font-semibold text-content-primary">Add images</h2>
                            <p className="text-content-secondary text-sm mt-1">Drop files here</p>
                        </div>
                    </div>
                )}

                <div className="flex-1 flex items-center justify-center p-6">
                    <div className="text-center">
                        <div className="flex items-center justify-center gap-2 mb-2">
                            <div className="w-8 h-8 rounded-lg bg-gradient-premium flex items-center justify-center shadow-md">
                                <Sparkles className="w-4 h-4 text-white" />
                            </div>
                            <h1 className="text-xl font-bold text-content-primary">
                                {userName ? `Welcome, ${userName.trim().split(" ")[0].replace(/^./, c => c.toUpperCase())}` : 'Welcome to Prisfol'}
                            </h1>
                        </div>
                        <p className="text-content-secondary text-sm">
                            Tell me what you'd like to do with images, or start from scratch.
                        </p>

                        <div className="mt-6 flex justify-center">
                            <button
                                onClick={createNewSession}
                                className="px-5 py-2.5 text-sm bg-accent-primary hover:bg-accent-hover text-white flex items-center gap-2
                                           rounded-full transition-colors font-medium shadow-md shadow-accent-primary/20"
                            >
                                <Pen className="w-4 h-4" />
                                Start Empty Canvas
                            </button>
                        </div>
                    </div>
                </div>

                <div className="sticky bottom-0 border-t border-stroke-subtle p-4 bg-surface-primary/80 backdrop-blur-sm">
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

export function ExecutionUserFeedback({ serverStatus }: { serverStatus?: string | null }) {
    const [dots, setDots] = useState('');

    useEffect(() => {
        const interval = setInterval(() => {
            setDots(prev => prev.length >= 3 ? '' : prev + '.');
        }, 500);
        return () => clearInterval(interval);
    }, []);

    const statusText = serverStatus || 'Creating workflow';

    return (
        <span className="text-sm min-w-[120px]">
            {statusText}{dots}
        </span>
    );
}

function WorkflowEmptyState({
    userName,
    isCanvasMode,
    onSuggestionClick,
}: {
    userName?: string;
    isCanvasMode: boolean;
    onSuggestionClick: (prompt: string) => void;
}) {
    const firstName = userName?.trim().split(' ')[0]?.replace(/^./, c => c.toUpperCase()) || '';

    const suggestions = [
        { icon: Camera, text: 'Create a product shot workflow' },
        { icon: Megaphone, text: 'Generate ad creatives for my brand' },
        { icon: WorkflowIcon, text: 'Help me pick the right model for my project' },
        { icon: HelpCircle, text: 'What can I build with Prisfol?' },
    ];

    return (
        <div className="flex-1 w-full flex flex-col chat-text-fade-in">
            <div className="flex-1 flex flex-col items-center justify-center text-center">
                <div className={`flex items-center justify-center gap-2.5 ${isCanvasMode ? 'mb-2' : 'mb-3'}`}>
                    <div className={`${isCanvasMode ? 'w-7 h-7' : 'w-9 h-9'} rounded-2xl bg-accent-primary/10 flex items-center justify-center`}>
                        <MessageCircleMore className={`${isCanvasMode ? 'w-4 h-4' : 'w-[18px] h-[18px]'} text-accent-primary`} strokeWidth={2.2} />
                    </div>
                    <h1 className={`${isCanvasMode ? 'text-xl' : 'text-3xl'} font-semibold text-content-primary tracking-tight`}>
                        Hey{firstName ? ` ${firstName}` : ''}
                    </h1>
                </div>
                <p className={`text-content-secondary leading-relaxed ${isCanvasMode ? 'text-xs max-w-[260px]' : 'text-sm max-w-md'}`}>
                    I help you build workflows and get advice on your creative projects. Ask me anything.
                </p>
            </div>

            <div className={`flex flex-col gap-2 w-full mx-auto ${isCanvasMode ? 'max-w-[300px]' : 'max-w-md'}`}>
                {suggestions.map(({ icon: Icon, text }) => (
                    <button
                        key={text}
                        type="button"
                        onClick={() => onSuggestionClick(text)}
                        className={`group flex items-center gap-2.5 ${isCanvasMode ? 'px-3 py-2 text-xs' : 'px-4 py-2.5 text-sm'}
                                    rounded-xl bg-surface-secondary hover:bg-surface-tertiary
                                    border border-stroke-subtle hover:border-accent-primary/40
                                    text-content-secondary hover:text-content-primary
                                    transition-colors text-left`}
                    >
                        <Icon className={`${isCanvasMode ? 'w-3.5 h-3.5' : 'w-4 h-4'} text-content-tertiary group-hover:text-accent-primary transition-colors flex-shrink-0`} strokeWidth={2} />
                        <span className="truncate">{text}</span>
                    </button>
                ))}
            </div>
        </div>
    );
}

export function ChatSkeletons({ isCanvasMode }: { isCanvasMode: boolean }) {
    return (
        <div className="space-y-8 animate-in fade-in duration-700">
            {[1, 2, 3].map((i) => (
                <div key={i} className={`flex ${isCanvasMode ? 'gap-2.5' : 'gap-4'} ${i === 2 ? 'flex-row-reverse' : 'flex-row'}`}>
                    <Skeleton className={`${isCanvasMode ? 'w-6 h-6' : 'w-9 h-9'} rounded-xl flex-shrink-0 mt-1`} />
                    <div className={`space-y-3 flex-1 ${i === 2 ? 'max-w-[70%]' : 'max-w-[85%]'} flex flex-col ${i === 2 ? 'items-end' : 'items-start'}`}>
                        <Skeleton className={`h-3 ${i === 2 ? 'w-20' : 'w-32'} rounded-full opacity-40`} />
                        <Skeleton className={`h-24 w-full rounded-2xl border border-white/5`} />
                    </div>
                </div>
            ))}
        </div>
    );
}
