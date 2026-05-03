'use client';

import React from 'react';
import * as RadixSelect from '@radix-ui/react-select';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SelectOption {
    id: string;
    display_name: string;
}

interface SelectProps {
    label?: string;
    error?: string;
    options: SelectOption[];
    value: string;
    onChange: (e: { target: { value: string; name?: string } }) => void;
    className?: string;
    name?: string;
    disabled?: boolean;
    placeholder?: string;
    required?: boolean;
    variant?: 'default' | 'minimal';
}

export function Select({
    label,
    error,
    options,
    value,
    onChange,
    className,
    name,
    disabled,
    placeholder = 'Select option...',
    required = false,
    variant = 'default',
}: SelectProps) {
    const isMinimal = variant === 'minimal';

    return (
        <div className={cn("space-y-2 flex-1", isMinimal && "space-y-1")}>
            {label && (
                <label className={cn(
                    "font-bold text-content-tertiary uppercase tracking-[0.1em] pl-1 flex items-center gap-1.5 opacity-80 h-5 leading-none",
                    isMinimal ? "text-[8px]" : "text-[10px]"
                )}>
                    {label}
                    {required && <span className="text-accent-primary leading-none">*</span>}
                </label>
            )}

            <RadixSelect.Root
                value={value || ''}
                onValueChange={(val) => onChange({ target: { value: val, name } })}
                disabled={disabled}
            >
                <RadixSelect.Trigger
                    aria-label={label}
                    className={cn(
                        'w-full bg-white/5 border border-white/10 rounded-xl text-content-primary flex items-center justify-between transition-all hover:bg-white/10 focus:outline-none focus:border-accent-primary/50 focus:ring-4 focus:ring-accent-primary/10 data-[state=open]:border-accent-primary/50 data-[state=open]:ring-4 data-[state=open]:ring-accent-primary/10 disabled:opacity-40 disabled:cursor-not-allowed',
                        isMinimal ? 'h-8 px-2 text-xs rounded-lg' : 'h-11 px-4 py-2 text-sm',
                        error && 'border-red-500/50 focus:border-red-500/50 focus:ring-red-500/10',
                        className
                    )}
                >
                    <RadixSelect.Value placeholder={placeholder} />
                    <RadixSelect.Icon asChild>
                        <ChevronDown className={cn(
                            "text-content-tertiary transition-transform duration-300 data-[state=open]:rotate-180 data-[state=open]:text-accent-primary shrink-0",
                            isMinimal ? "w-3 h-3" : "w-4 h-4"
                        )} />
                    </RadixSelect.Icon>
                </RadixSelect.Trigger>

                <RadixSelect.Portal>
                    <RadixSelect.Content
                        className={cn(
                            'z-[100001] w-[var(--radix-select-trigger-width)] min-w-[8rem] overflow-hidden',
                            'bg-surface-primary/80 backdrop-blur-3xl border border-white/10 rounded-2xl shadow-2xl ring-1 ring-white/5',
                            'data-[state=open]:animate-in data-[state=closed]:animate-out',
                            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
                            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
                            'data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2'
                        )}
                        position="popper"
                        sideOffset={8}
                        collisionPadding={16}
                    >
                        <RadixSelect.Viewport className="p-1.5 space-y-0.5 max-h-[240px]">
                            {options.length === 0 ? (
                                <div className="px-4 py-3 text-xs text-content-tertiary italic">
                                    No options available
                                </div>
                            ) : (
                                options.map((opt) => (
                                    <RadixSelect.Item
                                        key={opt.id}
                                        value={opt.id}
                                        className={cn(
                                            'relative w-full px-3 py-2 text-left text-sm rounded-lg cursor-pointer',
                                            'flex items-center justify-between outline-none select-none',
                                            'text-content-primary/70 transition-colors',
                                            'data-[highlighted]:bg-white/5 data-[highlighted]:text-content-primary',
                                            'data-[state=checked]:bg-accent-primary/10 data-[state=checked]:text-accent-primary data-[state=checked]:font-bold'
                                        )}
                                    >
                                        <RadixSelect.ItemText>{opt.display_name}</RadixSelect.ItemText>
                                        <RadixSelect.ItemIndicator>
                                            <div className="w-1.5 h-1.5 rounded-full bg-accent-primary shadow-[0_0_8px_rgba(var(--accent-primary-rgb),0.5)]" />
                                        </RadixSelect.ItemIndicator>
                                    </RadixSelect.Item>
                                ))
                            )}
                        </RadixSelect.Viewport>
                    </RadixSelect.Content>
                </RadixSelect.Portal>
            </RadixSelect.Root>

            {error && <p className="text-[10px] text-red-500 pl-1 font-medium">{error}</p>}
        </div>
    );
}
