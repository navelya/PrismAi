'use client';

import React from 'react';
import * as RadixSwitch from '@radix-ui/react-switch';
import { cn } from '@/lib/utils';

interface SwitchProps {
    label?: string;
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    className?: string;
    id?: string;
    disabled?: boolean;
    size?: 'sm' | 'md';
}

export function Switch({
    label,
    checked,
    onCheckedChange,
    className,
    id,
    disabled,
    size = 'md',
}: SwitchProps) {
    const defaultId = React.useId();
    const switchId = id || defaultId;
    const isSm = size === 'sm';

    return (
        <div className={cn("flex items-center gap-3 group select-none", isSm && "gap-2", className)}>
            <RadixSwitch.Root
                id={switchId}
                checked={checked}
                onCheckedChange={onCheckedChange}
                disabled={disabled}
                className={cn(
                    "rounded-full relative bg-white/5 border border-white/10 transition-all focus:outline-none focus:ring-4 focus:ring-accent-primary/10",
                    "data-[state=checked]:bg-accent-primary/20 data-[state=checked]:border-accent-primary/30",
                    "disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer",
                    isSm ? "w-8 h-[18px]" : "w-12 h-7"
                )}
            >
                <RadixSwitch.Thumb
                    className={cn(
                        "block bg-content-tertiary rounded-full shadow-lg transition-transform duration-200 will-change-transform",
                        "data-[state=checked]:bg-accent-primary",
                        isSm
                            ? "w-3 h-3 translate-x-0.5 data-[state=checked]:translate-x-[14px]"
                            : "w-5 h-5 translate-x-1 data-[state=checked]:translate-x-6"
                    )}
                />
            </RadixSwitch.Root>
            {label && (
                <label
                    htmlFor={switchId}
                    className={cn(
                        "text-xs font-bold text-content-tertiary uppercase tracking-tight cursor-pointer",
                        "group-hover:text-content-primary transition-colors",
                        checked && "text-content-primary",
                        disabled && "cursor-not-allowed opacity-40"
                    )}
                >
                    {label}
                </label>
            )}
        </div>
    );
}
