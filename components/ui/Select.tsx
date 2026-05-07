'use client';

import React from 'react';
import * as RadixSelect from '@radix-ui/react-select';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SelectOption {
    id: string;
    display_name: string;
    /** Optional left-side icon URL (e.g. provider logo). */
    icon_url?: string | null;
    /** Optional right-side content (e.g. cost badge). Plain string or any node. */
    meta?: React.ReactNode;
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

function OptionIcon({ url, size }: { url?: string | null; size: number }) {
    if (!url) return null;
    return (
        <span
            className="shrink-0 inline-flex items-center justify-center rounded-md overflow-hidden bg-white/5 border border-white/10"
            style={{ width: size, height: size }}
        >
            <img src={url} alt="" className="w-full h-full object-contain p-[2px]" />
        </span>
    );
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
    const selected = options.find((o) => o.id === value);
    const triggerIconSize = isMinimal ? 16 : 20;
    const itemIconSize = isMinimal ? 16 : 20;

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
                        'w-full bg-white/5 border border-white/10 rounded-xl text-content-primary flex items-center gap-2 transition-colors hover:bg-white/10 outline-none focus-visible:border-accent-primary/50 focus-visible:ring-4 focus-visible:ring-accent-primary/10 data-[state=open]:border-accent-primary/50 data-[state=open]:ring-4 data-[state=open]:ring-accent-primary/10 disabled:opacity-40 disabled:cursor-not-allowed',
                        isMinimal ? 'h-8 px-2 text-xs rounded-lg' : 'h-11 px-4 py-2 text-sm',
                        error && 'border-red-500/50 focus-visible:border-red-500/50 focus-visible:ring-red-500/10',
                        className
                    )}
                >
                    {selected ? (
                        <>
                            <OptionIcon url={selected.icon_url} size={triggerIconSize} />
                            <span className="flex-1 text-left truncate font-semibold">{selected.display_name}</span>
                            {selected.meta && (
                                <span className="shrink-0 text-content-tertiary">{selected.meta}</span>
                            )}
                        </>
                    ) : (
                        <span className="flex-1 text-left truncate text-content-tertiary/60">{placeholder}</span>
                    )}
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
                            'popover-animate z-[100001] w-[var(--radix-select-trigger-width)] min-w-[12rem] overflow-hidden',
                            'bg-surface-primary/80 backdrop-blur-3xl border border-white/10 rounded-2xl shadow-2xl ring-1 ring-white/5'
                        )}
                        position="popper"
                        sideOffset={8}
                        collisionPadding={16}
                    >
                        <RadixSelect.Viewport className="p-1.5 space-y-0.5 max-h-[280px]">
                            {options.length === 0 ? (
                                <div className="px-3 py-3 text-xs text-content-tertiary italic">
                                    No options available
                                </div>
                            ) : (
                                options.map((opt) => (
                                    <RadixSelect.Item
                                        key={opt.id}
                                        value={opt.id}
                                        className={cn(
                                            'relative w-full px-2 py-1.5 text-left rounded-lg cursor-pointer',
                                            'flex items-center gap-2 outline-none select-none transition-colors',
                                            'text-content-primary/80',
                                            'data-[highlighted]:bg-white/5 data-[highlighted]:text-content-primary',
                                            'data-[state=checked]:text-content-primary data-[state=checked]:font-semibold',
                                            isMinimal ? 'text-xs' : 'text-sm'
                                        )}
                                    >
                                        <OptionIcon url={opt.icon_url} size={itemIconSize} />
                                        <RadixSelect.ItemText asChild>
                                            <span className="flex-1 truncate">{opt.display_name}</span>
                                        </RadixSelect.ItemText>
                                        {opt.meta && (
                                            <span className="shrink-0 text-content-tertiary">{opt.meta}</span>
                                        )}
                                        {/* Reserve a fixed-width slot for the check so meta columns align across rows. */}
                                        <span className="shrink-0 w-3.5 h-3.5 flex items-center justify-center">
                                            <RadixSelect.ItemIndicator>
                                                <Check className="w-3.5 h-3.5 text-accent-primary" strokeWidth={3} />
                                            </RadixSelect.ItemIndicator>
                                        </span>
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
