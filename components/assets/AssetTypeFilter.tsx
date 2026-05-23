'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { SlidersHorizontal, Check, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ALL_TYPES, TYPE_META, type TypeFilter } from '@/lib/assets/unpack';

interface AssetTypeFilterProps {
    typeFilter: TypeFilter;
    onChange: (next: TypeFilter) => void;
}

/**
 * Type filter dropdown (All / Images / Videos / Audio / 3D) shared by the
 * in-workflow AssetsPanel and the standalone Assets page gallery.
 */
export function AssetTypeFilter({ typeFilter, onChange }: AssetTypeFilterProps) {
    const active = typeFilter !== 'all';
    const [open, setOpen] = useState(false);
    const wrapperRef = React.useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
        };
        const escHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', handler);
        document.addEventListener('keydown', escHandler);
        return () => {
            document.removeEventListener('mousedown', handler);
            document.removeEventListener('keydown', escHandler);
        };
    }, [open]);

    const select = (value: TypeFilter) => {
        onChange(value);
        setOpen(false);
    };

    const options: { value: TypeFilter; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
        { value: 'all', label: 'All assets', Icon: Layers },
        ...ALL_TYPES.map((t) => ({ value: t, label: TYPE_META[t].label, Icon: TYPE_META[t].Icon })),
    ];

    return (
        <div className="relative" ref={wrapperRef}>
            <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className={cn(
                    'p-1 rounded-md transition-colors group relative',
                    active
                        ? 'bg-accent-primary/15 text-accent-primary hover:bg-accent-primary/20'
                        : 'hover:bg-white/10 text-content-tertiary hover:text-content-primary'
                )}
                title="Filter by type"
                aria-haspopup="menu"
                aria-expanded={open}
            >
                <SlidersHorizontal className="w-3.5 h-3.5" />
                {active && (
                    <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-accent-primary shadow-[0_0_6px_rgba(var(--accent-primary-rgb),0.6)]" />
                )}
            </button>

            <AnimatePresence>
                {open && (
                    <motion.div
                        initial={{ opacity: 0, y: -4, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -4, scale: 0.96 }}
                        transition={{ duration: 0.12 }}
                        className="absolute right-0 top-full mt-1.5 z-20 w-40 p-1.5 rounded-xl bg-surface-primary/95 backdrop-blur-xl border border-white/10 shadow-2xl ring-1 ring-white/5"
                        role="menu"
                    >
                        <div className="space-y-0.5">
                            {options.map(({ value, label, Icon }) => {
                                const checked = typeFilter === value;
                                return (
                                    <button
                                        key={value}
                                        type="button"
                                        onClick={() => select(value)}
                                        className={cn(
                                            'w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors',
                                            checked
                                                ? 'bg-white/5 text-content-primary'
                                                : 'text-content-tertiary hover:bg-white/5 hover:text-content-secondary'
                                        )}
                                        role="menuitemradio"
                                        aria-checked={checked}
                                    >
                                        <Icon className="w-3 h-3 opacity-70 shrink-0" />
                                        <span className="text-[11px] font-semibold flex-1">{label}</span>
                                        {checked && (
                                            <Check className="w-3 h-3 text-accent-primary shrink-0" strokeWidth={3} />
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}
