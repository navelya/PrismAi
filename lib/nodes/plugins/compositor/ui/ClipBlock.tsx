'use client';

import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { CompositorLayer } from '../definition';
import { LayerSourceKind } from '../shared';

interface ClipBlockProps {
    layer: CompositorLayer;
    sourceKind: LayerSourceKind;
    /** Effective duration in seconds — what the block visually represents. */
    effectiveDuration: number;
    /** Pixels per second — scale factor from the parent timeline. */
    pixelsPerSecond: number;
    isSelected: boolean;
    onSelect: () => void;
    onMove: (newStartTime: number) => void;
    onResizeRight: (newDuration: number) => void;
    /**
     * Other layers' edge times (start and end) the user can snap to when
     * dragging this clip. Always includes `0` (timeline start). Snap fires
     * within a 0.25s threshold to either end.
     */
    snapTargets?: number[];
    /**
     * Reports active snap to the parent timeline so it can paint a vertical
     * guide line across all tracks at the snap position. `null` clears it.
     */
    onSnapChange?: (snapAt: number | null) => void;
}

/**
 * Pixel threshold for snap. Converted to seconds at runtime against the
 * caller's current `pixelsPerSecond` — keeps snap "feel" constant as the
 * user zooms the timeline. 12px is a common value in pro editors (Premiere,
 * Resolve) and gives a clear "click" without being so generous you can't
 * place clips intentionally.
 */
const SNAP_THRESHOLD_PX = 12;

/**
 * If `value` is within the snap threshold of any target, return the closest
 * target; otherwise return `value` unchanged. The threshold is in pixels at
 * the current zoom level so it feels the same regardless of how far in/out
 * the user has zoomed.
 */
function snap(value: number, targets: number[], pixelsPerSecond: number): number {
    const threshold = SNAP_THRESHOLD_PX / Math.max(1, pixelsPerSecond);
    let bestDelta = threshold;
    let bestTarget: number | null = null;
    for (const t of targets) {
        const d = Math.abs(value - t);
        if (d <= bestDelta) {
            bestDelta = d;
            bestTarget = t;
        }
    }
    return bestTarget !== null ? bestTarget : value;
}

/**
 * A single clip on a timeline track.
 *
 * Stage 1 interactions:
 *  - Click → select
 *  - Drag body → moves `startTime` (clamped to ≥ 0)
 *  - Drag right edge → adjusts the visible window (`duration`); for video this
 *    is currently visibility-only (Stage 1 doesn't re-encode), for image/text
 *    it sets a finite window
 *
 * We deliberately don't expose a left-edge handle yet — that's "trim from the
 * start of the source", a Stage 2 concern that requires re-encoding on the
 * server.
 */
const ClipBlock = memo(function ClipBlock({
    layer,
    sourceKind,
    effectiveDuration,
    pixelsPerSecond,
    isSelected,
    onSelect,
    onMove,
    onResizeRight,
    snapTargets = [],
    onSnapChange,
}: ClipBlockProps) {
    // During a drag, we hold the visual position in component-local state and
    // do NOT push to the store on each pointermove. Committing to Zustand per
    // tick triggers a full workflow re-render and tanks frame rate, especially
    // when several Konva-driven nodes are mounted. Pattern mirrors the
    // local-buffering used for Reorder in the layer side-panel.
    const [bufferedStart, setBufferedStart] = useState<number | null>(null);
    const [bufferedDuration, setBufferedDuration] = useState<number | null>(null);

    const visibleStart = bufferedStart ?? Math.max(0, layer.startTime || 0);
    const visibleDuration = bufferedDuration ?? effectiveDuration;

    const left = visibleStart * pixelsPerSecond;
    const width = Math.max(8, visibleDuration * pixelsPerSecond);

    // Drag state ref — survives the rAF loop without re-renders.
    const dragRef = useRef<{
        kind: 'move' | 'resize';
        startX: number;
        startTime: number;
        duration: number;
    } | null>(null);
    const [isDragging, setIsDragging] = useState(false);

    const onPointerDown = useCallback((e: React.PointerEvent, kind: 'move' | 'resize') => {
        if (layer.locked) return;
        e.preventDefault();
        e.stopPropagation();
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        dragRef.current = {
            kind,
            startX: e.clientX,
            startTime: layer.startTime || 0,
            duration: effectiveDuration,
        };
        setIsDragging(true);
        if (kind === 'move') onSelect();
    }, [layer.locked, layer.startTime, effectiveDuration, onSelect]);

    useEffect(() => {
        if (!isDragging) return;

        // Throttle visual updates to rAF so we don't churn React state at the
        // pointer event rate (often 1000Hz on high-refresh devices). Each
        // pointermove just updates a ref; the rAF tick reads it and writes
        // to component state at ~60Hz.
        let pendingStart: number | null = null;
        let pendingDuration: number | null = null;
        let rafHandle: number | null = null;

        const flush = () => {
            rafHandle = null;
            if (pendingStart !== null) {
                setBufferedStart(pendingStart);
                pendingStart = null;
            }
            if (pendingDuration !== null) {
                setBufferedDuration(pendingDuration);
                pendingDuration = null;
            }
        };

        const onMoveEvt = (e: PointerEvent) => {
            const drag = dragRef.current;
            if (!drag) return;
            const deltaPx = e.clientX - drag.startX;
            const deltaT = deltaPx / Math.max(1, pixelsPerSecond);
            let activeSnap: number | null = null;

            if (drag.kind === 'move') {
                const raw = Math.max(0, drag.startTime + deltaT);
                // Snap the leading edge of the clip to neighbour edges. Also
                // try snapping the trailing edge (`raw + duration`) — this
                // catches the "drop new clip at the end of an existing one"
                // case where the user is sliding from the right.
                const trailing = raw + drag.duration;
                const snappedLeading = snap(raw, snapTargets, pixelsPerSecond);
                const snappedTrailing = snap(trailing, snapTargets, pixelsPerSecond);
                // Prefer whichever snap moved less (closer to raw).
                if (snappedLeading !== raw && Math.abs(snappedLeading - raw) <= Math.abs(snappedTrailing - trailing)) {
                    pendingStart = snappedLeading;
                    activeSnap = snappedLeading;
                } else if (snappedTrailing !== trailing) {
                    pendingStart = Math.max(0, snappedTrailing - drag.duration);
                    activeSnap = snappedTrailing;
                } else {
                    pendingStart = raw;
                }
            } else {
                const raw = Math.max(0.1, drag.duration + deltaT);
                // For resize: snap the trailing edge (`startTime + duration`).
                const trailing = (drag.startTime || 0) + raw;
                const snappedTrailing = snap(trailing, snapTargets, pixelsPerSecond);
                pendingDuration = Math.max(0.1, snappedTrailing - (drag.startTime || 0));
                if (snappedTrailing !== trailing) activeSnap = snappedTrailing;
            }

            onSnapChange?.(activeSnap);
            if (rafHandle === null) rafHandle = requestAnimationFrame(flush);
        };

        const onUp = () => {
            const drag = dragRef.current;
            dragRef.current = null;
            setIsDragging(false);
            onSnapChange?.(null);
            if (rafHandle !== null) cancelAnimationFrame(rafHandle);
            // Commit final value to the store. Using the most recent pending
            // value if present; otherwise the buffered state (set by the last
            // rAF flush before pointerup).
            if (drag) {
                if (drag.kind === 'move') {
                    const final = pendingStart ?? bufferedStart ?? drag.startTime;
                    onMove(final);
                } else {
                    const final = pendingDuration ?? bufferedDuration ?? drag.duration;
                    onResizeRight(final);
                }
            }
            // Clear the buffer so the next render reads from the (now updated)
            // layer prop.
            setBufferedStart(null);
            setBufferedDuration(null);
        };

        window.addEventListener('pointermove', onMoveEvt);
        window.addEventListener('pointerup', onUp);
        return () => {
            window.removeEventListener('pointermove', onMoveEvt);
            window.removeEventListener('pointerup', onUp);
            if (rafHandle !== null) cancelAnimationFrame(rafHandle);
        };
    }, [isDragging, pixelsPerSecond, onMove, onResizeRight, bufferedStart, bufferedDuration, snapTargets, onSnapChange]);

    const colorClass =
        sourceKind === 'video' ? 'bg-rose-400/70 border-rose-300/40' :
        sourceKind === 'text' ? 'bg-emerald-400/60 border-emerald-300/40' :
        sourceKind === 'image' ? 'bg-sky-400/60 border-sky-300/40' :
        'bg-white/20 border-white/10';

    return (
        <div
            className={cn(
                'absolute top-1 bottom-1 rounded-md border select-none flex items-center px-2 overflow-hidden transition-shadow',
                colorClass,
                isSelected ? 'ring-2 ring-white/70 ring-offset-1 ring-offset-transparent shadow-lg' : 'shadow-sm',
                layer.locked ? 'cursor-not-allowed opacity-60' : 'cursor-grab active:cursor-grabbing',
            )}
            style={{ left, width }}
            onPointerDown={(e) => onPointerDown(e, 'move')}
        >
            <span className="text-[10px] font-medium text-black/80 truncate pointer-events-none">
                {layer.name}
            </span>
            {!layer.locked && (
                <div
                    className="absolute top-0 right-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-white/30"
                    onPointerDown={(e) => onPointerDown(e, 'resize')}
                />
            )}
        </div>
    );
});

export default ClipBlock;
