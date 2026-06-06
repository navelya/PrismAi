'use client';

import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
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
export function ChatPreferencesMenu() {
    const { open, rootProps, toggle } = useHoverPopover();

    const models = useAppStore((s) => s.models) as AiModel[];
    const chatPreferences = useAppStore((s) => s.chatPreferences);
    const setChatPreference = useAppStore((s) => s.setChatPreference);

    const imgOpts = useMemo(() => modelOptions(imageModels(models)), [models]);
    const vidOpts = useMemo(() => modelOptions(videoModels(models)), [models]);

    // The panel opens UPWARD from the trigger; a tall panel would otherwise
    // clip past the top of the viewport. Cap the scroll area to the space
    // available above the trigger (minus the 8px gap + a 12px breathing margin),
    // so the top edge always stays on-screen — the panel scrolls internally
    // instead of being cut. Recomputed on open and on resize.
    const triggerRef = useRef<HTMLButtonElement>(null);
    const [maxH, setMaxH] = useState<number | undefined>(undefined);
    useLayoutEffect(() => {
        if (!open) return;
        const update = () => {
            const top = triggerRef.current?.getBoundingClientRect().top ?? window.innerHeight;
            setMaxH(Math.max(160, Math.min(top - 20, window.innerHeight * 0.7)));
        };
        update();
        window.addEventListener('resize', update);
        return () => window.removeEventListener('resize', update);
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

            {open && (
                <div className="popover-animate absolute bottom-full left-0 mb-2 w-80 max-w-[calc(100vw-2rem)] p-1.5 rounded-2xl bg-surface-primary border border-white/10 shadow-2xl ring-1 ring-white/5 z-[100001]">
                    <div className="overflow-y-auto [&::-webkit-scrollbar]:hidden" style={{ maxHeight: maxH, scrollbarWidth: 'none' }}>
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
                </div>
            )}
        </div>
    );
}
