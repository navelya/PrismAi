'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Box, Coins } from 'lucide-react';
import { AiModel } from '@/lib/nodes/types';
import { computeModelMenuCost, formatCredits } from '@/lib/billing/cost';

const PREVIEW_WIDTH = 280;
const HOVER_DELAY_MS = 1000;

/**
 * Floating info card shown when a model row is hovered for ~1s. Renders the
 * model's logo + title, its description, and the default calculated credits
 * (same per-second/image logic as the row badges). Portaled to <body> with
 * fixed positioning so it escapes any `overflow`/stacking ancestor, and flips
 * to the left of the anchor when there isn't room on the right.
 */
function ModelPreviewCard({ model, anchor }: { model: AiModel; anchor: DOMRect }) {
    const cardRef = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState<{ left: number; top: number }>(() => ({
        left: anchor.right + 8,
        top: anchor.top,
    }));

    useLayoutEffect(() => {
        const height = cardRef.current?.offsetHeight ?? 0;
        const margin = 8;
        const spaceRight = window.innerWidth - anchor.right - margin;
        const left = spaceRight >= PREVIEW_WIDTH
            ? anchor.right + margin
            : Math.max(margin, anchor.left - PREVIEW_WIDTH - margin);
        // Keep the card within the viewport vertically.
        const top = Math.min(Math.max(margin, anchor.top), window.innerHeight - height - margin);
        setPos({ left, top });
    }, [anchor]);

    const cost = computeModelMenuCost(model);
    const logo = model.providers?.logo_url;
    const description = model.inputs_schema?.description;

    return createPortal(
        <div
            ref={cardRef}
            style={{ position: 'fixed', left: pos.left, top: pos.top, width: PREVIEW_WIDTH }}
            className="z-[100002] pointer-events-none bg-surface-elevated/90 backdrop-blur-xl border border-stroke-subtle rounded-2xl shadow-2xl ring-1 ring-white/5 p-4 animate-in fade-in zoom-in-95 duration-150"
        >
            <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 bg-white/5 border border-white/10 overflow-hidden p-1">
                    {logo
                        ? <img src={logo} alt="" className="w-full h-full object-contain" />
                        : <Box className="w-4 h-4 text-content-tertiary" />}
                </div>
                <h4 className="text-sm font-bold text-content-primary leading-tight min-w-0">{model.display_name}</h4>
            </div>

            {description && (
                <p className="mt-3 text-[11px] leading-relaxed text-content-secondary">{description}</p>
            )}

            <div className="mt-3 pt-3 border-t border-white/5 flex items-center gap-1.5 text-xs font-mono font-medium tabular-nums text-content-secondary">
                <Coins className="w-3.5 h-3.5 text-accent-primary/80" />
                {formatCredits(cost.credits)} {cost.perSecond ? 'per second' : 'credits'}
            </div>
        </div>,
        document.body
    );
}

/**
 * Hover-to-preview controller shared by the model pickers (add-node panel,
 * canvas context menu, properties dropdown). `bind(model)` returns the hover
 * handlers to spread onto a row/item; `overlay` is the card to render once in
 * the consuming component. The card only appears after HOVER_DELAY_MS.
 */
export function useModelPreview() {
    const [state, setState] = useState<{ model: AiModel; rect: DOMRect } | null>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clear = useCallback(() => {
        if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    }, []);

    const start = useCallback((model: AiModel, el: HTMLElement) => {
        clear();
        timer.current = setTimeout(() => {
            setState({ model, rect: el.getBoundingClientRect() });
        }, HOVER_DELAY_MS);
    }, [clear]);

    const stop = useCallback(() => { clear(); setState(null); }, [clear]);

    useEffect(() => () => clear(), [clear]);

    const bind = useCallback((model: AiModel) => ({
        onMouseEnter: (e: React.MouseEvent) => start(model, e.currentTarget as HTMLElement),
        onMouseLeave: stop,
    }), [start, stop]);

    const overlay = state ? <ModelPreviewCard model={state.model} anchor={state.rect} /> : null;

    return { bind, overlay };
}
