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
}

export function Switch({
    label,
    checked,
    onCheckedChange,
    className,
    id,
    disabled
}: SwitchProps) {
    const defaultId = React.useId();
    const switchId = id || defaultId;

    return (
        <div className={cn("flex items-center gap-3 group select-none", className)}>
            <RadixSwitch.Root
                id={switchId}
                checked={checked}
                onCheckedChange={onCheckedChange}
                disabled={disabled}
                className={cn(
                    "w-12 h-7 rounded-full relative bg-white/5 border border-white/10 transition-all focus:outline-none focus:ring-4 focus:ring-accent-primary/10",
                    "data-[state=checked]:bg-accent-primary/20 data-[state=checked]:border-accent-primary/30",
                    "disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                )}
            >
                <RadixSwitch.Thumb
                    className={cn(
                        "block w-5 h-5 bg-content-tertiary rounded-full shadow-lg transition-transform duration-200 translate-x-1 will-change-transform",
                        "data-[state=checked]:translate-x-6 data-[state=checked]:bg-accent-primary"
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
