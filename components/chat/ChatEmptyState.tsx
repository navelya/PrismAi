'use client';

import React from 'react';
import { ImagePlus, Pen, Sparkles, Wand2, Workflow as WorkflowIcon, MessageCircleQuestion, ArrowRight } from 'lucide-react';
import ChatInput from './ChatInput';
import { Toast } from '@/components/ui/Toast';
import type { Character } from '@/lib/api/client';

/**
 * Capability cards for the welcome screen. Each teaches one thing Prisfol can
 * do and, on click, seeds the composer with a starter prompt the user can edit
 * and send. They give the otherwise-empty welcome screen a clear "here's what
 * you can do, pick one to begin" purpose without burying the composer.
 */
const CAPABILITY_CARDS: {
    icon: typeof Sparkles;
    title: string;
    description: string;
    prompt: string;
}[] = [
    {
        icon: Sparkles,
        title: 'Generate',
        description: 'Create images & video from a description.',
        prompt: 'Generate a cinematic product shot of ',
    },
    {
        icon: Wand2,
        title: 'Edit & retouch',
        description: 'Remove backgrounds, swap outfits, fix lighting.',
        prompt: 'Remove the background from my photo and ',
    },
    {
        icon: WorkflowIcon,
        title: 'Automate',
        description: 'Chain steps to process many images at once.',
        prompt: 'Build a workflow to upscale and watermark a batch of photos',
    },
    {
        icon: MessageCircleQuestion,
        title: 'Get guidance',
        description: 'Not sure where to start? Ask what is possible.',
        prompt: 'What can I build with Prisfol?',
    },
];

interface ChatInputProps {
    value: string;
    onChange: (v: string) => void;
    disabled?: boolean;
    onSend: () => void;
    onStop: () => void;
    isLoading: boolean;
    onOpenImagePicker: () => void;
    onToggleVoice: () => void;
    isVoiceActive: boolean;
    isCanvasMode: boolean;
    attachedImages: string[];
    onRemoveAttachedImage: (index: number) => void;
    hasMessages?: boolean;
    onMentionedCharactersChange: (chars: Character[]) => void;
}

interface ChatEmptyStateProps {
    userName?: string;
    isMobile: boolean;
    isDragOver: boolean;
    onDragOver: React.DragEventHandler<HTMLDivElement>;
    onDragLeave: React.DragEventHandler<HTMLDivElement>;
    onDrop: React.DragEventHandler<HTMLDivElement>;
    imageInputRef: React.RefObject<HTMLInputElement>;
    onImageInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    chatInputProps: ChatInputProps;
    textareaRef: React.Ref<HTMLTextAreaElement>;
    onCreateNewSession: () => void;
    onSuggestionClick: (prompt: string) => void;
    evictionToast?: boolean;
    evictionToastMessage?: string;
    onDismissEvictionToast?: () => void;
}

export function ChatEmptyState({
    userName,
    isMobile,
    isDragOver,
    onDragOver,
    onDragLeave,
    onDrop,
    imageInputRef,
    onImageInputChange,
    chatInputProps,
    textareaRef,
    onCreateNewSession,
    onSuggestionClick,
    evictionToast,
    evictionToastMessage,
    onDismissEvictionToast,
}: ChatEmptyStateProps) {
    if (!isMobile) {
        return (
            <div
                className="relative flex flex-col h-full bg-surface-primary"
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
            >
                <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={onImageInputChange}
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

                <div className="flex-1 flex items-center justify-center p-6 overflow-y-auto">
                    <div className="w-full max-w-2xl chat-text-fade-in">
                        {/* Greeting */}
                        <div className="flex flex-col items-center text-center mb-7">
                            <div className="w-12 h-12 mb-4 rounded-2xl bg-gradient-to-br from-accent-primary/25 to-accent-primary/5 border border-accent-primary/20 flex items-center justify-center shadow-lg shadow-accent-primary/10">
                                <Sparkles className="w-6 h-6 text-accent-primary" strokeWidth={2} />
                            </div>
                            <h1 className="text-3xl font-bold text-content-primary tracking-tight">
                                {userName ? `Welcome, ${userName.trim().split(" ")[0].replace(/^./, c => c.toUpperCase())}` : 'Welcome to Prisfol'}
                            </h1>
                            <p className="text-content-secondary mt-2 max-w-md">
                                Describe what you want to create and I&apos;ll build the workflow — or pick a starting point below.
                            </p>
                        </div>

                        {/* Composer — the primary action */}
                        <ChatInput ref={textareaRef} {...chatInputProps} hasMessages={false} />

                        {/* Capability cards — what you can do, click to start */}
                        <div className="mt-7 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {CAPABILITY_CARDS.map(({ icon: Icon, title, description, prompt }) => (
                                <button
                                    key={title}
                                    type="button"
                                    onClick={() => onSuggestionClick(prompt)}
                                    className="group flex items-start gap-3 p-3.5 text-left rounded-2xl
                                               bg-surface-secondary/60 hover:bg-surface-secondary
                                               border border-stroke-subtle hover:border-accent-primary/40
                                               transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-black/20"
                                >
                                    <span className="shrink-0 w-9 h-9 rounded-xl bg-accent-primary/10 group-hover:bg-accent-primary/15 border border-accent-primary/15 flex items-center justify-center transition-colors">
                                        <Icon className="w-[18px] h-[18px] text-accent-primary" strokeWidth={2} />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="flex items-center gap-1.5 text-sm font-medium text-content-primary">
                                            {title}
                                            <ArrowRight className="w-3.5 h-3.5 text-content-tertiary opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200" />
                                        </span>
                                        <span className="block text-xs text-content-secondary mt-0.5 leading-relaxed">
                                            {description}
                                        </span>
                                    </span>
                                </button>
                            ))}
                        </div>

                        {/* Secondary: skip the chat and open a blank canvas */}
                        <div className="mt-6 flex justify-center">
                            <button
                                onClick={onCreateNewSession}
                                className="group inline-flex items-center gap-2 px-3 py-1.5 text-sm text-content-tertiary hover:text-content-primary transition-colors"
                            >
                                <Pen className="w-3.5 h-3.5" />
                                Prefer a blank slate? Start an empty canvas
                                <ArrowRight className="w-3.5 h-3.5 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // Mobile variant
    return (
        <div
            className="relative flex flex-col h-full bg-surface-primary"
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
        >
            <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={onImageInputChange}
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
                        <h1 className="text-xl font-bold text-content-primary">
                            {userName ? `Welcome, ${userName.trim().split(" ")[0].replace(/^./, c => c.toUpperCase())}` : 'Welcome to Prisfol'}
                        </h1>
                    </div>
                    <p className="text-content-secondary text-sm">
                        Tell me what you'd like to do with images, or start from scratch.
                    </p>

                    <div className="mt-6 flex justify-center">
                        <button
                            onClick={onCreateNewSession}
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
                <ChatInput ref={textareaRef} {...chatInputProps} hasMessages={false} />
            </div>
            {evictionToast && (
                <Toast
                    message={evictionToastMessage ?? ''}
                    duration={4000}
                    onClose={onDismissEvictionToast ?? (() => {})}
                />
            )}
        </div>
    );
}
