'use client';

import React from 'react';
import * as RadixCheckbox from '@radix-ui/react-checkbox';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CheckboxProps {
    label: string;
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
    className?: string;
    id?: string;
    disabled?: boolean;
}

export function Checkbox({
    label,
    checked,
    onCheckedChange,
    className,
    id,
    disabled
}: CheckboxProps) {
    const defaultId = React.useId();
    const checkboxId = id || defaultId;

    return (
        <div className={cn("flex items-center gap-3 group select-none", className)}>
            <div className="relative flex items-center justify-center">
                <RadixCheckbox.Root
                    id={checkboxId}
                    checked={checked}
                    onCheckedChange={onCheckedChange}
                    disabled={disabled}
                    className={cn(
                        "w-5 h-5 flex items-center justify-center rounded-lg bg-white/5 border-2 border-white/10 transition-all",
                        "hover:border-white/20 focus:outline-none focus:ring-4 focus:ring-accent-primary/10",
                        "data-[state=checked]:bg-accent-primary data-[state=checked]:border-accent-primary",
                        "disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                    )}
                >
                    <RadixCheckbox.Indicator className="text-white animate-in zoom-in-50 duration-200">
                        <Check className="w-3.5 h-3.5" strokeWidth={3} />
                    </RadixCheckbox.Indicator>
                </RadixCheckbox.Root>
            </div>
            {label && (
                <label
                    htmlFor={checkboxId}
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
