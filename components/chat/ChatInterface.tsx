'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Send, Loader2, Bot, User } from 'lucide-react';
import MessageRenderer from './MessageRenderer';
import { Workflow } from '@/lib/nodes/types';
import { useAppStore } from '@/lib/store/app-store';

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
    // Use global store for messages
    const messages = useAppStore((state) => state.chatMessages);
    const addMessage = useAppStore((state) => state.addMessage);
    const [hasCheckedMessages, setHasCheckedMessages] = React.useState(false);

    // Initialize with welcome message on first load - wait for hydration
    useEffect(() => {
        // Small delay to ensure store has rehydrated from sessionStorage
        const timer = setTimeout(() => {
            if (!hasCheckedMessages && messages.length === 0) {
                addMessage({
                    id: '1',
                    type: 'assistant',
                    content: 'Hi! I\'m Prism AI. Tell me what you\'d like to do with images, and I\'ll create an automation workflow for you.',
                    timestamp: new Date(),
                });
                setHasCheckedMessages(true);
            }
        }, 100);

        return () => clearTimeout(timer);
    }, [hasCheckedMessages, messages.length, addMessage]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages]);

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

        try {
            // Generate workflow from user input (with current workflow as context)
            const generateResponse = await fetch('/api/workflow/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: trimmedInput,
                    previousWorkflow: currentWorkflow // Pass current workflow for context
                }),
            });

            const generateData = await generateResponse.json();

            if (!generateData.success) {
                throw new Error(generateData.error || 'Failed to generate workflow');
            }

            const workflow = generateData.workflow;
            onWorkflowGenerated(workflow);

            // Execute workflow
            const executeResponse = await fetch('/api/workflow/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workflow }),
            });

            const executeData = await executeResponse.json();

            if (!executeData.success) {
                throw new Error(executeData.error || 'Failed to execute workflow');
            }

            // Success message
            const assistantMessage: Message = {
                id: (Date.now() + 1).toString(),
                type: 'assistant',
                content: `✅ Workflow executed successfully! Found ${executeData.result?.images?.length || 0} images.`,
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
        }
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

    return (
        <div className="flex flex-col h-full bg-white">
            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {messages.map((message) => (
                    <div
                        key={message.id}
                        className={`flex gap-4 animate-fade-in ${message.type === 'user' ? 'justify-end' : 'justify-start'
                            }`}
                    >
                        {message.type === 'assistant' && (
                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-gradient-premium flex items-center justify-center">
                                <Bot className="w-5 h-5 text-white" />
                            </div>
                        )}

                        <div
                            className={`max-w-3xl space-y-3 ${message.type === 'user'
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

            {/* Input */}
            <div className="border-t border-gray-200 p-4 bg-gray-50">
                <form onSubmit={(e) => {
                    e.preventDefault();
                    handleSend();
                }} className="flex gap-3">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        placeholder="e.g., Find 10 pink flowers and remove backgrounds..."
                        className="flex-1 px-4 py-3 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                        disabled={isLoading}
                    />
                    <button
                        type="submit"
                        disabled={isLoading || !input.trim()}
                        className="px-6 py-3 bg-gradient-premium text-white rounded-xl hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        <Send className="w-4 h-4" />
                        <span>Send</span>
                    </button>
                </form>
            </div>
        </div>
    );
}
