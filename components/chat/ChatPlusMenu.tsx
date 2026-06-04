'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Plus, Paperclip, Coins } from 'lucide-react';
import { useAppStore } from '@/lib/store/app-store';
import { Switch } from '@/components/ui/Switch';
import { persistPrefs } from '@/lib/user/preferences';

interface ChatPlusMenuProps {
    onOpenImagePicker: () => void;
}

/** Icon chip matching the shared Select's OptionIcon (minimal, 16px). */
function MenuIcon({ children }: { children: React.ReactNode }) {
    return (
        <span className="shrink-0 inline-flex items-center justify-center w-4 h-4 rounded-md overflow-hidden bg-white/5 border border-white/10">
            {children}
        </span>
    );
}

/**
 * The chat composer's "+" attachment menu. A dropdown styled to match the shared
 * Select popover (so it reads "like the rest of the app"), but a plain popover
 * rather than a Radix Select because it holds interactive controls — a toggle
 * and a link — that Select's option semantics can't host.
 *
 * Anchored above the trigger via absolute positioning inside a relative root, so
 * an ancestor's backdrop-blur can't hijack the containing block (the bug a fixed
 * child would hit here).
 *
 * Holds: an "Attach files" action that opens the image picker, and an auto-run
 * row with an on/off toggle plus a "Configure" link that opens the auto-run
 * explainer + limit config.
 */
export function ChatPlusMenu({ onOpenImagePicker }: ChatPlusMenuProps) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    const autoRunEnabled = useAppStore((s) => s.autoRunEnabled);
    const setAutoRunEnabled = useAppStore((s) => s.setAutoRunEnabled);
    const openAutoRunConfig = useAppStore((s) => s.openAutoRunConfig);

    const handleToggle = (checked: boolean) => {
        setAutoRunEnabled(checked);
        void persistPrefs({ autoRunEnabled: checked });
    };

    // Outside-click + Escape close.
    useEffect(() => {
        if (!open) return;
        const onPointer = (e: PointerEvent) => {
            if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('pointerdown', onPointer);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('pointerdown', onPointer);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    return (
        <div ref={rootRef} className="relative">
            <button
                type="button"
                aria-label="Add attachment"
                aria-expanded={open}
                onClick={() => setOpen((o) => !o)}
                className={`p-2 rounded-lg transition-colors bg-surface-secondary hover:bg-surface-tertiary text-content-tertiary hover:text-content-secondary outline-none ${open ? 'bg-surface-tertiary text-content-primary [&>svg]:rotate-45' : ''}`}
            >
                <Plus className="w-5 h-5 transition-transform" />
            </button>

            {open && (
                <div className="popover-animate absolute bottom-full left-0 mb-2 w-60 p-1.5 rounded-2xl bg-surface-primary/80 backdrop-blur-3xl border border-white/10 shadow-2xl ring-1 ring-white/5 z-[100001]">
                    {/* Attach files */}
                    <button
                        type="button"
                        onClick={() => {
                            onOpenImagePicker();
                            setOpen(false);
                        }}
                        className="w-full px-2 py-1.5 text-left rounded-lg flex items-center gap-2 text-xs text-content-primary/80 hover:bg-white/5 hover:text-content-primary transition-colors"
                    >
                        <MenuIcon>
                            <Paperclip className="w-3.5 h-3.5" />
                        </MenuIcon>
                        <span className="flex-1 min-w-0 truncate">Attach files</span>
                    </button>

                    <div className="my-1 h-px bg-white/10" />

                    {/* Auto-run */}
                    <div className="w-full px-2 py-1.5 flex items-center gap-2 text-xs">
                        <MenuIcon>
                            <Coins className="w-3.5 h-3.5" />
                        </MenuIcon>
                        <span className="flex-1 min-w-0 truncate text-content-primary/80">Auto-run</span>
                        <button
                            type="button"
                            onClick={() => {
                                openAutoRunConfig();
                                setOpen(false);
                            }}
                            className="shrink-0 text-[10px] font-semibold text-accent-primary hover:underline transition-colors"
                        >
                            Configure
                        </button>
                        <Switch
                            size="sm"
                            checked={autoRunEnabled}
                            onCheckedChange={handleToggle}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
