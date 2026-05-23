'use client';

import React from 'react';
import { cn } from '@/lib/utils';

export interface PillTabItem<V extends string = string> {
    value: V;
    label: string;
    icon?: React.ComponentType<{ className?: string }>;
    /** Dim and disable the tab — non-clickable, with an optional hover hint. */
    disabled?: boolean;
    /** Tooltip shown on hover (e.g. "Coming soon" for a disabled tab). */
    title?: string;
}

interface PillTabsProps<V extends string = string> {
    items: PillTabItem<V>[];
    value: V;
    onChange: (value: V) => void;
    className?: string;
    size?: 'sm' | 'md';
}

export function PillTabs<V extends string = string>({
    items,
    value,
    onChange,
    className,
    size = 'sm',
}: PillTabsProps<V>) {
    const isSm = size === 'sm';
    return (
        <div
            className={cn(
                'inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-white/5 border border-white/10',
                className
            )}
            role="tablist"
        >
            {items.map((item) => {
                const Icon = item.icon;
                const active = item.value === value;
                const disabled = !!item.disabled;
                return (
                    <button
                        key={item.value}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        aria-disabled={disabled}
                        disabled={disabled}
                        title={item.title}
                        onClick={() => { if (!disabled) onChange(item.value); }}
                        className={cn(
                            'flex items-center gap-1 rounded-md font-semibold transition-all whitespace-nowrap',
                            isSm ? 'h-6 px-2 text-[10px]' : 'h-7 px-2.5 text-[11px]',
                            disabled
                                ? 'text-content-tertiary/40 cursor-not-allowed'
                                : active
                                    ? 'bg-white/10 text-content-primary shadow-sm'
                                    : 'text-content-tertiary hover:text-content-primary hover:bg-white/5'
                        )}
                    >
                        {Icon && <Icon className={cn(isSm ? 'w-3 h-3' : 'w-3.5 h-3.5')} />}
                        <span>{item.label}</span>
                    </button>
                );
            })}
        </div>
    );
}
