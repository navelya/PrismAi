'use client';

import { useEffect } from 'react';

/**
 * Treat a modal/portal as a separate window: while `active`, every direct
 * child of <body> EXCEPT the one containing `exceptEl` is marked `inert`
 * (and aria-hidden). `inert` blurs any focused element inside the background
 * and blocks all pointer events on it — so React Flow has no focused node
 * (arrow keys do nothing) and no pane to click/marquee — without adding any
 * per-handler guards. State is restored exactly on cleanup.
 *
 * Idempotent: re-runs reconcile against the current set of body children, so
 * portals that mount while active are also caught on the next dependency tick.
 */
export function useInertBackground(active: boolean, exceptEl: HTMLElement | null): void {
    useEffect(() => {
        // No-op until the modal's own element is known, so we never mark the
        // modal itself inert (exceptEl is null for one render on first open).
        if (!active || !exceptEl || typeof document === 'undefined') return;

        const body = document.body;
        const keep = exceptEl
            ? Array.from(body.children).find((c) => c === exceptEl || c.contains(exceptEl)) ?? null
            : null;

        // Remember prior state so we restore (not blanket-clear) on cleanup.
        const touched: { el: HTMLElement; hadInert: boolean; prevAria: string | null }[] = [];
        for (const child of Array.from(body.children)) {
            if (child === keep) continue;
            if (!(child instanceof HTMLElement)) continue;
            touched.push({
                el: child,
                hadInert: child.hasAttribute('inert'),
                prevAria: child.getAttribute('aria-hidden'),
            });
            child.setAttribute('inert', '');
            child.setAttribute('aria-hidden', 'true');
        }

        return () => {
            for (const t of touched) {
                if (!t.hadInert) t.el.removeAttribute('inert');
                if (t.prevAria === null) t.el.removeAttribute('aria-hidden');
                else t.el.setAttribute('aria-hidden', t.prevAria);
            }
        };
    }, [active, exceptEl]);
}
