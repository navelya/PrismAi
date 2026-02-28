'use client';

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Send, Loader2, Bot, User, Mic, Sparkles, MicOff, Square, Plus, X, Image, ImagePlus, ChevronUp, Pen, AlertTriangle } from 'lucide-react';
import MessageRenderer from './MessageRenderer';
import { Workflow } from '@/lib/nodes/types';
import { useAppStore } from '@/lib/store/app-store';
import { Tooltip } from '@/components/ui/Tooltip';
import { generateNodeId, generateEdgeId, formatRelativeTime } from '@/lib/utils';
import { stableStringify } from '@/lib/utils/stable-stringify';
import { executeWorkflow } from '@/lib/workflow-engine';
import { autoLayoutNodesAsync } from '@/lib/utils/graph-layout';
import { useIsMobile } from '@/lib/hooks/use-mobile';
import { useFileUpload } from '@/lib/hooks/use-file-upload';
import { useChatMessages } from '@/lib/hooks/use-chat-messages';
import { useChatRealtime, serverWorkflowHash, setServerWorkflowHash } from '@/lib/hooks/use-chat-realtime';
import { NodeStatus } from '@/lib/nodes/types';
import { sessionsApi, messagesApi, uploadApi, userApi, chatApi } from '@/lib/api/client';
import { createClient } from '@/lib/supabase/client';
import { useDebounce } from '@/lib/hooks/use-debounce';
import { convertImageToWebP } from '@/lib/utils/image-processing';

interface Message {
    id: string;
    type: 'user' | 'assistant';
    content: string;
    images?: string[]; // Attached images (base64)
    result?: any;
    workflow?: Workflow;
    timestamp: Date;
    executionResult?: any;
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
    // State for Edit Mode // Server-provided execution progress
    const [sidebarSessionId, setSidebarSessionId] = useState<string | null>(null); // Tracks active polling intervals to prevent zombies


    const storeActiveSessionId = useAppStore((state) => state.activeSessionId);
    const isCanvasMode = useAppStore((state) => state.isCanvasMode);

    // Strict Route-Based Rendering (Optimistic)
    // The Welcome screen MUST ONLY render if there is NO sessionId in the URL AND NO active session in the store.
    // By merging storeActiveSessionId, we instantly bypass the Welcome UI when the user starts a chat, entirely bypassing the Next.js `router.replace` RSC latency!
    const effectiveSessionId = sessionId || storeActiveSessionId;
    const isEmptyState = !effectiveSessionId;

    // Use store workflow for auto-save as it's the source of truth
    const storeWorkflow = useAppStore((state) => state.currentWorkflow);
    const debouncedWorkflow = useDebounce(storeWorkflow, 2000);

    // Auto-save Canvas via BFF API
    // Guard: only write to DB when the workflow content has actually changed from what
    // the server last wrote. This breaks the feedback loop:
    //   server writes canvas_state → realtime fires → store update → debouncedWorkflow
    //   → hash matches serverWorkflowHash → skip save → no DB write → no realtime echo ✅
    // When the user manually edits nodes in the editor, the hash will differ → save fires.
    useEffect(() => {
        if (!sessionId || !debouncedWorkflow) return;
        const currentHash = stableStringify(debouncedWorkflow);
        if (currentHash && currentHash !== serverWorkflowHash) {
            // Update the server hash before the async write so rapid re-renders
            // don't all fire simultaneously (optimistic dedup)
            setServerWorkflowHash(debouncedWorkflow);
            sessionsApi.update(sessionId, {
                canvas_state: debouncedWorkflow,
            }).catch((error: any) => {
                console.error("Auto-save failed", error);
            });
        }
    }, [debouncedWorkflow, sessionId]);





    const isMobile = useIsMobile();

    // ... existing code ...

    // Use global store for messages
    const messages = useAppStore((state) => state.chatMessages);
    const addMessage = useAppStore((state) => state.addMessage);

    const [input, setInput] = useState('');
    const isLoading = useAppStore((state) => state.isLoading);
    const setIsLoading = useAppStore((state) => state.setIsLoading);
    const statusMessage = useAppStore((state) => state.statusMessage);
    const setStatusMessage = useAppStore((state) => state.setStatusMessage);



    const [isListening, setIsListening] = useState(false);
    const [isPlusMenuOpen, setIsPlusMenuOpen] = useState(false);
    const recognitionRef = useRef<any>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);

    // Initialize custom hooks
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

    const {
        editingMessageId,
        setEditingMessageId,
        saveMessageToDb,
        handleRevert,
        handleStop,
        handleSend: sendMessage
    } = useChatMessages({
        sessionId: effectiveSessionId || undefined,
        onWorkflowGenerated,
        abortControllerRef
    });

    const handleSend = () => {
        sendMessage(input.trim(), attachedBlobsRef.current, attachedImages, clearAttachments, setInput);
    };

    useChatRealtime({
        sessionId: effectiveSessionId || null,
        onWorkflowGenerated,
        handleRevert
    });

    // Textarea ref for auto-resize
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const ghostRef = useRef<HTMLDivElement>(null);
    const [isExpanded, setIsExpanded] = useState(false);
    const [isMultiLine, setIsMultiLine] = useState(false);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    // Correctly resize textarea when layout mode changes
    useLayoutEffect(() => {
        const textarea = textareaRef.current;
        if (textarea && isMultiLine) {
            // Reset to auto to get correct scrollHeight in the new 'relative' layout
            textarea.style.height = 'auto';
            const newHeight = textarea.scrollHeight;

            const maxHeight = isMobile ? (isExpanded ? 200 : 72) : 200;
            textarea.style.height = `${Math.min(newHeight, maxHeight)}px`;
        }
    }, [isMultiLine, isMobile, isExpanded]);

    const toggleListening = () => {
        // Check browser support
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
            // Capture current input state
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
                    // Only set listening to false if we stopped it manually or it timed out
                    // We verify if the abortController is still active or check internal state
                    setIsListening(false);
                    recognitionRef.current = null;
                };

                recognition.onerror = (event: any) => {
                    console.error('Speech recognition error details:', event);

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
        // Focus input
        setTimeout(() => {
            textareaRef.current?.focus();
            // Adjust height
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



    // Expose method to add execution results from editor
    // Use ref to prevent infinite loop if onReady changes identity on every render
    const onReadyRef = useRef(onReady);
    useEffect(() => {
        onReadyRef.current = onReady;
    }, [onReady]);

    useEffect(() => {
        if (onReadyRef.current) {
            onReadyRef.current(async (result: any) => {
                // 1. Ensure Active Session Exists (Lazy Creation) via BFF API
                let activeSessionId = sessionId;

                if (!activeSessionId) {
                    try {
                        const { session } = await sessionsApi.create('');
                        if (session) {
                            activeSessionId = session.id;
                            useAppStore.getState().setActiveSessionId(session.id);
                            router.replace(`/chat/${session.id}`, { scroll: false });
                        }
                    } catch (err) {
                        console.error("Failed to create session for editor result:", err);
                        return;
                    }
                }

                let processedResult = result;
                let resultImagePaths: string[] = [];

                // 2. Process images via BFF upload API
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
                                    const uploaded = await uploadApi.upload(blob, undefined, activeSessionId || undefined);
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

                // 3. Save Message with persistence
                const assistantMessage: Message = {
                    id: Date.now().toString(),
                    type: 'assistant',
                    content: 'Workflow executed from editor:',
                    result: processedResult,
                    timestamp: new Date(),
                };

                addMessage(assistantMessage);
                saveMessageToDb(assistantMessage, resultImagePaths);
            });
        }
    }, []); // Run once on mount

    // Reusable height-recalculation logic (used by both typing and resize)
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

    // ResizeObserver: retrigger height calc when container dimensions change
    useEffect(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;

        const ro = new ResizeObserver(() => {
            adjustTextareaHeight();
        });
        ro.observe(textarea);

        return () => ro.disconnect();
    }, [adjustTextareaHeight]);

    // Auto-resize textarea and detect multi-line
    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setInput(e.target.value);
        // Immediately recalculate after React updates the DOM value
        // (the ref's .value is already updated by the controlled input at this point)
        adjustTextareaHeight();
    };

    // Check if textarea exceeds 3 lines (for mobile expand button)
    const showExpandButton = isMobile && !isExpanded && textareaRef.current && textareaRef.current.scrollHeight > 72;

    // Input component (reused in both states)
    const InputField = (
        <form onSubmit={(e) => {
            e.preventDefault();
            handleSend();
        }} className="relative w-full max-w-3xl mx-auto">
            {/* Mobile expand button */}
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

            {/* Input container */}
            <div className={`relative flex flex-col rounded-2xl border bg-surface-secondary/50 
                           focus-within:ring-2 focus-within:ring-accent-primary/20 focus-within:border-accent-primary focus-within:bg-surface-primary
                           transition-all duration-200
                           ${isListening ? 'border-accent-error ring-2 ring-accent-error/20' : 'border-stroke-subtle'}`}>

                {/* Attached Images Preview Strip */}
                {attachedImages.length > 0 && (
                    <div className="flex gap-2 px-3 pt-3 pb-1 overflow-x-auto">
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

                {/* Hidden ghost element */}
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

                {/* Textarea */}
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
                            ? 'relative w-full px-4 py-2'
                            : 'absolute left-12 right-24 top-1/2 -translate-y-1/2 px-2 py-2'
                        }`}
                    style={{
                        minHeight: isMultiLine || attachedImages.length > 0 ? '40px' : '24px',
                        maxHeight: isMobile ? (isExpanded ? '200px' : '72px') : '200px',
                        overflowY: isMultiLine ? 'auto' : 'hidden',
                        scrollbarWidth: 'none',
                        msOverflowStyle: 'none',
                    }}
                />

                {/* Bottom row */}
                <div className={`flex w-full items-center justify-between px-2 pb-2
                               ${isMultiLine || attachedImages.length > 0 ? '' : 'pt-2'}`}>
                    {/* Plus button on left */}
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

                        {/* Dropup Menu */}
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

                    {/* Mic and Send buttons on right */}
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
                                    disabled={!input.trim()}
                                    className={`p-2 rounded-lg transition-all duration-200
                                ${input.trim()
                                            ? 'bg-content-primary hover:bg-content-secondary text-surface-primary'
                                            : 'bg-surface-secondary text-content-tertiary cursor-not-allowed'
                                        }`}
                                >
                                    <Send className="w-4 h-4" />
                                </button>
                            </Tooltip>
                        )}
                    </div>
                </div>
            </div>
        </form>
    );

    // Mobile: Slide-out drawer
    // ... (This hook logic is in Sidebar, not here. We are in ChatInterface)

    // START: Add User Name Fetching Logic
    const [userName, setUserName] = useState<string>(initialUserName || '');
    // Removed redundant supabase declaration

    useEffect(() => {
        const getUserName = async () => {
            try {
                const { user } = await userApi.me();
                const name = user?.user_metadata?.display_name || user?.user_metadata?.full_name;
                if (name) {
                    setUserName(name);
                }
            } catch {
                // Not authenticated or failed
            }
        };

        getUserName();
    }, []);
    // END: User Name Fetching Logic

    // Desktop Empty State
    if (isEmptyState && !isMobile) {
        return (
            <div
                className="relative flex flex-col h-full bg-surface-primary"
                onDragOver={handleChatDragOver}
                onDragLeave={handleChatDragLeave}
                onDrop={handleChatDrop}
            >
                {/* Hidden file input */}
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

                {/* Drag-drop overlay */}
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

                        {/* Centered Input */}
                        {InputField}

                        {/* Example prompts */}
                        <div className="mt-8 flex flex-wrap justify-center gap-2">
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

    // Mobile Empty State
    if (isEmptyState && isMobile) {
        return (
            <div
                className="relative flex flex-col h-full bg-surface-primary"
                onDragOver={handleChatDragOver}
                onDragLeave={handleChatDragLeave}
                onDrop={handleChatDrop}
            >
                {/* Hidden file input */}
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
                            Tell me what you'd like to do with images.
                        </p>
                    </div>
                </div>

                <div className="sticky bottom-0 border-t border-stroke-subtle p-4 bg-surface-primary/80 backdrop-blur-sm">
                    {InputField}
                </div>
            </div>
        );
    }

    // Normal chat state
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

            <div className="flex-1 overflow-y-auto p-6">
                <div className="max-w-3xl mx-auto space-y-6">
                    {messages.map((message, index) => {
                        // Calculate undo target for User messages
                        let undoSnapshotId: string | undefined;
                        if (message.type === 'user') {
                            // Find closest preceding snapshot
                            let found = false;
                            for (let i = index - 1; i >= 0; i--) {
                                const m = messages[i];
                                if (m.type === 'assistant' && m.workflow) {
                                    undoSnapshotId = m.id;
                                    found = true;
                                    break;
                                }
                            }
                            // If no preceding snapshot found, allow reverting to INITIAL (empty) state
                            if (!found) {
                                undoSnapshotId = 'initial';
                            }
                        }

                        // Calculate disabled state for Edit Mode
                        const editingIndex = editingMessageId ? messages.findIndex(m => m.id === editingMessageId) : -1;
                        const isDisabled = editingIndex !== -1 && index > editingIndex;
                        const isEditing = message.id === editingMessageId;

                        return (
                            <MemoizedMessage
                                key={`${message.type}-${index}`}
                                message={message}
                                onRevert={handleRevert}
                                onEdit={handleEdit}
                                undoSnapshotId={undoSnapshotId}
                                isDisabled={isDisabled}
                                isEditing={isEditing}
                                serverStatus={statusMessage}
                                isCanvasMode={isCanvasMode}
                            />
                        );
                    })}

                    {isLoading && !(messages.length > 0 && messages[messages.length - 1].type === 'assistant' && !messages[messages.length - 1].content) && (
                        <div className="flex gap-4">
                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-premium flex items-center justify-center">
                                <Bot className="w-5 h-5 text-white" />
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

// Dynamic execution status component
export function ExecutionUserFeedback({ serverStatus }: { serverStatus?: string | null }) {
    // Prefer server-provided status (from sessions.status_message via Realtime)
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

// ... MemoizedMessage definition ...

const MemoizedMessage = React.memo(function MemoizedMessage({
    message,
    onRevert,
    onEdit,
    undoSnapshotId,
    isDisabled,
    isEditing,
    serverStatus,
    isCanvasMode = false,
}: {
    message: Message;
    onRevert?: (id: string, skipConfirmation?: boolean) => void;
    onEdit?: (message: Message) => void;
    undoSnapshotId?: string;
    isDisabled?: boolean;
    isEditing?: boolean;
    serverStatus?: string | null;
    isCanvasMode?: boolean;
}) {
    // State for local relative time
    const [timeString, setTimeString] = React.useState('');

    // Update relative time every minute
    React.useEffect(() => {
        const updateTime = () => {
            setTimeString(formatRelativeTime(message.timestamp));
        };
        updateTime();
        const interval = setInterval(updateTime, 60000);
        return () => clearInterval(interval);
    }, [message.timestamp]);

    // Handler for Revert button click
    const handleRevertClick = (e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent bubble click events
        if (onRevert && undoSnapshotId) {
            onRevert(undoSnapshotId);
        }
    };

    return (
        <div
            className={`flex gap-4 ${message.type === 'user' ? 'justify-end animate-fade-in' : 'justify-start'} 
                ${isDisabled ? 'opacity-40 grayscale pointer-events-none select-none filter blur-[1px]' : ''}
                ${isEditing ? 'z-10 relative' : ''}`}
        >
            {message.type === 'assistant' && (
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-premium flex items-center justify-center mt-1">
                    <Bot className="w-5 h-5 text-white" />
                </div>
            )}

            <div className={`relative max-w-[85%] ${message.type === 'user' ? 'min-w-[200px]' : ''}`}>
                <div
                    className={`flex flex-col overflow-hidden transition-all duration-300 ${message.type === 'user'
                        ? `bg-gradient-premium text-white rounded-2xl rounded-tr-sm relative shadow-lg shadow-accent-primary/10
                           ${isCanvasMode ? 'px-3 py-2 space-y-1' : 'px-5 py-4 space-y-2'}`
                        : 'space-y-2'
                        }`}
                >
                    {/* Image Attachments */}
                    {message.type === 'user' && message.images && message.images.length > 0 && (
                        <div className="flex gap-2 flex-wrap mb-1">
                            {message.images.map((img, index) => (
                                <div key={index} className="w-20 h-20 rounded-lg overflow-hidden bg-black/20 border border-white/10 shadow-sm">
                                    <img src={img} alt={`Attachment ${index + 1}`} className="w-full h-full object-cover" />
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Message Content */}
                    {message.content ? (
                        <p className={`text-[15px] leading-relaxed ${message.type === 'user' ? 'text-white/95 font-medium' : 'text-content-primary'}`}>
                            {message.content}
                        </p>
                    ) : message.type === 'assistant' && !message.result && (
                        <div className="flex items-center gap-2 text-content-primary py-1">
                            <Loader2 className="w-4 h-4 animate-spin text-accent-primary" />
                            <ExecutionUserFeedback serverStatus={serverStatus} />
                        </div>
                    )}

                    {/* Result (Assistant) — suppressed in Canvas Mode, replaced by compact tag */}
                    {message.result && (
                        <div className="mt-2">
                            <MessageRenderer data={message.result} isCanvasMode={isCanvasMode} />
                        </div>
                    )}

                    {/* Footer: Timestamp + Edit + Revert — hidden in canvas mode (micro-bubble) */}
                    {message.type === 'user' && (
                        <div
                            className="overflow-hidden transition-all duration-300"
                            style={{
                                maxHeight: isCanvasMode ? 0 : 80,
                                opacity: isCanvasMode ? 0 : 1,
                                marginTop: isCanvasMode ? 0 : undefined,
                            }}
                        >
                            <div className="flex items-center justify-between mt-3 pt-2 border-t border-white/10">
                                <span className="text-[11px] text-white/60 font-medium tracking-wide">
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
                                                         border border-white/10 group
                                                         ${isEditing
                                                        ? 'bg-white/30 text-white ring-2 ring-white/50'
                                                        : 'bg-white/10 hover:bg-white/20 text-white/90 hover:text-white'}`}
                                            >
                                                <Pen className="w-3.5 h-3.5" />
                                            </button>
                                        </Tooltip>
                                    )}
                                    {undoSnapshotId && (
                                        <button
                                            onClick={handleRevertClick}
                                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg 
                                                     bg-white/10 hover:bg-white/20 active:bg-white/30 
                                                     text-white/90 hover:text-white 
                                                     transition-all duration-200 backdrop-blur-sm
                                                     border border-white/10 group
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

            {message.type === 'user' && (
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
                    <div className="w-8 h-8 rounded-full bg-surface-tertiary flex items-center justify-center mt-1">
                        <User className="w-5 h-5 text-content-primary" />
                    </div>
                </div>
            )}
        </div>
    );
});
