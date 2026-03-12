'use client';

import React, { useState, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
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
    onChange: (e: { target: { value: string, name?: string } }) => void;
    className?: string;
    name?: string;
    disabled?: boolean;
    placeholder?: string;
    required?: boolean;
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
    placeholder = "Select option...",
    required = false
}: SelectProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [coords, setCoords] = useState({ top: 0, left: 0, width: 0, placement: 'bottom' as 'top' | 'bottom' });
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    const updateCoords = () => {
        if (triggerRef.current) {
            const rect = triggerRef.current.getBoundingClientRect();
            const spaceBelow = window.innerHeight - rect.bottom;
            const spaceAbove = rect.top;
            const menuHeight = 260; // Approximate max height (240px content + padding/borders)

            let placement: 'bottom' | 'top' = 'bottom';
            let top = rect.bottom + 8;

            if (spaceBelow < menuHeight && spaceAbove > spaceBelow) {
                placement = 'top';
                top = rect.top - 8;
            }

            // Horizontal constraints
            let left = rect.left;
            const padding = 16;
            if (left + rect.width > window.innerWidth - padding) {
                left = window.innerWidth - rect.width - padding;
            }
            if (left < padding) left = padding;

            setCoords({
                top,
                left,
                width: rect.width,
                placement
            });
        }
    };

    useLayoutEffect(() => {
        if (isOpen) {
            updateCoords();
        }
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;

        const handleUpdate = () => updateCoords();

        window.addEventListener('scroll', handleUpdate, true);
        window.addEventListener('resize', handleUpdate);

        const handleClickOutside = (e: MouseEvent) => {
            if (
                triggerRef.current && !triggerRef.current.contains(e.target as Node) &&
                menuRef.current && !menuRef.current.contains(e.target as Node)
            ) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);

        return () => {
            window.removeEventListener('scroll', handleUpdate, true);
            window.removeEventListener('resize', handleUpdate);
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    const selectedOption = options.find(opt => opt.id === value);

    return (
        <div className="space-y-2 flex-1 relative">
            {label && (
                <label className="text-[10px] font-bold text-content-tertiary uppercase tracking-[0.1em] pl-1 opacity-80 decoration-none">
                    {label}
                    {required && <span className="text-accent-primary ml-1">*</span>}
                </label>
            )}

            <button
                ref={triggerRef}
                type="button"
                disabled={disabled}
                onClick={() => setIsOpen(!isOpen)}
                className={cn(
                    "w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-content-primary text-sm flex items-center justify-between transition-all hover:bg-white/10 focus:outline-none focus:border-accent-primary/50 focus:ring-4 focus:ring-accent-primary/10 disabled:opacity-40 disabled:cursor-not-allowed",
                    isOpen && "border-accent-primary/50 ring-4 ring-accent-primary/10",
                    error && "border-red-500/50 focus:border-red-500/50 focus:ring-red-500/10",
                    className
                )}
            >
                <span className="truncate">{selectedOption?.display_name || placeholder}</span>
                <ChevronDown className={cn("w-4 h-4 text-content-tertiary transition-transform duration-300", isOpen && "rotate-180 text-accent-primary")} />
            </button>

            {error && <p className="text-[10px] text-red-500 pl-1 font-medium">{error}</p>}

            {typeof document !== 'undefined' && createPortal(
                <AnimatePresence mode="wait">
                    {isOpen && (
                        <motion.div
                            ref={menuRef}
                            initial={{ opacity: 0, scale: 0.95, y: coords.placement === 'bottom' ? -10 : 10 }}
                            animate={{ opacity: 1, scale: 1, y: 0 }}
                            exit={{ opacity: 0, scale: 0.95, y: coords.placement === 'bottom' ? -10 : 10 }}
                            transition={{ duration: 0.15, ease: [0.23, 1, 0.32, 1] }}
                            style={{
                                position: 'fixed',
                                top: coords.placement === 'bottom' ? coords.top : 'auto',
                                bottom: coords.placement === 'top' ? (window.innerHeight - coords.top) : 'auto',
                                left: coords.left,
                                width: coords.width,
                                zIndex: 9999,
                                transformOrigin: coords.placement === 'bottom' ? 'top' : 'bottom'
                            }}
                            className="bg-surface-primary/80 backdrop-blur-3xl border border-white/10 rounded-2xl shadow-2xl overflow-hidden pointer-events-auto ring-1 ring-white/5"
                        >
                            <div className="max-h-[240px] overflow-y-auto custom-scrollbar p-1.5 space-y-0.5">
                                {options.length === 0 ? (
                                    <div className="px-4 py-3 text-xs text-content-tertiary italic">No options available</div>
                                ) : (
                                    options.map((opt) => (
                                        <button
                                            key={opt.id}
                                            type="button"
                                            onClick={() => {
                                                onChange({ target: { value: opt.id, name } });
                                                setIsOpen(false);
                                            }}
                                            className={cn(
                                                "w-full px-3 py-2 text-left text-sm transition-all flex items-center justify-between rounded-lg group/opt",
                                                value === opt.id
                                                    ? "bg-accent-primary/10 text-accent-primary font-bold"
                                                    : "text-content-primary/70 hover:bg-white/5 hover:text-content-primary"
                                            )}
                                        >
                                            <span className="truncate">{opt.display_name}</span>
                                            {value === opt.id && (
                                                <motion.div
                                                    layoutId="selection-dot"
                                                    className="w-1.5 h-1.5 rounded-full bg-accent-primary shadow-[0_0_8px_rgba(var(--accent-primary-rgb),0.5)]"
                                                />
                                            )}
                                        </button>
                                    ))
                                )}
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>,
                document.body
            )}
        </div>
    );
}
