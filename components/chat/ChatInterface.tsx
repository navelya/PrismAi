'use client';

import React, { useState, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { Send, Loader2, Bot, User, Mic, Sparkles, MicOff, Square, Plus, X, Image, ImagePlus, ChevronUp } from 'lucide-react';
import MessageRenderer from './MessageRenderer';
import { Workflow } from '@/lib/nodes/types';
import { useAppStore } from '@/lib/store/app-store';
import { executeWorkflow } from '@/lib/workflow-engine';
import { generateNodeId } from '@/lib/utils';
import { useIsMobile } from '@/lib/hooks/use-mobile';

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
}

export default function ChatInterface({ onWorkflowGenerated, currentWorkflow, onReady }: ChatInterfaceProps) {
    const isMobile = useIsMobile();

    // Use global store for messages
    const messages = useAppStore((state) => state.chatMessages);
    const addMessage = useAppStore((state) => state.addMessage);

    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const [attachedImages, setAttachedImages] = useState<string[]>([]);
    const [isDragOver, setIsDragOver] = useState(false);
    const [isPlusMenuOpen, setIsPlusMenuOpen] = useState(false);
    const recognitionRef = useRef<any>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);

    // Textarea ref for auto-resize
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const ghostRef = useRef<HTMLDivElement>(null);
    const [isExpanded, setIsExpanded] = useState(false);
    const [isMultiLine, setIsMultiLine] = useState(false);

    // Check if this is a fresh chat (no user messages yet)
    const hasUserMessages = messages.some(m => m.type === 'user');
    const isEmptyState = !hasUserMessages && !isLoading;

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
                // REMOVED: The manual getUserMedia call that was closing the stream

                const recognition = new SpeechRecognition();
                recognition.continuous = true;
                recognition.interimResults = true;
                recognition.lang = 'en-US';

                // Note: maxAlternatives is 1 by default, usually not needed to set explicitly

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
                        // Start/Stop cycle resulted in silence. 
                        // Usually safe to ignore or just turn off the UI.
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

    // Image upload handlers
    const handleImageFiles = useCallback((files: FileList | null) => {
        if (!files || files.length === 0) return;

        Array.from(files).forEach((file) => {
            if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onloadend = () => {
                    const base64 = reader.result as string;
                    setAttachedImages(prev => [...prev, base64]);
                };
                reader.readAsDataURL(file);
            }
        });
    }, []);

    const handleChatDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer.types.includes('Files')) {
            setIsDragOver(true);
        }
    }, []);

    const handleChatDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        // Check if leaving the container entirely (relatedTarget is null when leaving window)
        const relatedTarget = e.relatedTarget as HTMLElement | null;
        if (!relatedTarget || !e.currentTarget.contains(relatedTarget)) {
            setIsDragOver(false);
        }
    }, []);

    const handleChatDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        handleImageFiles(e.dataTransfer.files);
    }, [handleImageFiles]);

    const removeAttachedImage = useCallback((index: number) => {
        setAttachedImages(prev => prev.filter((_, i) => i !== index));
    }, []);

    const handleSend = async () => {
        const trimmedInput = input.trim();
        if (!trimmedInput || isLoading) return;

        // Capture and clear attached images first
        const imagesToSend = [...attachedImages];
        setAttachedImages([]);

        // Add user message with images
        const userMessage: Message = {
            id: Date.now().toString(),
            type: 'user',
            content: trimmedInput,
            images: imagesToSend.length > 0 ? imagesToSend : undefined,
            timestamp: new Date(),
        };
        addMessage(userMessage);

        setInput('');
        setIsLoading(true);

        // Create abort controller for this request
        abortControllerRef.current = new AbortController();

        try {
            // Generate workflow from user input (with current workflow as context)
            const generateResponse = await fetch('/api/workflow/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: trimmedInput,
                    previousWorkflow: currentWorkflow,
                    attachedImages: imagesToSend.length > 0 ? imagesToSend : undefined,
                }),
            });

            const generateData = await generateResponse.json();

            if (!generateData.success) {
                throw new Error(generateData.error || 'Failed to generate workflow');
            }

            const workflow = generateData.workflow;
            onWorkflowGenerated(workflow);

            // Execute workflow CLIENT-SIDE with live status updates
            const resetNodeStatuses = useAppStore.getState().resetNodeStatuses;
            const setNodeStatus = useAppStore.getState().setNodeStatus;

            resetNodeStatuses();
            workflow.nodes.forEach((node: any) => setNodeStatus(node.id, 'pending'));

            const executeData = await executeWorkflow(
                workflow,
                generateNodeId(),
                (nodeId, status) => setNodeStatus(nodeId, status)
            );

            if (!executeData.success) {
                throw new Error(executeData.error || 'Failed to execute workflow');
            }

            // Success message
            const assistantMessage: Message = {
                id: (Date.now() + 1).toString(),
                type: 'assistant',
                content: `✅ Workflow executed successfully!`,
                timestamp: new Date(),
                result: executeData.result,
                workflow,
            };
            addMessage(assistantMessage);
        } catch (error) {
            const errorMessage: Message = {
                id: (Date.now() + 1).toString(),
                type: 'assistant',
                content: `Sorry, I encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}`,
                timestamp: new Date(),
            };
            addMessage(errorMessage);
        } finally {
            setIsLoading(false);
            abortControllerRef.current = null;
        }
    };

    const handleStop = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        setIsLoading(false);

        // Add a message indicating the workflow was stopped
        const stopMessage: Message = {
            id: Date.now().toString(),
            type: 'assistant',
            content: '⏹️ Workflow stopped by user.',
            timestamp: new Date(),
        };
        addMessage(stopMessage);
    };

    // Expose method to add execution results from editor
    // Use ref to prevent infinite loop if onReady changes identity on every render
    const onReadyRef = useRef(onReady);
    useEffect(() => {
        onReadyRef.current = onReady;
    }, [onReady]);

    useEffect(() => {
        if (onReadyRef.current) {
            onReadyRef.current((result: any) => {
                const assistantMessage: Message = {
                    id: Date.now().toString(),
                    type: 'assistant',
                    content: 'Workflow executed from editor:',
                    result,
                    timestamp: new Date(),
                };
                addMessage(assistantMessage);
            });
        }
    }, []); // Run once on mount

    // Auto-resize textarea and detect multi-line
    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newValue = e.target.value;
        const textarea = textareaRef.current;
        const ghost = ghostRef.current;
        setInput(newValue);

        if (textarea) {
            const hasNewlines = newValue.includes('\n');

            // Optimize: Avoid layout thrashing in single-line mode
            // Only force 'auto' height reset if strictly necessary (shrinking in multi-line)
            if (!isMultiLine && !hasNewlines) {
                // In single line mode, we can just check if content exceeds generic single-line height
                // without forcing a reflow. Single line is ~24px content.
                // If it grows > 40px, it means it wrapped.
                if (textarea.scrollHeight > 40) {
                    setIsMultiLine(true);
                    // Height update handled by useLayoutEffect
                }
            } else {
                // Multi-line mode: needs robust measurement to handle shrinking
                textarea.style.height = 'auto';
                const contentHeight = textarea.scrollHeight;

                // Switch back to single line ONLY if content definitely fits in the narrower single-line width
                // Threshold increased to 60px to handle subpixel rendering/padding differences safe margin (1 line is ~40-48px)
                if (!hasNewlines && contentHeight < 60 && ghost) {
                    // Configure ghost to mimic single-line state
                    ghost.textContent = newValue;
                    const singleLineAvailableWidth = textarea.clientWidth - 144; // Subtract absolute positioning offsets (left-12 + right-24)
                    ghost.style.width = `${singleLineAvailableWidth}px`;

                    // Check if it fits in 1 line (~40px)
                    if (ghost.scrollHeight < 50) {
                        setIsMultiLine(false);
                    }
                } else if (!hasNewlines && contentHeight < 60) {
                    // Fallback if ghost missing or undefined
                    setIsMultiLine(false);
                } else {
                    setIsMultiLine(hasNewlines || contentHeight > 40);

                    const maxHeight = isMobile ? (isExpanded ? 200 : 72) : 200;
                    const newHeight = Math.min(contentHeight, maxHeight);
                    textarea.style.height = `${newHeight}px`;
                }
            }
        }
    };

    // Check if textarea exceeds 3 lines (for mobile expand button)
    const showExpandButton = isMobile && !isExpanded && textareaRef.current && textareaRef.current.scrollHeight > 72;

    // Input component (reused in both states) - ChatGPT-style layout
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
                               bg-gray-100 hover:bg-gray-200 text-gray-500 rounded-t-lg
                               border border-b-0 border-gray-200 transition-colors z-10"
                >
                    Expand ↑
                </button>
            )}

            {/* Input container - always flex-col for stable layout */}
            <div className={`relative flex flex-col rounded-2xl border bg-gray-50/50 
                           focus-within:ring-2 focus-within:ring-purple-500/20 focus-within:border-purple-400 focus-within:bg-white
                           transition-all duration-200
                           ${isListening ? 'border-red-400 ring-2 ring-red-500/20' : 'border-gray-200'}`}>

                {/* Attached Images Preview Strip */}
                {attachedImages.length > 0 && (
                    <div className="flex gap-2 px-3 pt-3 pb-1 overflow-x-auto">
                        {attachedImages.map((img, index) => (
                            <div key={index} className="relative flex-shrink-0 w-16 h-16 rounded-lg overflow-hidden group/img bg-gray-100 border border-gray-200">
                                <img src={img} alt={`Attached ${index + 1}`} className="w-full h-full object-cover" />
                                <button
                                    type="button"
                                    onClick={() => removeAttachedImage(index)}
                                    className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/70 rounded-full flex items-center justify-center
                                               opacity-0 group-hover/img:opacity-100 hover:bg-red-500 transition-all"
                                >
                                    <X className="w-3 h-3 text-white" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                {/* Hidden ghost element for measuring text width/height to prevent flicker loops */}
                <div
                    ref={ghostRef}
                    className="absolute top-0 left-0 -z-50 invisible whitespace-pre-wrap break-words pointer-events-none"
                    style={{
                        fontFamily: 'inherit',
                        fontSize: 'inherit',
                        lineHeight: '1.5rem', // leading-6
                        padding: '8px 8px', // px-2 py-2 to match single line
                        minHeight: '0px'
                    }}
                    aria-hidden="true"
                />

                {/* Textarea with position-based layout switching - Instant switch, no transition */}
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
                    placeholder={isListening ? 'Listening...' : 'Message Prism AI...'}
                    rows={1}
                    className={`bg-transparent focus:outline-none text-gray-800 placeholder-gray-400 resize-none leading-6 [&::-webkit-scrollbar]:hidden
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

                {/* Bottom row - buttons always at the bottom */}
                <div className={`flex w-full items-center justify-between px-2 pb-2
                               ${isMultiLine || attachedImages.length > 0 ? '' : 'pt-2'}`}>
                    {/* Plus button on left */}
                    <div className="relative z-10">
                        <button
                            type="button"
                            onClick={() => setIsPlusMenuOpen(!isPlusMenuOpen)}
                            className={`p-2 rounded-lg transition-colors ${isPlusMenuOpen ? 'bg-gray-200 text-gray-700' : 'bg-gray-100 hover:bg-gray-200 text-gray-500 hover:text-gray-700'}`}
                            title="Add attachment"
                        >
                            <Plus className={`w-5 h-5 transition-transform ${isPlusMenuOpen ? 'rotate-45' : ''}`} />
                        </button>

                        {/* Dropup Menu */}
                        {isPlusMenuOpen && (
                            <div className="absolute bottom-full left-0 mb-2 w-48 bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden z-50">
                                <button
                                    type="button"
                                    onClick={() => {
                                        imageInputRef.current?.click();
                                        setIsPlusMenuOpen(false);
                                    }}
                                    className="w-full flex items-center gap-3 px-4 py-3 text-left text-gray-700 hover:bg-gray-50 transition-colors"
                                >
                                    <ImagePlus className="w-5 h-5 text-blue-500" />
                                    <span className="font-medium">Add Images</span>
                                </button>
                                <div className="border-t border-gray-100">
                                    <button disabled className="w-full flex items-center gap-3 px-4 py-3 text-gray-400 cursor-not-allowed">
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
                            <button
                                type="button"
                                onClick={toggleListening}
                                className={`p-2 rounded-lg transition-all duration-200
                                ${isListening
                                        ? 'bg-red-500 text-white animate-pulse'
                                        : 'bg-gray-100 text-gray-400 hover:bg-gray-200 hover:text-gray-600'
                                    }`}
                                title={isListening ? 'Stop listening' : 'Voice input'}
                            >
                                {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                            </button>
                        )}

                        {isLoading ? (
                            <button
                                type="button"
                                onClick={handleStop}
                                className="p-2 rounded-lg bg-gray-100 hover:bg-red-50 border border-gray-200 hover:border-red-200 transition-all duration-200 group"
                                title="Stop"
                            >
                                <Square className="w-4 h-4 text-gray-400 group-hover:text-red-500 fill-current transition-colors" />
                            </button>
                        ) : (
                            <button
                                type="submit"
                                disabled={!input.trim()}
                                className={`p-2 rounded-lg transition-all duration-200
                                ${input.trim()
                                        ? 'bg-gray-900 hover:bg-gray-800 text-white'
                                        : 'bg-gray-100 text-gray-300 cursor-not-allowed'
                                    }`}
                                title="Send message"
                            >
                                <Send className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </form>
    );

    // Desktop Empty State: Centered welcome with input in middle
    if (isEmptyState && !isMobile) {
        return (
            <div
                className="relative flex flex-col h-full bg-white"
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
                    <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/90 backdrop-blur-sm">
                        <div className="text-center">
                            <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center">
                                <ImagePlus className="w-10 h-10 text-white" />
                            </div>
                            <h2 className="text-xl font-semibold text-gray-800">Add images</h2>
                            <p className="text-gray-500 mt-1">Drop files here to add to your message</p>
                        </div>
                    </div>
                )}

                <div className="flex-1 flex items-center justify-center p-6">
                    <div className="w-full max-w-2xl text-center">
                        {/* Welcome header with inline icon */}
                        <div className="flex items-center justify-center gap-3 mb-2">
                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center shadow-md">
                                <Sparkles className="w-5 h-5 text-white" />
                            </div>
                            <h1 className="text-2xl font-bold text-gray-900">
                                Welcome to Prism AI
                            </h1>
                        </div>
                        <p className="text-gray-500 mb-8">
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
                                    className="px-4 py-2 text-sm bg-gray-100 hover:bg-purple-50 text-gray-600 hover:text-purple-700 
                                               rounded-full transition-colors border border-gray-200 hover:border-purple-200"
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

    // Mobile Empty State: Welcome at top, input at bottom
    if (isEmptyState && isMobile) {
        return (
            <div
                className="relative flex flex-col h-full bg-white"
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
                    <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/90 backdrop-blur-sm">
                        <div className="text-center">
                            <div className="w-16 h-16 mx-auto mb-3 rounded-xl bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center">
                                <ImagePlus className="w-8 h-8 text-white" />
                            </div>
                            <h2 className="text-lg font-semibold text-gray-800">Add images</h2>
                            <p className="text-gray-500 text-sm mt-1">Drop files here</p>
                        </div>
                    </div>
                )}

                {/* Welcome content */}
                <div className="flex-1 flex items-center justify-center p-6">
                    <div className="text-center">
                        <div className="flex items-center justify-center gap-2 mb-2">
                            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center shadow-md">
                                <Sparkles className="w-4 h-4 text-white" />
                            </div>
                            <h1 className="text-xl font-bold text-gray-900">
                                Welcome to Prism AI
                            </h1>
                        </div>
                        <p className="text-gray-500 text-sm">
                            Tell me what you'd like to do with images.
                        </p>
                    </div>
                </div>

                {/* Input at bottom */}
                <div className="sticky bottom-0 border-t border-gray-100 p-4 bg-white/80 backdrop-blur-sm">
                    {InputField}
                </div>
            </div>
        );
    }

    // Normal chat state with messages
    return (
        <div
            className="relative flex flex-col h-full bg-white"
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
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/90 backdrop-blur-sm">
                    <div className="text-center">
                        <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center">
                            <ImagePlus className="w-10 h-10 text-white" />
                        </div>
                        <h2 className="text-xl font-semibold text-gray-800">Add images</h2>
                        <p className="text-gray-500 mt-1">Drop files here to add to your message</p>
                    </div>
                </div>
            )}

            {/* Messages with max-width centered content */}
            <div className="flex-1 overflow-y-auto p-6">
                <div className="max-w-3xl mx-auto space-y-6">
                    {messages.map((message) => (
                        <MemoizedMessage key={message.id} message={message} />
                    ))}

                    {isLoading && (
                        <div className="flex gap-4 animate-fade-in">
                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-premium flex items-center justify-center">
                                <Bot className="w-5 h-5 text-white" />
                            </div>
                            <div className="flex items-center gap-2 text-gray-600">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <span className="text-sm">Creating workflow...</span>
                            </div>
                        </div>
                    )}

                    <div ref={messagesEndRef} />
                </div>
            </div>

            {/* Input - Fixed at bottom */}
            <div className="sticky bottom-0 border-t border-gray-100 p-4 bg-white/80 backdrop-blur-sm">
                {InputField}
            </div>
        </div>
    );
}

// Memoized message component to prevent re-renders
const MemoizedMessage = React.memo(function MemoizedMessage({ message }: { message: Message }) {
    return (
        <div
            className={`flex gap-4 animate-fade-in ${message.type === 'user' ? 'justify-end' : 'justify-start'
                }`}
        >
            {message.type === 'assistant' && (
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-premium flex items-center justify-center">
                    <Bot className="w-5 h-5 text-white" />
                </div>
            )}

            <div
                className={`max-w-[80%] space-y-3 ${message.type === 'user'
                    ? 'bg-gradient-premium text-white px-6 py-3 rounded-2xl rounded-tr-sm'
                    : ''
                    }`}
            >
                {/* Attached images for user messages */}
                {message.type === 'user' && message.images && message.images.length > 0 && (
                    <div className="flex gap-2 flex-wrap mb-2">
                        {message.images.map((img, index) => (
                            <div key={index} className="w-16 h-16 rounded-lg overflow-hidden bg-white/20">
                                <img src={img} alt={`Attachment ${index + 1}`} className="w-full h-full object-cover" />
                            </div>
                        ))}
                    </div>
                )}

                <p className={message.type === 'user' ? 'text-white' : 'text-gray-800'}>
                    {message.content}
                </p>

                {message.result && (
                    <MessageRenderer data={message.result} />
                )}
            </div>

            {message.type === 'user' && (
                <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gray-300 flex items-center justify-center">
                    <User className="w-5 h-5 text-gray-700" />
                </div>
            )}
        </div>
    );
});
