'use client';

import React, { useEffect, useRef, useState } from 'react';
import * as LucideIcons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

const COLOR_TOKENS = ['neutral', 'indigo', 'emerald', 'rose', 'amber', 'sky'] as const;
type ColorToken = typeof COLOR_TOKENS[number];

const COLOR_SWATCH_BG: Record<ColorToken, string> = {
    neutral: 'bg-neutral-400',
    indigo:  'bg-indigo-500',
    emerald: 'bg-emerald-500',
    rose:    'bg-rose-500',
    amber:   'bg-amber-500',
    sky:     'bg-sky-500',
};

const ICON_OPTIONS = [
    'Folder', 'Film', 'Camera', 'Image', 'Music', 'Mic', 'Volume2',
    'Wand2', 'Layers', 'Scissors', 'Brush', 'Palette',
    'Box', 'Package', 'Star', 'Heart', 'Bookmark', 'Tag',
    'PlayCircle', 'StopCircle', 'Settings', 'Sparkles',
] as const;

interface Props {
    currentIcon: string;
    currentColor: ColorToken;
    onIconChange: (icon: string) => void;
    onColorChange: (color: ColorToken) => void;
    onUngroup: () => void;
}

export function GroupHeaderToolbar({
    currentIcon,
    currentColor,
    onIconChange,
    onColorChange,
    onUngroup,
}: Props) {
    const [open, setOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!open) return;
        function onClickOutside(e: MouseEvent) {
            if (!containerRef.current) return;
            if (!containerRef.current.contains(e.target as Node)) setOpen(false);
        }
        document.addEventListener('mousedown', onClickOutside);
        return () => document.removeEventListener('mousedown', onClickOutside);
    }, [open]);

    return (
        <div ref={containerRef} className="relative">
            <button
                type="button"
                className="ml-1 px-1 rounded hover:bg-surface-subtle text-content-secondary text-xs nopan nodrag"
                onClick={(e) => {
                    e.stopPropagation();
                    setOpen((v) => !v);
                }}
                aria-label="Group options"
                aria-expanded={open}
            >
                ⋯
            </button>

            {open && (
                <div
                    className="absolute z-50 top-full left-0 mt-1 w-56 p-2 rounded-md border border-stroke-subtle bg-surface-elevated shadow-lg nopan nowheel nodrag"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                >
                    <div className="text-xs font-medium text-content-secondary mb-1.5">Color</div>
                    <div className="flex gap-1.5 mb-3">
                        {COLOR_TOKENS.map((c) => (
                            <button
                                key={c}
                                type="button"
                                onClick={() => onColorChange(c)}
                                aria-label={c}
                                className={
                                    'h-5 w-5 rounded-full border transition-all ' +
                                    COLOR_SWATCH_BG[c] +
                                    (c === currentColor
                                        ? ' ring-2 ring-offset-1 ring-content-primary'
                                        : ' opacity-80 hover:opacity-100')
                                }
                            />
                        ))}
                    </div>
                    <div className="text-xs font-medium text-content-secondary mb-1.5">Icon</div>
                    <div className="grid grid-cols-6 gap-1 mb-3">
                        {ICON_OPTIONS.map((name) => {
                            const Icon = (LucideIcons as any)[name] as LucideIcon | undefined;
                            if (!Icon) return null;
                            const active = name === currentIcon;
                            return (
                                <button
                                    key={name}
                                    type="button"
                                    onClick={() => onIconChange(name)}
                                    title={name}
                                    aria-label={name}
                                    className={
                                        'flex items-center justify-center h-7 w-7 rounded transition-colors ' +
                                        (active
                                            ? 'bg-accent-primary text-white'
                                            : 'hover:bg-surface-subtle text-content-secondary')
                                    }
                                >
                                    <Icon size={14} />
                                </button>
                            );
                        })}
                    </div>
                    <button
                        type="button"
                        onClick={() => {
                            setOpen(false);
                            onUngroup();
                        }}
                        className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-surface-subtle text-content-primary"
                    >
                        Ungroup
                    </button>
                </div>
            )}
        </div>
    );
}
