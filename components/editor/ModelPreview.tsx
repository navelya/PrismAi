'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Box, Coins } from 'lucide-react';
import { AiModel } from '@/lib/nodes/types';
import { computeModelMenuCost, formatCredits } from '@/lib/billing/cost';

const PREVIEW_WIDTH = 280;
const HOVER_DELAY_MS = 1000;
/** Small, consistent gap between the hovered row and the preview card. */
const GAP = 8;

/**
 * Floating info card shown when a model row is hovered for ~1s. Renders the
 * model's logo + title, its description, and the default calculated credits
 * (same per-second/image logic as the row badges). Portaled to <body> with
 * fixed positioning so it escapes any `overflow`/stacking ancestor.
 *
 * The left/right side is decided synchronously in render from the anchor rect
 * and the card's fixed width — so it never first paints on the wrong side and
 * slides across. It flips to the left only when there's no room on the right.
 * Entrance/exit is a smooth fade + zoom (framer-motion), growing from the edge
 * nearest the row — matching the add-node flyout.
 */
function ModelPreviewCard({ model, anchor }: { model: AiModel; anchor: DOMRect }) {
    const cardRef = useRef<HTMLDivElement>(null);

    const openLeft = (window.innerWidth - anchor.right - GAP) < PREVIEW_WIDTH;
    const left = openLeft
        ? Math.max(GAP, anchor.left - PREVIEW_WIDTH - GAP)
        : anchor.right + GAP;

    // Vertical: start aligned to the row, then clamp to the viewport once the
    // real height is known. Only `top` changes (instant, pre-paint) — never the
    // side — so there is no horizontal slide.
    const [top, setTop] = useState(anchor.top);
    useLayoutEffect(() => {
        const h = cardRef.current?.offsetHeight ?? 0;
        const maxTop = Math.max(GAP, window.innerHeight - GAP - h);
        setTop(Math.min(Math.max(GAP, anchor.top), maxTop));
    }, [anchor]);

    const cost = computeModelMenuCost(model);
    const logo = model.providers?.logo_url;
    const description = model.inputs_schema?.description;

    return createPortal(
        <motion.div
            ref={cardRef}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.14, ease: 'easeOut' }}
            style={{ position: 'fixed', left, top, width: PREVIEW_WIDTH, transformOrigin: openLeft ? 'right center' : 'left center' }}
            className="z-[100002] pointer-events-none bg-surface-elevated/90 backdrop-blur-xl border border-stroke-subtle rounded-2xl shadow-2xl ring-1 ring-white/5 p-4"
        >
            <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 bg-white/5 border border-white/10 overflow-hidden p-1">
                    {logo
                        ? <img src={logo} alt="" className="w-full h-full object-contain" />
                        : <Box className="w-3.5 h-3.5 text-content-tertiary" />}
                </div>
                <h4 className="text-[13px] font-bold text-content-primary leading-tight min-w-0">{model.display_name}</h4>
            </div>

            {description && (
                <p className="mt-3 text-[11px] leading-relaxed text-content-secondary">{description}</p>
            )}

            <div className="mt-3 pt-3 border-t border-white/5 flex items-center gap-1.5 text-xs font-mono font-medium tabular-nums text-content-secondary">
                <Coins className="w-3.5 h-3.5 text-accent-primary/80" />
                {formatCredits(cost.credits)} {cost.perSecond ? 'per second' : 'credits'}
            </div>
        </motion.div>,
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

    const overlay = (
        <AnimatePresence>
            {state && <ModelPreviewCard key={state.model.id} model={state.model} anchor={state.rect} />}
        </AnimatePresence>
    );

    // `hide` lets a host dismiss the card on events that don't emit a row
    // mouseleave — e.g. picking an option closes a dropdown without the hovered
    // <Item> firing onMouseLeave, leaving the card stranded.
    return { bind, overlay, hide: stop };
}
