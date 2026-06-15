'use client';

import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NumberInput } from './NumberInput';

interface AspectRatioPickerProps {
    label?: string;
    value: string;
    options?: string[];
    onChange: (value: string) => void;
    variant?: 'default' | 'minimal';
    /** Optional controlled custom-mode flag. Lets the parent drive the toggle so it
     *  can use the same signal (e.g. to hide linked width/height controls). */
    isCustom?: boolean;
    onCustomChange?: (isCustom: boolean) => void;
}

/** Exported so the property panel can use the same detection rule. */
export function isCustomAspectFormat(value: string): boolean {
    return isCustomFormat(value);
}

interface PresetMeta {
    value: string;
    label: string;
    descriptor: string;
    width: number;
    height: number;
}

// Replicate uses both `match_input_image` (Flux family) and `auto` (others)
// as the "match input" sentinel — include both so the picker filters correctly
// against whatever the model schema declares.
const PRESETS: PresetMeta[] = [
    { value: 'match_input_image', label: 'Auto', descriptor: 'Match Input', width: 16, height: 12 },
    { value: 'auto', label: 'Auto', descriptor: 'Match Input', width: 16, height: 12 },
    { value: '1:1', label: '1:1', descriptor: 'Square', width: 12, height: 12 },
    { value: '2:3', label: '2:3', descriptor: 'Portrait', width: 10, height: 14 },
    { value: '3:2', label: '3:2', descriptor: 'Standard', width: 14, height: 10 },
    { value: '3:4', label: '3:4', descriptor: 'Traditional', width: 10, height: 13 },
    { value: '4:3', label: '4:3', descriptor: 'Classic', width: 13, height: 10 },
    { value: '4:5', label: '4:5', descriptor: 'Social Post', width: 11, height: 13 },
    { value: '5:4', label: '5:4', descriptor: '', width: 13, height: 11 },
    { value: '9:16', label: '9:16', descriptor: 'Social Story', width: 8, height: 14 },
    { value: '16:9', label: '16:9', descriptor: 'Widescreen', width: 16, height: 9 },
    { value: '9:21', label: '9:21', descriptor: 'Tall', width: 6, height: 14 },
    { value: '21:9', label: '21:9', descriptor: 'Ultrawide', width: 16, height: 7 },
];

function getMeta(value: string): PresetMeta | null {
    return PRESETS.find(p => p.value === value) || null;
}

function isCustomFormat(value: string): boolean {
    if (!value) return false;
    if (value === 'match_input_image' || value === 'auto') return false;
    return /^\d+:\d+$/.test(value) && !PRESETS.some(p => p.value === value);
}

function parseCustom(value: string): [number, number] {
    const m = value.match(/^(\d+):(\d+)$/);
    if (!m) return [16, 9];
    return [parseInt(m[1]), parseInt(m[2])];
}

function RatioIcon({ width, height, active }: { width: number; height: number; active?: boolean }) {
    const max = 14;
    const w = (width / Math.max(width, height)) * max;
    const h = (height / Math.max(width, height)) * max;
    return (
        <div
            className={cn(
                "border rounded-[2px] shrink-0",
                active ? "border-accent-primary" : "border-content-tertiary opacity-60"
            )}
            style={{ width: `${w}px`, height: `${h}px` }}
            aria-hidden
        />
    );
}

export function AspectRatioPicker({
    label,
    value,
    options,
    onChange,
    variant = 'default',
    isCustom,
    onCustomChange,
}: AspectRatioPickerProps) {
    const [open, setOpen] = useState(false);
    const [internalCustomMode, setInternalCustomMode] = useState(() => isCustomFormat(value));
    const customMode = isCustom !== undefined ? isCustom : internalCustomMode;
    const setCustomMode = (next: boolean) => {
        if (onCustomChange) onCustomChange(next);
        if (isCustom === undefined) setInternalCustomMode(next);
    };
    const [customW, setCustomW] = useState<string>('16');
    const [customH, setCustomH] = useState<string>('9');
    const containerRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const isMinimal = variant === 'minimal';

    // The dropdown is portaled to <body> with fixed positioning so it is never
    // clipped by an `overflow` ancestor (e.g. the property panel's scroll area).
    // It opens below the trigger when there's room, and flips above when there
    // isn't — so the full menu stays visible even spilling outside the panel.
    const [menuPos, setMenuPos] = useState<{
        left: number;
        width: number;
        top?: number;
        bottom?: number;
        maxHeight: number;
    } | null>(null);

    const updateMenuPos = () => {
        const el = triggerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const margin = 8;
        const spaceBelow = window.innerHeight - rect.bottom - margin;
        const spaceAbove = rect.top - margin;
        const openUp = spaceBelow < 240 && spaceAbove > spaceBelow;
        setMenuPos({
            left: rect.left,
            width: rect.width,
            ...(openUp
                ? { bottom: window.innerHeight - rect.top + 4 }
                : { top: rect.bottom + 4 }),
            maxHeight: Math.max(160, (openUp ? spaceAbove : spaceBelow) - 4),
        });
    };

    // Recompute placement when the menu opens, and keep it pinned to the trigger
    // while scrolling/resizing (capture phase catches the panel's own scroll).
    useLayoutEffect(() => {
        if (!open) { setMenuPos(null); return; }
        updateMenuPos();
        window.addEventListener('scroll', updateMenuPos, true);
        window.addEventListener('resize', updateMenuPos);
        return () => {
            window.removeEventListener('scroll', updateMenuPos, true);
            window.removeEventListener('resize', updateMenuPos);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open]);

    const availablePresets = options && options.length
        ? PRESETS.filter(p => options.includes(p.value))
        : PRESETS.filter(p => p.value !== 'auto'); // dedupe Auto when no schema constraints

    // Custom mode is a local UI flag because a Custom W:H value (e.g. "16:9")
    // can collide with a preset string. Without this flag, picking Custom would
    // be indistinguishable from picking the matching preset.
    const showCustom = customMode || isCustomFormat(value);

    useEffect(() => {
        if (isCustomFormat(value)) {
            const [w, h] = parseCustom(value);
            setCustomW(String(w));
            setCustomH(String(h));
            setCustomMode(true);
        }
        // value matching a preset doesn't auto-clear customMode — the parent
        // (or the preset-button click) is the only source for clearing it,
        // because a custom W:H may legitimately equal a preset string.
    }, [value]);

    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            const target = e.target as Node;
            // The menu is portaled outside containerRef, so check both.
            if (!containerRef.current?.contains(target) && !dropdownRef.current?.contains(target)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    const currentMeta = !showCustom ? getMeta(value) : null;
    const triggerLabel = showCustom
        ? 'Custom'
        : currentMeta
            ? `${currentMeta.label}${currentMeta.descriptor ? ' ' + currentMeta.descriptor : ''}`
            : (value || 'Select…');

    const handleSelectPreset = (preset: PresetMeta) => {
        setCustomMode(false);
        onChange(preset.value);
        setOpen(false);
    };

    const handleSelectCustom = () => {
        const w = parseInt(customW) || 16;
        const h = parseInt(customH) || 9;
        setCustomMode(true);
        onChange(`${w}:${h}`);
        setOpen(false);
    };

    const handleCustomChange = (w: string, h: string) => {
        setCustomW(w);
        setCustomH(h);
        const wn = parseInt(w);
        const hn = parseInt(h);
        if (Number.isFinite(wn) && Number.isFinite(hn) && wn > 0 && hn > 0) {
            onChange(`${wn}:${hn}`);
        }
    };

    return (
        <div className="space-y-1 relative" ref={containerRef}>
            {label && (
                <label className={cn(
                    "font-bold text-content-tertiary uppercase tracking-[0.1em] pl-0.5 leading-none opacity-80 block",
                    isMinimal ? "text-[8px]" : "text-[10px]"
                )}>
                    {label}
                </label>
            )}

            <button
                ref={triggerRef}
                type="button"
                onClick={() => setOpen(o => !o)}
                className={cn(
                    "w-full bg-white/5 border border-white/10 rounded-lg text-content-primary focus:outline-none focus:border-accent-primary/50 focus:ring-4 focus:ring-accent-primary/10 transition-all flex items-center justify-between gap-2 hover:border-white/20",
                    open && "border-accent-primary/50 ring-4 ring-accent-primary/10",
                    isMinimal ? "h-8 px-2 text-xs" : "h-11 px-4 text-sm"
                )}
            >
                <div className="flex items-center gap-2 min-w-0">
                    {showCustom
                        ? <RatioIcon width={parseInt(customW) || 1} height={parseInt(customH) || 1} active />
                        : currentMeta && <RatioIcon width={currentMeta.width} height={currentMeta.height} active />
                    }
                    <span className="truncate font-medium">{triggerLabel}</span>
                </div>
                <ChevronDown className={cn(
                    "text-content-tertiary opacity-60 transition-transform shrink-0",
                    open && "rotate-180",
                    isMinimal ? "w-3 h-3" : "w-4 h-4"
                )} />
            </button>

            {open && menuPos && createPortal(
                <div
                    ref={dropdownRef}
                    style={{
                        position: 'fixed',
                        left: menuPos.left,
                        width: menuPos.width,
                        top: menuPos.top,
                        bottom: menuPos.bottom,
                        maxHeight: menuPos.maxHeight,
                    }}
                    className={cn(
                        "z-[100001] bg-surface-primary/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl p-2 overflow-y-auto custom-scrollbar animate-in fade-in duration-150",
                        menuPos.bottom !== undefined ? "slide-in-from-bottom-2" : "slide-in-from-top-2"
                    )}
                >
                    <div className="grid grid-cols-2 gap-1">
                        {availablePresets.map(preset => {
                            const isActive = !showCustom && value === preset.value;
                            return (
                                <button
                                    key={preset.value}
                                    type="button"
                                    onClick={() => handleSelectPreset(preset)}
                                    className={cn(
                                        "flex items-center gap-2 px-2 py-2 rounded-md text-left transition-colors",
                                        isActive
                                            ? "bg-white/10 text-content-primary"
                                            : "hover:bg-white/5 text-content-secondary"
                                    )}
                                >
                                    <div className="w-4 h-4 flex items-center justify-center">
                                        <RatioIcon width={preset.width} height={preset.height} active={isActive} />
                                    </div>
                                    <span className="text-[10px] font-semibold truncate">
                                        {preset.label}{preset.descriptor && ` ${preset.descriptor}`}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                    <button
                        type="button"
                        onClick={handleSelectCustom}
                        className={cn(
                            "w-full mt-2 px-2 py-2 rounded-md text-[10px] font-bold uppercase tracking-widest transition-colors text-center border-t border-white/5 pt-2",
                            showCustom
                                ? "text-accent-primary bg-white/5"
                                : "text-content-tertiary hover:text-accent-primary hover:bg-white/5"
                        )}
                    >
                        Custom Ratio →
                    </button>
                </div>,
                document.body
            )}

            {showCustom && (
                <div className="pt-2 animate-in fade-in slide-in-from-top-1 duration-200">
                    <div className="flex items-end gap-1.5">
                        <div className="flex-1">
                            <NumberInput
                                variant={isMinimal ? 'minimal' : 'default'}
                                label="Width"
                                min={1}
                                step={1}
                                value={customW}
                                onChange={e => handleCustomChange(e.target.value, customH)}
                            />
                        </div>
                        <span className="text-content-tertiary font-bold pb-2 text-sm">:</span>
                        <div className="flex-1">
                            <NumberInput
                                variant={isMinimal ? 'minimal' : 'default'}
                                label="Height"
                                min={1}
                                step={1}
                                value={customH}
                                onChange={e => handleCustomChange(customW, e.target.value)}
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
