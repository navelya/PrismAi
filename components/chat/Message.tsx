'use client';

import React, { useState } from 'react';
import { Bot, User, Pen, AlertTriangle, Maximize2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { TableModal } from '@/components/ui/TableModal';
import MessageRenderer from './MessageRenderer';
import { ThinkingPanel } from './ThinkingPanel';
import { ChipCard } from './ChipCard';
import { PlanCard } from './PlanCard';
import { TaskProgressCard } from './TaskProgressCard';
import { Workflow } from '@/lib/nodes/types';
import { Tooltip } from '@/components/ui/Tooltip';
import { formatRelativeTime } from '@/lib/utils';
import { detectMediaTypeFromUrl } from '@/lib/workflow/result-format';

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
        tasks?: import('@/lib/chat/streaming/protocol').TaskBlueprint[];
    };
    planAnswer?: {
        action: 'approve' | 'feedback';
        feedbackText?: string;
    };
    planApproveError?: string;
    taskProgress?: {
        status: 'running' | 'done' | 'failed';
        currentIndex: number;
        total: number;
        failedTaskId?: string | null;
        errorMessage?: string;
    };
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
    // Render the full content unsplit — splitting off a trailing tail span
    // produces a sibling element after ReactMarkdown's block-level <p>, which
    // forces the tail onto a new line during streaming.
    const stableText = message.content;

    const [isTableModalOpen, setIsTableModalOpen] = useState(false);

    const isStreamingAssistant = isGenerating && message.type === 'assistant' && message.content.length > 0;

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
                      ${isStreamingAssistant ? 'is-streaming' : ''}
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
        </div>
    );
};

export const Message = React.memo(function Message({
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
    onClarificationAnswer,
    onPlanApprove,
    onPlanFeedback,
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
    onClarificationAnswer?: (payload: {
        questionMessageId: string;
        chosenIndex: number | null;
        text: string;
    }) => void;
    onPlanApprove?: (planMessageId: string) => void;
    onPlanFeedback?: (planMessageId: string, feedbackText: string) => void;
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

    // Suppress synthetic 'Approved' user bubbles (created by the approve
    // path on the chat-stream route). The locked plan card already shows
    // "Approved & built", so a literal 'Approved' bubble below would be
    // redundant noise. The DB row stays for reload-state derivation.
    if (
        message.type === 'user' &&
        message.content === 'Approved' &&
        message.planAnswer?.action === 'approve'
    ) {
        return null;
    }

    const handleRevertClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (onRevert && undoSnapshotId) {
            onRevert(undoSnapshotId);
        }
    };

    return (
        <div
            data-message-id={message.id}
            className={`flex ${isCanvasMode ? 'gap-2.5' : 'gap-4'} ${message.type === 'user' ? 'justify-end animate-fade-in' : 'justify-start'}
                ${isDisabled ? 'opacity-40 grayscale pointer-events-none select-none filter blur-[1px]' : ''}
                ${isEditing ? 'z-10 relative' : ''}`}
        >
            {message.type === 'assistant' && !isCanvasMode && (
                <div className="flex-shrink-0 w-9 h-9 flex items-center justify-center mt-1">
                    <Bot className="w-5 h-5 text-accent-primary opacity-80" />
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
                            {message.images.map((src, index) => {
                                // Videos always arrive as https:// URLs (direct-uploaded in useFileUpload);
                                // images can be data:image/... URLs or https URLs. detectMediaTypeFromUrl
                                // returns 'video' only for known video extensions, defaulting to image otherwise.
                                const isVideo = detectMediaTypeFromUrl(src) === 'video';
                                return (
                                    <div key={index} className="w-20 h-20 rounded-lg overflow-hidden bg-black/20 border border-white/10 shadow-sm">
                                        {isVideo ? (
                                            <video src={src} muted className="w-full h-full object-cover" />
                                        ) : (
                                            <img src={src} alt={`Attachment ${index + 1}`} className="w-full h-full object-cover" />
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    {message.type === 'assistant' && message.thinking !== undefined && (
                        <ThinkingPanel
                            thinking={message.thinking ?? ''}
                            isStreaming={(message.status === 'running' || message.isThinking === true)}
                            durationMs={message.thinkingDurationMs}
                        />
                    )}

                    {message.content ? (
                        <div className={message.type === 'assistant' ? 'chat-text-fade-in' : undefined}>
                            <ChatMessageContent
                                message={message}
                                isGenerating={!!isGenerating}
                                isCanvasMode={isCanvasMode}
                            />
                        </div>
                    ) : message.type === 'assistant' && !message.result && !message.plan && !message.clarification && (
                        // Loading dots only when the bubble has nothing else to show.
                        // A plan card or chip card is visually self-sufficient content
                        // below this slot, so dots above them would just be noise — and
                        // would persist forever for plan/clarification turns where the
                        // model skipped the prose preamble (content stays '' in DB).
                        <div className="flex items-center gap-1 px-1 py-1.5">
                            <span className="size-1.5 animate-bounce rounded-full bg-zinc-500 [animation-delay:0ms] dark:bg-zinc-400" />
                            <span className="size-1.5 animate-bounce rounded-full bg-zinc-500 [animation-delay:120ms] dark:bg-zinc-400" />
                            <span className="size-1.5 animate-bounce rounded-full bg-zinc-500 [animation-delay:240ms] dark:bg-zinc-400" />
                        </div>
                    )}

                    {message.result && (
                        <div className="mt-2">
                            <MessageRenderer data={message.result} isCanvasMode={isCanvasMode} />
                        </div>
                    )}

                    {message.type === 'assistant' && message.clarification && (
                        <ChipCard
                            options={message.clarification.options}
                            answer={message.clarificationAnswer}
                            onAnswer={(payload) =>
                                onClarificationAnswer?.({
                                    questionMessageId: message.id,
                                    chosenIndex: payload.chosenIndex,
                                    text: payload.text,
                                })
                            }
                        />
                    )}

                    {message.type === 'assistant' && message.plan && (
                        <PlanCard
                            plan={{
                                title: message.plan.title,
                                summary: message.plan.summary,
                                arrows: message.plan.arrows,
                                models: message.plan.models,
                                detail: message.plan.detail,
                                tasks: message.plan.tasks,
                            }}
                            status={
                                message.planApproveError
                                    ? 'approve-failed'
                                    : message.planAnswer?.action === 'approve'
                                        ? 'approved'
                                        : message.planAnswer?.action === 'feedback'
                                            ? 'feedback-given'
                                            : 'pending'
                            }
                            feedbackText={
                                message.planAnswer?.action === 'feedback'
                                    ? message.planAnswer.feedbackText
                                    : undefined
                            }
                            approveError={message.planApproveError}
                            onApprove={() => onPlanApprove?.(message.id)}
                            onFeedback={(text) => onPlanFeedback?.(message.id, text)}
                        />
                    )}

                    {message.type === 'assistant' &&
                        message.plan?.tasks &&
                        message.plan.tasks.length > 0 &&
                        message.taskProgress && (
                            <TaskProgressCard
                                tasks={message.plan.tasks}
                                progress={message.taskProgress}
                                onRetryFromTask={(taskId) => {
                                    if (onPlanFeedback) {
                                        onPlanFeedback(
                                            message.id,
                                            `The build failed at task ${taskId}. Please revise the plan from there.`
                                        );
                                    } else {
                                        console.warn('[chat] retry-from-task not yet wired:', taskId);
                                    }
                                }}
                            />
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
