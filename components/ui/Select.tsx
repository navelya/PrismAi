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
    /** Optional left-side icon React node — alternative to icon_url. */
    icon?: React.ReactNode;
    /** Optional secondary line shown under display_name in the dropdown list (not in the trigger). */
    subtitle?: string;
    /** Optional right-side content (e.g. cost badge). Plain string or any node. */
    meta?: React.ReactNode;
    /** Disabled options can't be selected; their label dims and the cursor turns not-allowed. */
    disabled?: boolean;
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
    /** Optional node rendered next to the label (e.g. a description info icon). */
    labelAccessory?: React.ReactNode;
    /**
     * Custom trigger element. When provided, replaces the built-in trigger entirely
     * (label/error chrome is also skipped). Must be a single React element that
     * accepts forwarded refs/props (typically a `<button>`). The dropdown still
     * portals to body and matches the trigger width, so set width via the trigger.
     */
    triggerNode?: React.ReactElement;
    /** Optional controlled open state. */
    open?: boolean;
    /** Called when open state should change. Required when `open` is provided. */
    onOpenChange?: (open: boolean) => void;
    /**
     * Forwarded to RadixSelect.Content. Lets a parent inspect outside-pointer-down
     * events (e.g. to detect a click on a sibling dropdown trigger and switch
     * which menu is open in a single interaction — Radix Select otherwise
     * disables pointer events on the rest of the page while open).
     */
    onPointerDownOutside?: (event: CustomEvent<{ originalEvent: PointerEvent }>) => void;
}

function OptionIcon({ icon, url, size }: { icon?: React.ReactNode; url?: string | null; size: number }) {
    if (!icon && !url) return null;
    return (
        <span
            className="shrink-0 inline-flex items-center justify-center rounded-md overflow-hidden bg-white/5 border border-white/10"
            style={{ width: size, height: size }}
        >
            {icon ? icon : <img src={url!} alt="" className="w-full h-full object-contain p-[2px]" />}
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
    labelAccessory,
    triggerNode,
    open,
    onOpenChange,
    onPointerDownOutside,
}: SelectProps) {
    const isMinimal = variant === 'minimal';
    const selected = options.find((o) => o.id === value);
    const triggerIconSize = isMinimal ? 16 : 20;
    const itemIconSize = isMinimal ? 16 : 20;

    const content = (
        <RadixSelect.Portal>
            <RadixSelect.Content
                className={cn(
                    'popover-animate z-[100001] overflow-hidden',
                    triggerNode
                        ? 'min-w-[14rem]'
                        : 'w-[var(--radix-select-trigger-width)] min-w-[12rem]',
                    'bg-surface-primary/80 backdrop-blur-3xl border border-white/10 rounded-2xl shadow-2xl ring-1 ring-white/5'
                )}
                position="popper"
                sideOffset={8}
                collisionPadding={16}
                onPointerDownOutside={onPointerDownOutside as any}
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
                                disabled={opt.disabled}
                                className={cn(
                                    'relative w-full px-2 py-1.5 text-left rounded-lg cursor-pointer',
                                    'flex items-center gap-2 outline-none select-none transition-colors',
                                    'text-content-primary/80',
                                    'data-[highlighted]:bg-white/5 data-[highlighted]:text-content-primary',
                                    'data-[state=checked]:text-content-primary data-[state=checked]:font-semibold',
                                    'data-[disabled]:opacity-50 data-[disabled]:cursor-not-allowed data-[disabled]:hover:bg-transparent',
                                    isMinimal ? 'text-xs' : 'text-sm'
                                )}
                            >
                                <OptionIcon icon={opt.icon} url={opt.icon_url} size={itemIconSize} />
                                <div className="flex-1 min-w-0">
                                    <RadixSelect.ItemText asChild>
                                        <span className="block truncate leading-tight">{opt.display_name}</span>
                                    </RadixSelect.ItemText>
                                    {opt.subtitle && (
                                        <span className="block truncate text-[10px] font-normal text-content-tertiary leading-tight mt-0.5">
                                            {opt.subtitle}
                                        </span>
                                    )}
                                </div>
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
    );

    // Custom-trigger mode: caller owns the button styling; we skip the wrapper/label/error chrome.
    if (triggerNode) {
        return (
            <RadixSelect.Root
                value={value || ''}
                onValueChange={(val) => onChange({ target: { value: val, name } })}
                disabled={disabled}
                open={open}
                onOpenChange={onOpenChange}
            >
                <RadixSelect.Trigger asChild aria-label={label}>
                    {triggerNode}
                </RadixSelect.Trigger>
                {content}
            </RadixSelect.Root>
        );
    }

    return (
        <div className={cn("space-y-2 flex-1", isMinimal && "space-y-1")}>
            {label && (
                <label className={cn(
                    "font-bold text-content-tertiary uppercase tracking-[0.1em] pl-1 flex items-center gap-1.5 opacity-80 h-5 leading-none",
                    isMinimal ? "text-[8px]" : "text-[10px]"
                )}>
                    {label}
                    {required && <span className="text-accent-primary leading-none">*</span>}
                    {labelAccessory}
                </label>
            )}

            <RadixSelect.Root
                value={value || ''}
                onValueChange={(val) => onChange({ target: { value: val, name } })}
                disabled={disabled}
                open={open}
                onOpenChange={onOpenChange}
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
                            <OptionIcon icon={selected.icon} url={selected.icon_url} size={triggerIconSize} />
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

                {content}
            </RadixSelect.Root>

            {error && <p className="text-[10px] text-red-500 pl-1 font-medium">{error}</p>}
        </div>
    );
}
