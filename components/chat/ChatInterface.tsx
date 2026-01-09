'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Bot, User, Mic, Sparkles, MicOff, Square } from 'lucide-react';
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
    const recognitionRef = useRef<any>(null);
    const abortControllerRef = useRef<AbortController | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // Check if this is a fresh chat (no user messages yet)
    const hasUserMessages = messages.some(m => m.type === 'user');
    const isEmptyState = !hasUserMessages && !isLoading;

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

    // Initialize Web Speech API
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
            if (SpeechRecognition) {
                const recognition = new SpeechRecognition();
                recognition.continuous = true;  // Keep listening until manually stopped
                recognition.interimResults = true;
                recognition.lang = 'en-US';
                recognition.maxAlternatives = 1;

                recognition.onresult = (event: any) => {
                    let finalTranscript = '';
                    let interimTranscript = '';

                    for (let i = event.resultIndex; i < event.results.length; i++) {
                        const transcript = event.results[i][0].transcript;
                        if (event.results[i].isFinal) {
                            finalTranscript += transcript;
                        } else {
                            interimTranscript += transcript;
                        }
                    }

                    // Show interim results while speaking, or final when done
                    setInput(prev => {
                        // If we have final transcript, append it
                        if (finalTranscript) {
                            return (prev + ' ' + finalTranscript).trim();
                        }
                        // Otherwise show the interim (will be replaced)
                        return interimTranscript || prev;
                    });
                };

                recognition.onend = () => {
                    setIsListening(false);
                };

                recognition.onerror = (event: any) => {
                    console.error('Speech recognition error:', event.error);
                    setIsListening(false);

                    // Provide user feedback for common errors
                    if (event.error === 'not-allowed') {
                        alert('Microphone access denied. Please allow microphone access in your browser settings.');
                    } else if (event.error === 'no-speech') {
                        // Don't show alert for no-speech, just silently stop
                    }
                };

                recognitionRef.current = recognition;
            }
        }

        return () => {
            if (recognitionRef.current) {
                try {
                    recognitionRef.current.abort();
                } catch (e) {
                    // Ignore abort errors
                }
            }
        };
    }, []);

    const toggleListening = async () => {
        if (!recognitionRef.current) {
            alert('Speech recognition is not supported in your browser. Please use Chrome, Edge, or Safari.');
            return;
        }

        if (isListening) {
            try {
                recognitionRef.current.stop();
            } catch (e) {
                // Ignore stop errors
            }
            setIsListening(false);
        } else {
            // Request microphone permission first on mobile
            try {
                // This triggers the permission dialog on mobile
                await navigator.mediaDevices.getUserMedia({ audio: true });

                setInput('');
                recognitionRef.current.start();
                setIsListening(true);
            } catch (err) {
                console.error('Microphone permission error:', err);
                alert('Please allow microphone access to use voice input.');
            }
        }
    };

    const handleSend = async () => {
        const trimmedInput = input.trim();
        if (!trimmedInput || isLoading) return;

        // Add user message
        const userMessage: Message = {
            id: Date.now().toString(),
            type: 'user',
            content: trimmedInput,
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
                    previousWorkflow: currentWorkflow
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
    useEffect(() => {
        if (onReady) {
            onReady((result: any) => {
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
    }, [onReady]);

    // Input component (reused in both states)
    const InputField = (
        <form onSubmit={(e) => {
            e.preventDefault();
            handleSend();
        }} className="relative w-full max-w-3xl mx-auto">
            <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={isListening ? 'Listening...' : 'e.g., Find 10 pink flowers and remove backgrounds...'}
                className={`w-full px-5 py-4 pr-14 rounded-2xl border bg-gray-50/50 
                           focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-400 focus:bg-white
                           transition-all duration-200 text-gray-800 placeholder-gray-400
                           ${isListening ? 'border-red-400 ring-2 ring-red-500/20' : 'border-gray-200'}`}
            />
            {isLoading ? (
                <button
                    type="button"
                    onClick={handleStop}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-2.5 rounded-xl transition-all duration-200
                        bg-red-500 text-white shadow-lg hover:bg-red-600 hover:scale-105"
                    title="Stop workflow"
                >
                    <Square className="w-5 h-5 fill-current" />
                </button>
            ) : input.trim() ? (
                <button
                    type="submit"
                    disabled={isLoading}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-2.5 rounded-xl transition-all duration-200
                        bg-gradient-to-r from-purple-600 to-blue-600 text-white shadow-lg hover:shadow-xl hover:scale-105"
                >
                    <Send className="w-5 h-5" />
                </button>
            ) : (
                <button
                    type="button"
                    onClick={toggleListening}
                    className={`absolute right-3 top-1/2 -translate-y-1/2 p-2.5 rounded-xl transition-all duration-200
                        ${isListening
                            ? 'bg-red-500 text-white shadow-lg animate-pulse'
                            : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                        }`}
                >
                    {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                </button>
            )}
        </form>
    );

    // Desktop Empty State: Centered welcome with input in middle
    if (isEmptyState && !isMobile) {
        return (
            <div className="flex flex-col h-full bg-white">
                <div className="flex-1 flex items-center justify-center p-6">
                    <div className="w-full max-w-2xl text-center">
                        {/* Welcome Icon */}
                        <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center shadow-lg">
                            <Sparkles className="w-10 h-10 text-white" />
                        </div>

                        {/* Welcome Text */}
                        <h1 className="text-2xl font-bold text-gray-900 mb-2">
                            Welcome to Prism AI
                        </h1>
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
                                    className="px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-full hover:bg-gray-200 transition-colors"
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
            <div className="flex flex-col h-full bg-white">
                {/* Welcome content */}
                <div className="flex-1 flex items-center justify-center p-6">
                    <div className="text-center">
                        <div className="w-16 h-16 mx-auto mb-4 rounded-xl bg-gradient-to-br from-purple-500 to-blue-500 flex items-center justify-center shadow-lg">
                            <Sparkles className="w-8 h-8 text-white" />
                        </div>
                        <h1 className="text-xl font-bold text-gray-900 mb-2">
                            Welcome to Prism AI
                        </h1>
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
        <div className="flex flex-col h-full bg-white">
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
