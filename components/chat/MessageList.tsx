'use client';

import React from 'react';
import { Bot } from 'lucide-react';
import { Workflow } from '@/lib/nodes/types';
import { Message } from './Message';

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
    clarification?: { options: string[] };
    clarificationAnswer?: { chosenIndex: number | null; text: string };
    plan?: {
        title: string;
        summary: string;
        arrows: string;
        models: string[];
        detail: string;
    };
    planAnswer?: { action: 'approve' | 'feedback'; feedbackText?: string };
    planApproveError?: string;
}

interface MessageListProps {
    messages: Message[];
    editingMessageId: string | null;
    isLoading: boolean;
    isLoadingSession: boolean;
    statusMessage: string | null;
    isCanvasMode: boolean;
    onRevert: (id: string, skipConfirmation?: boolean) => void;
    onEdit: (message: Message) => void;
    onRetry: () => void;
    onClarificationAnswer?: (payload: {
        questionMessageId: string;
        chosenIndex: number | null;
        text: string;
    }) => void;
    onPlanApprove?: (planMessageId: string) => void;
    onPlanFeedback?: (planMessageId: string, feedbackText: string) => void;
    scrollContainerRef: React.RefObject<HTMLDivElement>;
    contentRef: React.RefObject<HTMLDivElement>;
    messagesEndRef: React.RefObject<HTMLDivElement>;
    spacerRef: React.RefObject<HTMLDivElement>;
    onScroll: () => void;
    emptyState?: React.ReactNode;
    skeletonSlot?: React.ReactNode;
}

export function MessageList({
    messages,
    editingMessageId,
    isLoading,
    isLoadingSession,
    statusMessage,
    isCanvasMode,
    onRevert,
    onEdit,
    onRetry,
    onClarificationAnswer,
    onPlanApprove,
    onPlanFeedback,
    scrollContainerRef,
    contentRef,
    messagesEndRef,
    spacerRef,
    onScroll,
    emptyState,
    skeletonSlot,
}: MessageListProps) {
    return (
        <div
            ref={scrollContainerRef}
            onScroll={onScroll}
            className={`flex-1 overflow-y-auto overflow-x-hidden flex flex-col ${isCanvasMode ? 'p-4 pt-16' : 'p-6'}`}
            style={{ overflowAnchor: 'auto' }}
        >
            {!isLoadingSession && messages.length === 0 && !isLoading && emptyState}

            <div ref={contentRef} className={`max-w-3xl mx-auto space-y-6 pb-2 w-full ${!isLoadingSession && messages.length === 0 && !isLoading ? 'hidden' : ''}`}>
                {isLoadingSession && messages.length === 0 ? (
                    skeletonSlot
                ) : (
                    messages.map((message, index) => {
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
                            <Message
                                key={`${message.type}-${index}`}
                                message={message}
                                onRevert={onRevert}
                                onEdit={onEdit}
                                onRetry={onRetry}
                                onClarificationAnswer={onClarificationAnswer}
                                onPlanApprove={onPlanApprove}
                                onPlanFeedback={onPlanFeedback}
                                undoSnapshotId={undoSnapshotId}
                                isDisabled={isDisabled}
                                isEditing={isEditing}
                                serverStatus={statusMessage}
                                isCanvasMode={isCanvasMode}
                                isGenerating={isGenerating}
                            />
                        );
                    })
                )}

                {isLoading && !(messages.length > 0 && messages[messages.length - 1].type === 'assistant' && !messages[messages.length - 1].content) && (
                    <div className={`flex ${isCanvasMode ? 'gap-2.5' : 'gap-4'} animate-in fade-in slide-in-from-left-2 duration-300`}>
                        {!isCanvasMode && (
                            <div className="flex-shrink-0 w-9 h-9 flex items-center justify-center mt-1">
                                <Bot className="w-5 h-5 text-accent-primary opacity-80" />
                            </div>
                        )}
                        <div className="flex items-center gap-1 px-1 py-2">
                            <span className="size-1.5 animate-bounce rounded-full bg-zinc-500 [animation-delay:0ms] dark:bg-zinc-400" />
                            <span className="size-1.5 animate-bounce rounded-full bg-zinc-500 [animation-delay:120ms] dark:bg-zinc-400" />
                            <span className="size-1.5 animate-bounce rounded-full bg-zinc-500 [animation-delay:240ms] dark:bg-zinc-400" />
                        </div>
                    </div>
                )}

                <div ref={spacerRef} style={{ height: 0 }} aria-hidden="true" />

                <div ref={messagesEndRef} />
            </div>
        </div>
    );
}
