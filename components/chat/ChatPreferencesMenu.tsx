'use client';

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { SlidersHorizontal } from 'lucide-react';
import { useAppStore } from '@/lib/store/app-store';
import { persistPrefs } from '@/lib/user/preferences';
import { useHoverPopover } from '@/lib/hooks/use-hover-popover';
import type { ChatPreferences } from '@/lib/store/types';
import type { AiModel } from '@/lib/nodes/types';
import {
    ASPECT_RATIO_OPTIONS,
    VIDEO_DURATION_OPTIONS,
    QUALITY_OPTIONS,
    OUTPUTS_OPTIONS,
    STYLE_OPTIONS,
    imageModels,
    videoModels,
} from '@/lib/chat/preferences';

interface ChipOption {
    value: string;
    label: string;
    /** Optional leading icon URL (provider logo for model chips). */
    iconUrl?: string | null;
    /** Optional aspect ratio "w:h" — renders a proportional ratio glyph. */
    ratio?: string;
}

/**
 * Proportional aspect-ratio glyph, mirroring AspectRatioPicker's RatioIcon — a
 * small bordered box scaled to the ratio so the chip reads at a glance.
 */
function RatioIcon({ ratio, active }: { ratio: string; active: boolean }) {
    const m = ratio.match(/^(\d+):(\d+)$/);
    const w = m ? parseInt(m[1], 10) : 1;
    const h = m ? parseInt(m[2], 10) : 1;
    const max = 12;
    const bw = (w / Math.max(w, h)) * max;
    const bh = (h / Math.max(w, h)) * max;
    return (
        <span className="shrink-0 inline-flex items-center justify-center w-3.5 h-3.5" aria-hidden>
            <span
                className={`border rounded-[2px] ${active ? 'border-accent-primary' : 'border-content-tertiary opacity-60'}`}
                style={{ width: `${bw}px`, height: `${bh}px` }}
            />
        </span>
    );
}

/** A single selectable chip. Selected = accent fill; otherwise subtle. */
function Chip({
    option,
    selected,
    onSelect,
}: {
    option: ChipOption;
    selected: boolean;
    onSelect: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onSelect}
            className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-[11px] transition-colors outline-none
                ${selected
                    ? 'bg-accent-primary/15 border-accent-primary/40 text-content-primary font-medium'
                    : 'bg-white/5 border-white/10 text-content-secondary hover:bg-white/10 hover:text-content-primary'
                }`}
        >
            {option.ratio
                ? <RatioIcon ratio={option.ratio} active={selected} />
                : option.iconUrl && (
                    <span className="shrink-0 inline-flex items-center justify-center w-3.5 h-3.5 rounded overflow-hidden bg-white/5 border border-white/10">
                        <img src={option.iconUrl} alt="" className="w-full h-full object-contain p-[1px]" />
                    </span>
                )}
            <span className="truncate max-w-[160px]">{option.label}</span>
        </button>
    );
}

/** A labeled setting: tiny uppercase title above a wrapping row of chips. */
function Section({
    title,
    options,
    value,
    onSelect,
}: {
    title: string;
    options: ChipOption[];
    value: string;
    onSelect: (value: string) => void;
}) {
    return (
        <div className="px-1 py-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-content-tertiary px-1 mb-1.5">
                {title}
            </div>
            <div className="flex flex-wrap gap-1.5">
                <Chip
                    option={{ value: 'auto', label: 'Auto' }}
                    selected={value === 'auto'}
                    onSelect={() => onSelect('auto')}
                />
                {options.map((opt) => (
                    <Chip
                        key={opt.value}
                        option={opt}
                        selected={value === opt.value}
                        onSelect={() => onSelect(opt.value)}
                    />
                ))}
            </div>
        </div>
    );
}

const staticOptions = (values: string[]): ChipOption[] =>
    values.map((v) => ({ value: v, label: v }));

const aspectOptions = (values: string[]): ChipOption[] =>
    values.map((v) => ({ value: v, label: v, ratio: v }));

const modelOptions = (models: AiModel[]): ChipOption[] =>
    models.map((m) => ({
        value: String(m.id),
        label: m.display_name,
        iconUrl: m.providers?.logo_url ?? null,
    }));

/**
 * The chat composer's Preferences panel. A hover-opening popover (matching the
 * shared Select chrome) where the user sets standing defaults — preferred image
 * / video model, aspect ratio, video duration, resolution, output count, visual
 * style. Every setting defaults to Auto. Selections are written to the store
 * (re-rendering only the chip leaf) and persisted to the user's profile so they
 * follow them across sessions.
 *
 * Layout is "all-visible chip rows": every setting and its choices are present
 * at once; the panel scrolls rather than switching views, so a selection is
 * always one tap away.
 */
interface PanelPos {
    left: number;
    bottom: number;
    width: number;
    maxHeight: number;
}

export function ChatPreferencesMenu() {
    const { open, rootProps, popoverProps, toggle } = useHoverPopover();

    const models = useAppStore((s) => s.models) as AiModel[];
    const chatPreferences = useAppStore((s) => s.chatPreferences);
    const setChatPreference = useAppStore((s) => s.setChatPreference);

    const imgOpts = useMemo(() => modelOptions(imageModels(models)), [models]);
    const vidOpts = useMemo(() => modelOptions(videoModels(models)), [models]);

    // The panel is PORTALED to the body (an ancestor of the composer clips
    // absolutely-positioned children, which was cutting the top off). It's
    // fixed-positioned above the trigger and clamped to the viewport: left is
    // nudged toward the `+` button so it reads as opening "above the add
    // button", and its height is capped to the space above so the top edge
    // never goes off-screen — it scrolls internally instead. Recomputed on
    // open, resize, and scroll.
    const triggerRef = useRef<HTMLButtonElement>(null);
    const [pos, setPos] = useState<PanelPos | null>(null);
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    useLayoutEffect(() => {
        if (!open) return;
        const update = () => {
            const rect = triggerRef.current?.getBoundingClientRect();
            if (!rect) return;
            const width = Math.min(320, window.innerWidth - 16);
            // ~40px ≈ the `+` button (36px) + the 4px gap to its left, so the
            // panel starts above the add button rather than the prefs button.
            const left = Math.max(8, Math.min(rect.left - 40, window.innerWidth - width - 8));
            const bottom = window.innerHeight - rect.top + 8; // 8px gap above trigger
            const maxHeight = Math.max(160, Math.min(rect.top - 16, window.innerHeight * 0.7));
            setPos({ left, bottom, width, maxHeight });
        };
        update();
        window.addEventListener('resize', update);
        window.addEventListener('scroll', update, true);
        return () => {
            window.removeEventListener('resize', update);
            window.removeEventListener('scroll', update, true);
        };
    }, [open]);

    const setPref = (key: keyof ChatPreferences, value: string) => {
        setChatPreference(key, value);
        // Persist the freshly-updated object (zustand sets synchronously) to the
        // profile so the preference survives across sessions/devices.
        void persistPrefs({ chatPreferences: useAppStore.getState().chatPreferences });
    };

    return (
        <div {...rootProps} className="relative">
            <button
                ref={triggerRef}
                type="button"
                aria-label="Generation preferences"
                aria-expanded={open}
                onClick={toggle}
                className={`p-2 rounded-lg transition-colors bg-surface-secondary hover:bg-surface-tertiary text-content-tertiary hover:text-content-secondary outline-none ${open ? 'bg-surface-tertiary text-content-primary' : ''}`}
            >
                <SlidersHorizontal className="w-4 h-4" />
            </button>

            {mounted && createPortal(
                <AnimatePresence>
                    {open && pos && (
                        <motion.div
                            {...popoverProps}
                            initial={{ opacity: 0, y: 8, scale: 0.98 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0, y: 8, scale: 0.98 }}
                            transition={{ duration: 0.15, ease: 'easeOut' }}
                            style={{ position: 'fixed', left: pos.left, bottom: pos.bottom, width: pos.width, transformOrigin: 'bottom left' }}
                            className="p-1.5 rounded-2xl bg-surface-primary border border-white/10 shadow-2xl ring-1 ring-white/5 z-[100001]"
                        >
                            <div className="overflow-y-auto [&::-webkit-scrollbar]:hidden" style={{ maxHeight: pos.maxHeight, scrollbarWidth: 'none' }}>
                                <Section
                                    title="Image model"
                                    options={imgOpts}
                                    value={chatPreferences.imageModelId}
                                    onSelect={(v) => setPref('imageModelId', v)}
                                />
                                <div className="mx-1 h-px bg-white/10" />
                                <Section
                                    title="Video model"
                                    options={vidOpts}
                                    value={chatPreferences.videoModelId}
                                    onSelect={(v) => setPref('videoModelId', v)}
                                />
                                <div className="mx-1 h-px bg-white/10" />
                                <Section
                                    title="Aspect ratio"
                                    options={aspectOptions(ASPECT_RATIO_OPTIONS)}
                                    value={chatPreferences.aspectRatio}
                                    onSelect={(v) => setPref('aspectRatio', v)}
                                />
                                <div className="mx-1 h-px bg-white/10" />
                                <Section
                                    title="Video duration"
                                    options={staticOptions(VIDEO_DURATION_OPTIONS)}
                                    value={chatPreferences.videoDuration}
                                    onSelect={(v) => setPref('videoDuration', v)}
                                />
                                <div className="mx-1 h-px bg-white/10" />
                                <Section
                                    title="Resolution"
                                    options={staticOptions(QUALITY_OPTIONS)}
                                    value={chatPreferences.quality}
                                    onSelect={(v) => setPref('quality', v)}
                                />
                                <div className="mx-1 h-px bg-white/10" />
                                <Section
                                    title="Outputs"
                                    options={staticOptions(OUTPUTS_OPTIONS)}
                                    value={chatPreferences.outputs}
                                    onSelect={(v) => setPref('outputs', v)}
                                />
                                <div className="mx-1 h-px bg-white/10" />
                                <Section
                                    title="Visual style"
                                    options={staticOptions(STYLE_OPTIONS)}
                                    value={chatPreferences.style}
                                    onSelect={(v) => setPref('style', v)}
                                />
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>,
                document.body,
            )}
        </div>
    );
}
