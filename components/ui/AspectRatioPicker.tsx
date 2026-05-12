'use client';

import React, { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AspectRatioPickerProps {
    label?: string;
    value: string;
    options?: string[];
    /** Single atomic callback — fires with the new value and whether Custom mode
     *  is active. The parent must commit BOTH in the same update to avoid the
     *  React batching race where two setState calls clobber each other. */
    onChange: (value: string, isCustom: boolean) => void;
    variant?: 'default' | 'minimal';
    /** Optional controlled custom-mode flag. When provided, the parent owns it. */
    isCustom?: boolean;
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
}: AspectRatioPickerProps) {
    const [open, setOpen] = useState(false);
    const [internalCustomMode, setInternalCustomMode] = useState(() => isCustomFormat(value));
    const customMode = isCustom !== undefined ? isCustom : internalCustomMode;
    const containerRef = useRef<HTMLDivElement>(null);
    const isMinimal = variant === 'minimal';

    const availablePresets = options && options.length
        ? PRESETS.filter(p => options.includes(p.value))
        : PRESETS.filter(p => p.value !== 'auto'); // dedupe Auto when no schema constraints

    // Custom mode is a local UI flag because a Custom W:H value (e.g. "16:9")
    // can collide with a preset string. Without this flag, picking Custom would
    // be indistinguishable from picking the matching preset.
    const showCustom = customMode || isCustomFormat(value);

    useEffect(() => {
        if (isCustomFormat(value) && isCustom === undefined) {
            setInternalCustomMode(true);
        }
    }, [value, isCustom]);

    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (!containerRef.current?.contains(e.target as Node)) {
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
        if (isCustom === undefined) setInternalCustomMode(false);
        onChange(preset.value, false);
        setOpen(false);
    };

    const handleSelectCustom = () => {
        if (isCustom === undefined) setInternalCustomMode(true);
        // Keep the existing value so the API still receives a valid string —
        // the model's width/height controls take over for actual sizing.
        const fallback = availablePresets[0]?.value || '1:1';
        onChange(value || fallback, true);
        setOpen(false);
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
                type="button"
                onClick={() => setOpen(o => !o)}
                className={cn(
                    "w-full bg-white/5 border border-white/10 rounded-lg text-content-primary focus:outline-none focus:border-accent-primary/50 focus:ring-4 focus:ring-accent-primary/10 transition-all flex items-center justify-between gap-2 hover:border-white/20",
                    open && "border-accent-primary/50 ring-4 ring-accent-primary/10",
                    isMinimal ? "h-8 px-2 text-xs" : "h-11 px-4 text-sm"
                )}
            >
                <div className="flex items-center gap-2 min-w-0">
                    {!showCustom && currentMeta && <RatioIcon width={currentMeta.width} height={currentMeta.height} active />}
                    <span className="truncate font-medium">{triggerLabel}</span>
                </div>
                <ChevronDown className={cn(
                    "text-content-tertiary opacity-60 transition-transform shrink-0",
                    open && "rotate-180",
                    isMinimal ? "w-3 h-3" : "w-4 h-4"
                )} />
            </button>

            {open && (
                <div className="absolute z-50 left-0 right-0 mt-1 bg-surface-primary/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl p-2 animate-in fade-in slide-in-from-top-2 duration-150 max-h-[60vh] overflow-y-auto custom-scrollbar">
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
                </div>
            )}

        </div>
    );
}
