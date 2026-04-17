'use client';

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Send, Loader2, Bot, User, Mic, Sparkles, MicOff, Square, Plus, X, Image, ImagePlus, ChevronUp, Pen, AlertTriangle, Maximize2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { TableModal } from '@/components/ui/TableModal';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import MessageRenderer from './MessageRenderer';
import { Workflow } from '@/lib/nodes/types';
import { useAppStore } from '@/lib/store/app-store';
import { Tooltip } from '@/components/ui/Tooltip';
import { generateNodeId, generateEdgeId, formatRelativeTime } from '@/lib/utils';

import { useIsMobile } from '@/lib/hooks/use-mobile';
import { useFileUpload } from '@/lib/hooks/use-file-upload';
import { useChatMessages } from '@/lib/hooks/use-chat-messages';
import { useSession } from '@/lib/hooks/use-session';
import { useChatRealtime } from '@/lib/hooks/use-chat-realtime';
import { NodeStatus } from '@/lib/nodes/types';
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
}

interface ChatInterfaceProps {
    onWorkflowGenerated: (workflow: Workflow) => void;
    currentWorkflow?: Workflow | null;
    onReady?: (addResult: (result: any) => void) => void;
    userName?: string;
    sessionId?: string | null;
}

const ChatMessageContent = ({
    message,
    isGenerating,
    isCanvasMode
}: {
    message: Message,
    isGenerating: boolean,
    isCanvasMode: boolean
}) => {
    const TAIL_LENGTH = 15;
    const isActuallyStreaming = isGenerating && message.content.length > TAIL_LENGTH;
    const stableText = isActuallyStreaming ? message.content.slice(0, -TAIL_LENGTH) : message.content;
    const tailText = isActuallyStreaming ? message.content.slice(-TAIL_LENGTH) : "";

    const [isTableModalOpen, setIsTableModalOpen] = useState(false);

    return (
        <div
            className={`prose prose-sm max-w-full overflow-hidden dark:prose-invert
                      ${message.type === 'user' ? 'text-content-primary font-medium prose-p:my-0' : 'text-content-primary'}
                      prose-strong:text-content-primary prose-headings:text-content-primary
                      prose-th:text-content-primary prose-td:text-content-primary prose-thead:text-content-primary
                      prose-tr:text-content-primary prose-tbody:text-content-primary prose-em:text-content-primary
                      prose-table:border-collapse prose-table:border prose-table:border-stroke-subtle
                      prose-th:border prose-th:border-stroke-subtle prose-th:px-3 prose-th:py-2 prose-th:bg-surface-tertiary
                      prose-td:border prose-td:border-stroke-subtle prose-td:px-3 prose-td:py-2
                      prose-code:text-content-primary prose-code:before:content-none prose-code:after:content-none
                      ${message.type === 'user' ? 'font-medium prose-p:my-0' : ''}
                      ${isCanvasMode
                    ? 'prose-p:text-[13px] prose-p:leading-[1.4] prose-li:text-[13px] prose-ul:text-[13px] prose-ol:text-[13px] prose-strong:text-[13px] prose-headings:text-[14px] prose-table:text-[12px]'
                    : 'prose-p:text-[15px] prose-p:leading-relaxed'}`}
        >
            <ReactMarkdown
                remarkPlugins={[remarkGfm, remarkBreaks]}
                components={{
                    table: ({ children }) => (
                        <div className="group/table relative my-4 max-w-full">
                            {isCanvasMode && (
                                <div className="sticky top-2 left-2 h-0 z-10">
                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setIsTableModalOpen(true);
                                        }}
                                        className="p-1.5 bg-surface-primary/90 backdrop-blur-md border border-stroke-subtle rounded-lg 
                                                   opacity-0 group-hover/table:opacity-100 
                                                   hover:bg-accent-primary hover:text-white transition-all shadow-lg text-content-secondary"
                                        title="Expand Table"
                                    >
                                        <Maximize2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            )}
                            <div className="overflow-x-auto rounded-xl border border-stroke-subtle shadow-sm bg-surface-secondary/30
                                            scrollbar-hide [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                                <table className="min-w-full divide-y divide-stroke-subtle !my-0">
                                    {children}
                                </table>
                            </div>
                        </div>
                    )
                }}
            >
                {stableText}
            </ReactMarkdown>

            <TableModal
                isOpen={isTableModalOpen}
                onClose={() => setIsTableModalOpen(false)}
                title="Data Table"
            >
                <div className="prose prose-sm max-w-none dark:prose-invert prose-code:text-accent-primary">
                    <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                        {stableText}
                    </ReactMarkdown>
                </div>
            </TableModal>
            {isActuallyStreaming && (
                <span className="inline-block">
                    {tailText.split('').map((char, index) => (
                        <span key={index} style={{ opacity: (TAIL_LENGTH - index) / TAIL_LENGTH }}>
                            {char}
                        </span>
                    ))}
                </span>
            )}
        </div>
    );
};

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

    const [isListening, setIsListening] = useState(false);
    const [isPlusMenuOpen, setIsPlusMenuOpen] = useState(false);
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
        clearAttachments
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
    const ghostRef = useRef<HTMLDivElement>(null);
    const [isExpanded, setIsExpanded] = useState(false);
    const [isMultiLine, setIsMultiLine] = useState(false);

    const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
    const lastScrollTopRef = useRef(0);

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
            if (autoScrollEnabled) {
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
        }
    }, [sessionId, setChatScrollTop]);

    useEffect(() => {
        if (autoScrollEnabled) {
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
    }, [messages, autoScrollEnabled, isLoading]);

    useLayoutEffect(() => {
        const textarea = textareaRef.current;
        if (textarea && isMultiLine) {
            textarea.style.height = 'auto';
            const newHeight = textarea.scrollHeight;
            const maxHeight = isMobile ? (isExpanded ? 200 : 72) : 200;
            textarea.style.height = `${Math.min(newHeight, maxHeight)}px`;
        }
    }, [isMultiLine, isMobile, isExpanded]);

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

    const adjustTextareaHeight = useCallback(() => {
        const textarea = textareaRef.current;
        const ghost = ghostRef.current;
        if (!textarea) return;

        const currentInput = textarea.value;
        const hasNewlines = currentInput.includes('\n');

        if (!isMultiLine && !hasNewlines) {
            if (textarea.scrollHeight > 40) {
                setIsMultiLine(true);
            }
        } else {
            textarea.style.height = 'auto';
            const contentHeight = textarea.scrollHeight;

            if (!hasNewlines && contentHeight < 60 && ghost) {
                ghost.textContent = currentInput;
                const singleLineAvailableWidth = textarea.clientWidth - 144;
                ghost.style.width = `${singleLineAvailableWidth}px`;

                if (ghost.scrollHeight < 50) {
                    setIsMultiLine(false);
                }
            } else if (!hasNewlines && contentHeight < 60) {
                setIsMultiLine(false);
            } else {
                setIsMultiLine(hasNewlines || contentHeight > 40);
                const maxHeight = isMobile ? (isExpanded ? 200 : 72) : 200;
                const newHeight = Math.min(contentHeight, maxHeight);
                textarea.style.height = `${newHeight}px`;
            }
        }
    }, [isMultiLine, isMobile, isExpanded]);

    useEffect(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;

        const ro = new ResizeObserver(() => {
            adjustTextareaHeight();
        });
        ro.observe(textarea);

        return () => ro.disconnect();
    }, [adjustTextareaHeight]);

    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInput(e.target.value);
        adjustTextareaHeight();
    };

    const showExpandButton = isMobile && !isExpanded && textareaRef.current && textareaRef.current.scrollHeight > 72;

    const InputField = (
        <form onSubmit={(e) => {
            e.preventDefault();
            handleSend();
        }} className="relative w-full max-w-3xl mx-auto">
            {showExpandButton && (
                <button
                    type="button"
                    onClick={() => setIsExpanded(true)}
                    className="absolute -top-6 left-1/2 -translate-x-1/2 px-2 py-0.5 text-xs 
                               bg-surface-tertiary hover:bg-surface-elevated text-content-secondary rounded-t-lg
                               border border-b-0 border-stroke-subtle transition-colors z-10"
                >
                    Expand ↑
                </button>
            )}

            <div className={`relative flex flex-col rounded-2xl border bg-surface-secondary/30 backdrop-blur-xl
                           focus-within:ring-2 focus-within:ring-accent-primary/20 focus-within:border-accent-primary/50 focus-within:bg-bg-primary/50
                           transition-all duration-300 group/input
                           ${isListening ? 'border-accent-error ring-2 ring-accent-error/20' : 'border-accent-primary/10'}`}>

                {attachedImages.length > 0 && (
                    <div className={`flex gap-2 px-3 pt-3 pb-1 overflow-x-auto ${isCanvasMode ? 'px-2 pt-2' : 'px-3 pt-3'}`}>
                        {attachedImages.map((img, index) => (
                            <div key={index} className="relative flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden group/img bg-surface-tertiary border border-stroke-subtle">
                                <img src={img} alt={`Attached ${index + 1}`} className="w-full h-full object-cover" />
                                <button
                                    type="button"
                                    onClick={() => removeAttachedImage(index)}
                                    className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/70 rounded-full flex items-center justify-center
                                               opacity-0 group-hover/img:opacity-100 hover:bg-accent-error transition-all"
                                >
                                    <X className="w-3 h-3 text-white" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                <div
                    ref={ghostRef}
                    className="absolute top-0 left-0 -z-50 invisible whitespace-pre-wrap break-words pointer-events-none"
                    style={{
                        fontFamily: 'inherit',
                        fontSize: 'inherit',
                        lineHeight: '1.5rem',
                        padding: '8px 8px',
                        minHeight: '0px'
                    }}
                    aria-hidden="true"
                />

                <textarea
                    ref={textareaRef}
                    value={input}
                    onChange={handleInputChange}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            handleSend();
                        }
                    }}
                    placeholder={isListening ? 'Listening...' : isCanvasMode ? 'Edit canvas' : 'Message Prism...'}
                    rows={1}
                    className={`bg-transparent focus:outline-none text-content-primary placeholder-content-tertiary resize-none leading-6 [&::-webkit-scrollbar]:hidden
                                 ${isMultiLine || attachedImages.length > 0
                            ? `relative w-full px-4 py-2 ${isCanvasMode ? 'px-3' : 'px-4'}`
                            : `absolute ${isCanvasMode ? 'left-10 right-20' : 'left-12 right-24'} top-1/2 -translate-y-1/2 px-2 py-2`
                        }`}
                    style={{
                        minHeight: isMultiLine || attachedImages.length > 0 ? '40px' : '24px',
                        maxHeight: isMobile ? (isExpanded ? '200px' : '72px') : '200px',
                        overflowY: isMultiLine ? 'auto' : 'hidden',
                        scrollbarWidth: 'none',
                        msOverflowStyle: 'none',
                    }}
                />

                <div className={`flex w-full items-center justify-between px-2 pb-2
                                ${isMultiLine || attachedImages.length > 0 ? '' : 'pt-2'}`}>
                    <div className="relative z-10">
                        <Tooltip content="Add attachment" position="top">
                            <button
                                type="button"
                                onClick={() => setIsPlusMenuOpen(!isPlusMenuOpen)}
                                className={`p-2 rounded-lg transition-colors ${isPlusMenuOpen ? 'bg-surface-tertiary text-content-primary' : 'bg-surface-secondary hover:bg-surface-tertiary text-content-tertiary hover:text-content-secondary'}`}
                            >
                                <Plus className={`w-5 h-5 transition-transform ${isPlusMenuOpen ? 'rotate-45' : ''}`} />
                            </button>
                        </Tooltip>

                        {isPlusMenuOpen && (
                            <div className="absolute bottom-full left-0 mb-2 w-48 bg-surface-primary rounded-xl shadow-xl border border-stroke-subtle overflow-hidden z-50">
                                <button
                                    type="button"
                                    onClick={() => {
                                        imageInputRef.current?.click();
                                        setIsPlusMenuOpen(false);
                                    }}
                                    className="w-full flex items-center gap-3 px-4 py-3 text-left text-content-primary hover:bg-surface-secondary transition-colors"
                                >
                                    <ImagePlus className="w-5 h-5 text-accent-primary" />
                                    <span className="font-medium">Add Images</span>
                                </button>
                                <div className="border-t border-stroke-subtle">
                                    <button disabled className="w-full flex items-center gap-3 px-4 py-3 text-content-tertiary cursor-not-allowed">
                                        <Sparkles className="w-5 h-5" />
                                        <span>Templates</span>
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-1 z-10">
                        {!isLoading && (
                            <Tooltip content={isListening ? 'Stop listening' : 'Voice input'} position="top">
                                <button
                                    type="button"
                                    onClick={toggleListening}
                                    className={`p-2 rounded-lg transition-all duration-200
                                ${isListening
                                            ? 'bg-accent-error text-white animate-pulse'
                                            : 'bg-surface-secondary text-content-tertiary hover:bg-surface-tertiary hover:text-content-secondary'
                                        }`}
                                >
                                    {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                                </button>
                            </Tooltip>
                        )}

                        {isLoading ? (
                            <Tooltip content="Stop" position="top">
                                <button
                                    type="button"
                                    onClick={handleStop}
                                    className="p-2 rounded-lg bg-surface-secondary hover:bg-accent-error/10 border border-stroke-subtle hover:border-accent-error/30 transition-all duration-200 group"
                                >
                                    <Square className="w-4 h-4 text-content-tertiary group-hover:text-accent-error fill-current transition-colors" />
                                </button>
                            </Tooltip>
                        ) : (
                            <Tooltip content="Send message" position="top">
                                <button
                                    type="submit"
                                    disabled={!input.trim() && attachedImages.length === 0}
                                    className={`p-2 rounded-lg transition-all duration-300
                                ${input.trim() || attachedImages.length > 0
                                            ? 'bg-accent-primary hover:bg-accent-hover text-white shadow-[0_0_15px_rgba(6,182,212,0.4)]'
                                            : 'bg-surface-tertiary text-content-tertiary cursor-not-allowed'
                                        }`}
                                >
                                    <Send className={`${isCanvasMode ? 'w-3.5 h-3.5' : 'w-4 h-4'}`} />
                                </button>
                            </Tooltip>
                        )}
                    </div>
                </div>
            </div>
        </form>
    );

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
                            <div className="w-10 h-10 rounded-xl bg-gradient-premium flex items-center justify-center shadow-md shadow-accent-primary/20">
                                <Sparkles className="w-5 h-5 text-content-inverted" />
                            </div>
                            <h1 className="text-2xl font-bold text-content-primary">
                                {userName ? `Welcome, ${userName.trim().split(" ")[0].replace(/^./, c => c.toUpperCase())}` : 'Welcome to Prism AI'}
                            </h1>
                        </div>
                        <p className="text-content-secondary mb-8">
                            Tell me what you'd like to do with images, and I'll create an automation workflow for you.
                        </p>

                        {InputField}

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
                                {userName ? `Welcome, ${userName.trim().split(" ")[0].replace(/^./, c => c.toUpperCase())}` : 'Welcome to Prism AI'}
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
                    {InputField}
                </div>
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

            <div
                ref={scrollContainerRef}
                onScroll={handleScroll}
                className={`flex-1 overflow-y-auto overflow-x-hidden ${isCanvasMode ? 'p-4 pt-16' : 'p-6'}`}
                style={{ overflowAnchor: 'auto' }}
            >
                <div ref={contentRef} className="max-w-3xl mx-auto space-y-6 pb-2">
                    {messages.map((message, index) => {
                        let undoSnapshotId: string | undefined;
                        if (message.type === 'user') {
                            let found = false;
                            for (let i = index - 1; i >= 0; i--) {
                                const m = messages[i];
                                if (m.type === 'assistant' && m.workflow) {
                                    undoSnapshotId = m.id;
                                    found = true;
                                    break;
                                }
                            }
                            if (!found) {
                                undoSnapshotId = 'initial';
                            }
                        }

                        const editingIndex = editingMessageId ? messages.findIndex(m => m.id === editingMessageId) : -1;
                        const isDisabled = editingIndex !== -1 && index > editingIndex;
                        const isEditing = message.id === editingMessageId;
                        const isGenerating = isLoading && index === messages.length - 1 && message.type === 'assistant';

                        return (
                            <MemoizedMessage
                                key={`${message.type}-${index}`}
                                message={message}
                                onRevert={handleRevert}
                                onEdit={handleEdit}
                                onRetry={retryLast}
                                undoSnapshotId={undoSnapshotId}
                                isDisabled={isDisabled}
                                isEditing={isEditing}
                                serverStatus={statusMessage}
                                isCanvasMode={isCanvasMode}
                                isGenerating={isGenerating}
                            />
                        );
                    })}

                    {isLoading && !(messages.length > 0 && messages[messages.length - 1].type === 'assistant' && !messages[messages.length - 1].content) && (
                        <div className={`flex ${isCanvasMode ? 'gap-2.5' : 'gap-4'} animate-in fade-in slide-in-from-left-2 duration-500`}>
                            <div className={`flex-shrink-0 ${isCanvasMode ? 'w-6 h-6' : 'w-10 h-10'} rounded-xl bg-accent-primary/10 border border-accent-primary/20 flex items-center justify-center shadow-sm`}>
                                <Bot className={`${isCanvasMode ? 'w-4 h-4' : 'w-5 h-5'} text-accent-primary`} />
                            </div>
                            <div className="flex items-center gap-2 text-content-secondary">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <ExecutionUserFeedback serverStatus={statusMessage} />
                            </div>
                        </div>
                    )}

                    <div ref={messagesEndRef} />
                </div>
            </div>

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
                {InputField}
            </div>
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

const MemoizedMessage = React.memo(function MemoizedMessage({
    message,
    onRevert,
    onEdit,
    undoSnapshotId,
    isDisabled,
    isEditing,
    serverStatus,
    isCanvasMode = false,
    isGenerating,
    onRetry,
}: {
    message: Message;
    onRevert?: (id: string, skipConfirmation?: boolean) => void;
    onEdit?: (message: Message) => void;
    undoSnapshotId?: string;
    isDisabled?: boolean;
    isEditing?: boolean;
    serverStatus?: string | null;
    isCanvasMode?: boolean;
    isGenerating?: boolean;
    onRetry?: () => void;
}) {
    const [timeString, setTimeString] = React.useState('');

    React.useEffect(() => {
        const updateTime = () => {
            setTimeString(formatRelativeTime(message.timestamp));
        };
        updateTime();
        const interval = setInterval(updateTime, 60000);
        return () => clearInterval(interval);
    }, [message.timestamp]);

    const handleRevertClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (onRevert && undoSnapshotId) {
            onRevert(undoSnapshotId);
        }
    };

    return (
        <div
            className={`flex ${isCanvasMode ? 'gap-2.5' : 'gap-4'} ${message.type === 'user' ? 'justify-end animate-fade-in' : 'justify-start'} 
                ${isDisabled ? 'opacity-40 grayscale pointer-events-none select-none filter blur-[1px]' : ''}
                ${isEditing ? 'z-10 relative' : ''}`}
        >
            {message.type === 'assistant' && (
                <div className={`flex-shrink-0 ${isCanvasMode ? 'w-6 h-6' : 'w-9 h-9'} flex items-center justify-center mt-1`}>
                    <Bot className={`${isCanvasMode ? 'w-4 h-4' : 'w-5 h-5'} text-accent-primary opacity-80`} />
                </div>
            )}

            <div className={`relative max-w-full overflow-hidden ${isCanvasMode ? 'max-w-[90%]' : 'max-w-[85%]'} ${message.type === 'user' ? (isCanvasMode ? 'min-w-[120px]' : 'min-w-[200px]') : ''}`}>
                <div
                    className={`flex flex-col overflow-hidden transition-all duration-500 rounded-2xl ${message.type === 'user'
                        ? `bg-accent-primary/5 border border-accent-primary/10 rounded-tr-sm relative
                           ${isCanvasMode ? 'px-3.5 py-2.5 space-y-1' : 'px-5 py-4 space-y-2'}`
                        : `bg-transparent border-none rounded-tl-sm
                           ${isCanvasMode ? 'py-1 space-y-1' : 'py-2 space-y-2'}`
                        }`}
                >
                    {message.status === 'error' && (
                        <div className="flex items-center gap-3 mb-2 p-2 bg-accent-error/10 border border-accent-error/20 rounded-xl">
                            <div className="flex items-center gap-2 text-accent-error text-xs font-bold uppercase tracking-wider">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                <span>Failed</span>
                            </div>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    if (onRetry) onRetry();
                                }}
                                className="px-3 py-1 bg-accent-error text-white text-[10px] font-black uppercase tracking-widest rounded-lg hover:bg-accent-error/90 transition-colors shadow-sm"
                            >
                                Try Again
                            </button>
                        </div>
                    )}

                    {message.type === 'user' && message.images && message.images.length > 0 && (
                        <div className="flex gap-2 flex-wrap mb-1">
                            {message.images.map((img, index) => (
                                <div key={index} className="w-20 h-20 rounded-lg overflow-hidden bg-black/20 border border-white/10 shadow-sm">
                                    <img src={img} alt={`Attachment ${index + 1}`} className="w-full h-full object-cover" />
                                </div>
                            ))}
                        </div>
                    )}

                    {message.content ? (
                        <ChatMessageContent
                            message={message}
                            isGenerating={!!isGenerating}
                            isCanvasMode={isCanvasMode}
                        />
                    ) : message.type === 'assistant' && !message.result && (
                        <div className="flex items-center gap-2 text-content-primary py-1">
                            <Loader2 className="w-4 h-4 animate-spin text-accent-primary" />
                            <ExecutionUserFeedback serverStatus={serverStatus} />
                        </div>
                    )}

                    {message.result && (
                        <div className="mt-2">
                            <MessageRenderer data={message.result} isCanvasMode={isCanvasMode} />
                        </div>
                    )}

                    {message.type === 'user' && (
                        <div
                            className={`transition-all duration-300 ${isCanvasMode ? 'overflow-hidden' : 'overflow-visible'}`}
                            style={{
                                maxHeight: isCanvasMode ? 0 : 80,
                                opacity: isCanvasMode ? 0 : 1,
                                marginTop: isCanvasMode ? 0 : undefined,
                            }}
                        >
                            <div className="flex items-center justify-between mt-3 pt-2 border-t border-stroke-subtle">
                                <span className="text-[10px] text-content-tertiary font-bold uppercase tracking-widest opacity-60">
                                    {timeString}
                                </span>
                                <div className="flex items-center gap-2">
                                    {onEdit && (
                                        <Tooltip content="Edit">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    onEdit(message);
                                                }}
                                                className={`flex items-center justify-center p-1.5 rounded-lg 
                                                          transition-all duration-200 backdrop-blur-sm
                                                          border border-stroke-subtle group
                                                          ${isEditing
                                                        ? 'bg-accent-primary text-white ring-2 ring-accent-primary/50'
                                                        : 'bg-surface-tertiary hover:bg-interactive-hover text-content-primary'}`}
                                            >
                                                <Pen className="w-3.5 h-3.5" />
                                            </button>
                                        </Tooltip>
                                    )}
                                    {undoSnapshotId && (
                                        <button
                                            onClick={handleRevertClick}
                                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg 
                                                     bg-surface-tertiary hover:bg-interactive-hover
                                                     text-content-primary
                                                     transition-all duration-200 backdrop-blur-sm
                                                     border border-stroke-subtle group
                                                     cursor-pointer"
                                        >
                                            <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                width="14" height="14"
                                                viewBox="0 0 24 24" fill="none"
                                                stroke="currentColor" strokeWidth="2.5"
                                                strokeLinecap="round" strokeLinejoin="round"
                                                className="mb-[1px] group-hover:-rotate-90 transition-transform duration-300"
                                            >
                                                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                                                <path d="M3 3v5h5" />
                                            </svg>
                                            <span className="text-xs font-semibold">Revert</span>
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {
                message.type === 'user' && (
                    <div
                        className="flex-shrink-0 transition-all duration-300 ease-in-out"
                        style={{
                            opacity: isCanvasMode ? 0 : 1,
                            transform: isCanvasMode ? 'scale(0.5)' : 'scale(1)',
                            width: isCanvasMode ? 0 : undefined,
                            overflow: 'hidden',
                            transitionProperty: 'opacity, transform, width',
                        }}
                    >
                        <div className="w-9 h-9 rounded-xl bg-surface-tertiary/50 border border-white/5 flex items-center justify-center mt-1 shadow-sm">
                            <User className="w-5 h-5 text-content-secondary" />
                        </div>
                    </div>
                )
            }
        </div >
    );
});
