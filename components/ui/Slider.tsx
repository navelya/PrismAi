'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface SliderProps {
    value: number;
    onChange: (value: number) => void;
    min?: number;
    max?: number;
    step?: number;
    className?: string;
    ariaLabel?: string;
    /** Optional pointer-down hook (e.g. history snapshot before a drag). */
    onPointerDown?: () => void;
}

/**
 * Fill-track range slider styled to match the app's accent language (see the
 * levels-node slider). Purely presentational — the caller owns the value, so it
 * can be wired to local state, a store, or a persisted preference. The colored
 * fill + thin rail are overlay divs behind a transparent native range; the thumb
 * is styled via webkit/moz pseudo-elements so it stays visible cross-browser.
 */
export function Slider({
    value,
    onChange,
    min = 0,
    max = 100,
    step = 1,
    className,
    ariaLabel,
    onPointerDown,
}: SliderProps) {
    const range = max - min;
    const clamped = Math.max(min, Math.min(max, value));
    const fillPct = range > 0 ? ((clamped - min) / range) * 100 : 0;

    return (
        <div className={cn('relative flex items-center', className)}>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={clamped}
                aria-label={ariaLabel}
                onPointerDown={onPointerDown}
                onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    if (Number.isNaN(v)) return;
                    onChange(v);
                }}
                className={cn(
                    'nodrag relative z-10 w-full h-3.5 bg-transparent appearance-none cursor-pointer',
                    // webkit thumb
                    '[&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:h-3.5',
                    '[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-accent-primary',
                    '[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-surface-elevated',
                    '[&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer',
                    // moz thumb
                    '[&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:border-0',
                    '[&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-accent-primary',
                    '[&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-surface-elevated [&::-moz-range-thumb]:cursor-pointer',
                )}
                style={{ WebkitAppearance: 'none' }}
            />
            {/* Rail */}
            <div className="absolute left-0 right-0 h-[3px] bg-white/10 rounded-full top-1/2 -translate-y-1/2 pointer-events-none" />
            {/* Filled portion */}
            <div
                className="absolute left-0 h-[3px] bg-accent-primary rounded-full top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ width: `${fillPct}%` }}
            />
        </div>
    );
}
