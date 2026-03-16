'use client';

import React, { useId } from 'react';
import * as RadixLabel from '@radix-ui/react-label';
import { cn } from '@/lib/utils';

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
    label?: string;
    error?: string;
}

export function Textarea({ label, error, className, ...props }: TextareaProps) {
    const defaultId = useId();
    const id = props.id || defaultId;

    return (
        <div className="space-y-2 flex-1">
            {label && (
                <RadixLabel.Root
                    className="text-[10px] font-bold text-content-tertiary uppercase tracking-[0.1em] pl-1 flex items-center gap-1.5 opacity-80 h-5 leading-none cursor-pointer"
                    htmlFor={id}
                >
                    {label}
                    {props.required && <span className="text-accent-primary leading-none">*</span>}
                </RadixLabel.Root>
            )}
            <textarea
                {...props}
                id={id}
                className={cn(
                    "w-full min-h-[100px] px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-content-primary text-sm focus:outline-none focus:border-accent-primary/50 focus:ring-4 focus:ring-accent-primary/10 transition-all placeholder:text-content-tertiary/30 disabled:opacity-40 disabled:cursor-not-allowed resize-y",
                    error && "border-red-500/50 focus:border-red-500/50 focus:ring-red-500/10",
                    className
                )}
            />
            {error && <p className="text-[10px] text-red-500 pl-1 font-medium">{error}</p>}
        </div>
    );
}
