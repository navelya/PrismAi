'use client';

import React, { useId } from 'react';
import * as RadixLabel from '@radix-ui/react-label';
import { cn } from '@/lib/utils';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    error?: string;
    variant?: 'default' | 'minimal';
    /** Optional node rendered next to the label (e.g. a description info icon). */
    labelAccessory?: React.ReactNode;
}

export function Input({ label, error, className, variant = 'default', labelAccessory, ...props }: InputProps) {
    const defaultId = useId();
    const id = props.id || defaultId;
    const isMinimal = variant === 'minimal';

    return (
        <div className={cn("space-y-2 flex-1", isMinimal && "space-y-1")}>
            {label && (
                <RadixLabel.Root
                    className={cn(
                        "font-bold text-content-tertiary uppercase tracking-[0.1em] pl-1 flex items-center gap-1.5 opacity-80 h-5 leading-none cursor-pointer",
                        isMinimal ? "text-[8px]" : "text-[10px]"
                    )}
                    htmlFor={id}
                >
                    {label}
                    {props.required && <span className="text-accent-primary leading-none">*</span>}
                    {labelAccessory}
                </RadixLabel.Root>
            )}
            <input
                {...props}
                id={id}
                className={cn(
                    "w-full bg-white/5 border border-white/10 rounded-xl text-content-primary focus:outline-none focus:border-accent-primary/50 focus:ring-4 focus:ring-accent-primary/10 transition-all placeholder:text-content-tertiary/30 disabled:opacity-40 disabled:cursor-not-allowed",
                    isMinimal ? "h-8 px-2 text-xs rounded-lg" : "h-11 px-4 py-2 text-sm",
                    error && "border-red-500/50 focus:border-red-500/50 focus:ring-red-500/10",
                    className
                )}
            />
            {error && <p className="text-[10px] text-red-500 pl-1 font-medium">{error}</p>}
        </div>
    );
}
