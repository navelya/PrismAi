'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    error?: string;
}

export function Input({ label, error, className, ...props }: InputProps) {
    return (
        <div className="space-y-2 flex-1">
            {label && (
                <label className="text-[10px] font-bold text-content-tertiary uppercase tracking-[0.1em] pl-1 flex items-center gap-1.5 opacity-80 decoration-none">
                    {label}
                    {props.required && <span className="text-accent-primary">*</span>}
                </label>
            )}
            <input
                {...props}
                className={cn(
                    "w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-content-primary text-sm focus:outline-none focus:border-accent-primary/50 focus:ring-4 focus:ring-accent-primary/10 transition-all placeholder:text-content-tertiary/30 disabled:opacity-40 disabled:cursor-not-allowed",
                    error && "border-red-500/50 focus:border-red-500/50 focus:ring-red-500/10",
                    className
                )}
            />
            {error && <p className="text-[10px] text-red-500 pl-1 font-medium">{error}</p>}
        </div>
    );
}
