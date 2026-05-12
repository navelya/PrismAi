'use client';

import React from 'react';
import { ImagePlus, Pen, Sparkles } from 'lucide-react';
import ChatInput from './ChatInput';
import { Toast } from '@/components/ui/Toast';

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
    imageTooLargeToast?: boolean;
    imageTooLargeToastMessage?: string;
    onDismissImageTooLargeToast?: () => void;
    videoTooLargeToast?: boolean;
    videoTooLargeToastMessage?: string;
    onDismissVideoTooLargeToast?: () => void;
    videoUploadFailedToast?: boolean;
    videoUploadFailedToastMessage?: string;
    onDismissVideoUploadFailedToast?: () => void;
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
    imageTooLargeToast,
    imageTooLargeToastMessage,
    onDismissImageTooLargeToast,
    videoTooLargeToast,
    videoTooLargeToastMessage,
    onDismissVideoTooLargeToast,
    videoUploadFailedToast,
    videoUploadFailedToastMessage,
    onDismissVideoUploadFailedToast,
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
                    accept="image/*,video/*"
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

                        <ChatInput ref={textareaRef} {...chatInputProps} hasMessages={false} />

                        <div className="mt-8 flex flex-wrap justify-center gap-2">
                            <button
                                onClick={onCreateNewSession}
                                className="px-4 py-2 text-sm bg-accent-primary hover:bg-accent-hover text-white flex items-center gap-2
                                           rounded-full transition-colors font-medium shadow-md shadow-accent-primary/20"
                            >
                                <Pen className="w-4 h-4" />
                                Start Empty Canvas
                            </button>
                            {['Find 10 cat images', 'Remove backgrounds', 'Upscale my photos'].map((prompt) => (
                                <button
                                    key={prompt}
                                    onClick={() => onSuggestionClick(prompt)}
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
                accept="image/*,video/*"
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
            {imageTooLargeToast && (
                <Toast
                    message={imageTooLargeToastMessage ?? ''}
                    duration={4000}
                    onClose={onDismissImageTooLargeToast ?? (() => {})}
                />
            )}
            {videoTooLargeToast && (
                <Toast
                    message={videoTooLargeToastMessage ?? ''}
                    duration={4000}
                    onClose={onDismissVideoTooLargeToast ?? (() => {})}
                />
            )}
            {videoUploadFailedToast && (
                <Toast
                    message={videoUploadFailedToastMessage ?? ''}
                    duration={4000}
                    onClose={onDismissVideoUploadFailedToast ?? (() => {})}
                />
            )}
        </div>
    );
}
