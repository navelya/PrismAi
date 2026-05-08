'use client';

import React, { useState, useEffect } from 'react';
import { Camera, Megaphone, Workflow as WorkflowIcon, HelpCircle, MessageCircleMore } from 'lucide-react';
import { Skeleton } from '@/components/ui/Skeleton';

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

export function WorkflowEmptyState({
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
