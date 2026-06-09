'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Keeps a node's preview height stable when toggling single ⇄ grid (multi) view.
 *
 * A node whose single view hugs its media (image aspect, etc.) and whose grid
 * view lays out N thumbnail rows will JUMP in height on every view switch —
 * the grid's intrinsic height differs from the single media's. This hook
 * measures the preview region while it's in SINGLE view (via ResizeObserver,
 * so it tracks late media loads) and hands back a `lockStyle` to apply to the
 * same region in GRID view. The grid then fills that frozen height and scrolls
 * internally instead of resizing the node — matching media_input's behavior.
 *
 * Usage:
 *   const { ref, lockStyle } = useGridViewHeightLock(previewMode);
 *   <div ref={ref} style={lockStyle} className="... overflow-y-auto">...</div>
 *
 * `enabled` lets callers skip the lock for view modes where it shouldn't apply
 * (e.g. ai_generator's text/audio previews, which size themselves differently).
 */
export function useGridViewHeightLock(
    previewMode: 'single' | 'grid',
    enabled: boolean = true,
): { ref: React.RefObject<HTMLDivElement>; lockStyle: React.CSSProperties | undefined; lockedHeight: number | null } {
    const ref = useRef<HTMLDivElement>(null);
    const [lockedHeight, setLockedHeight] = useState<number | null>(null);

    useEffect(() => {
        if (!enabled || previewMode !== 'single') return;
        const el = ref.current;
        if (!el || typeof ResizeObserver === 'undefined') return;
        const measure = () => {
            const h = el.offsetHeight;
            if (h > 0) setLockedHeight(h);
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, [previewMode, enabled]);

    const lockStyle =
        enabled && previewMode === 'grid' && lockedHeight ? { height: lockedHeight } : undefined;

    return { ref, lockStyle, lockedHeight };
}
