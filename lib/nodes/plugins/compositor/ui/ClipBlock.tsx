'use client';

import React, { memo, useCallback, useRef } from 'react';
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
    /**
     * Hard upper bound on `duration` when the user drags the right edge.
     * `null` means unbounded (image / text). For video layers this is the
     * intrinsic source length minus trim-in — you can't show more of the
     * clip than the source contains.
     */
    maxDuration: number | null;
    isSelected: boolean;
    onSelect: () => void;
    onMove: (newStartTime: number) => void;
    onResizeRight: (newDuration: number) => void;
    /** Commit a left-edge trim: new startTime, new duration, new trimIn. */
    onTrimStart: (newStartTime: number, newDuration: number, newTrimIn: number) => void;
    /**
     * Other layers' edge times (start and end) the user can snap to when
     * dragging this clip. Always includes `0` (timeline start). Snap fires
     * within a fixed pixel threshold to either end.
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
 * user zooms the timeline.
 */
const SNAP_THRESHOLD_PX = 12;

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
 * Drag implementation note: the cursor-following position is written
 * directly to the element's inline style during `pointermove`. No React
 * state is updated during the drag, so the clip moves 1:1 with the cursor
 * regardless of how many parent re-renders happen. The committed value is
 * pushed to the store only on `pointerup`. The listeners are added once
 * per drag inside `onPointerDown`'s closure (NOT via `useEffect`) so they
 * stay installed for the lifetime of the drag without listener-gap from
 * parent re-renders.
 */
const ClipBlock = memo(function ClipBlock({
    layer,
    sourceKind,
    effectiveDuration,
    pixelsPerSecond,
    maxDuration,
    isSelected,
    onSelect,
    onMove,
    onResizeRight,
    onTrimStart,
    snapTargets = [],
    onSnapChange,
}: ClipBlockProps) {
    const elRef = useRef<HTMLDivElement>(null);

    // Refs for callbacks/params used inside the long-lived pointer handlers
    // — keeps them fresh across the drag without re-installing listeners
    // every render (the previous useEffect-deps approach had a listener gap
    // on every Timeline re-render, which silently dropped snap detection).
    const snapTargetsRef = useRef(snapTargets);
    snapTargetsRef.current = snapTargets;
    const onSnapChangeRef = useRef(onSnapChange);
    onSnapChangeRef.current = onSnapChange;
    const onMoveRef = useRef(onMove);
    onMoveRef.current = onMove;
    const onResizeRightRef = useRef(onResizeRight);
    onResizeRightRef.current = onResizeRight;
    const onTrimStartRef = useRef(onTrimStart);
    onTrimStartRef.current = onTrimStart;
    const sourceKindRef = useRef(sourceKind);
    sourceKindRef.current = sourceKind;
    const onSelectRef = useRef(onSelect);
    onSelectRef.current = onSelect;
    const maxDurationRef = useRef(maxDuration);
    maxDurationRef.current = maxDuration;
    const pixelsPerSecondRef = useRef(pixelsPerSecond);
    pixelsPerSecondRef.current = pixelsPerSecond;

    const baseStart = Math.max(0, layer.startTime || 0);
    const left = baseStart * pixelsPerSecond;
    const width = Math.max(8, effectiveDuration * pixelsPerSecond);

    const dragRef = useRef<{
        kind: 'move' | 'resize' | 'trim-start';
        startX: number;
        startTime: number;
        duration: number;
        trimIn: number;
        lastStartTime: number;
        lastDuration: number;
        lastTrimIn: number;
    } | null>(null);

    const onPointerDown = useCallback((e: React.PointerEvent, kind: 'move' | 'resize' | 'trim-start') => {
        if (layer.locked) return;
        e.preventDefault();
        e.stopPropagation();
        const target = e.target as HTMLElement;
        target.setPointerCapture?.(e.pointerId);
        const start = Math.max(0, layer.startTime || 0);
        const inT = Math.max(0, layer.trimIn || 0);
        dragRef.current = {
            kind,
            startX: e.clientX,
            startTime: start,
            duration: effectiveDuration,
            trimIn: inT,
            lastStartTime: start,
            lastDuration: effectiveDuration,
            lastTrimIn: inT,
        };
        if (kind === 'move' || kind === 'trim-start') onSelectRef.current?.();

        const onMoveEvt = (ev: PointerEvent) => {
            const drag = dragRef.current;
            const node = elRef.current;
            if (!drag || !node) return;
            const pps = pixelsPerSecondRef.current;
            const targets = snapTargetsRef.current ?? [];
            const max = maxDurationRef.current;
            const deltaPx = ev.clientX - drag.startX;
            const deltaT = deltaPx / Math.max(1, pps);
            let activeSnap: number | null = null;

            if (drag.kind === 'move') {
                const raw = Math.max(0, drag.startTime + deltaT);
                const trailing = raw + drag.duration;
                const snappedLeading = snap(raw, targets, pps);
                const snappedTrailing = snap(trailing, targets, pps);
                const leadingSnapped = snappedLeading !== raw;
                const trailingSnapped = snappedTrailing !== trailing;
                let finalStart = raw;
                // Three cases handled independently — the earlier single
                // `<=` comparison rejected a leading-only snap because it
                // compared against the trailing edge's snap-distance of 0.
                if (leadingSnapped && trailingSnapped) {
                    if (Math.abs(snappedLeading - raw) <= Math.abs(snappedTrailing - trailing)) {
                        finalStart = snappedLeading;
                        activeSnap = snappedLeading;
                    } else {
                        finalStart = Math.max(0, snappedTrailing - drag.duration);
                        activeSnap = snappedTrailing;
                    }
                } else if (leadingSnapped) {
                    finalStart = snappedLeading;
                    activeSnap = snappedLeading;
                } else if (trailingSnapped) {
                    finalStart = Math.max(0, snappedTrailing - drag.duration);
                    activeSnap = snappedTrailing;
                }
                drag.lastStartTime = finalStart;
                node.style.left = `${finalStart * pps}px`;
            } else if (drag.kind === 'trim-start') {
                const MIN = 0.1;
                const rightEdge = drag.startTime + drag.duration; // pinned
                const isAV = sourceKindRef.current === 'video' || sourceKindRef.current === 'audio';
                // Left bound: video/audio can't trim before source 0 (startTime - trimIn);
                // image/text have no source limit (only >= 0).
                const minStart = isAV ? Math.max(0, drag.startTime - drag.trimIn) : 0;
                let rawStart = drag.startTime + deltaT;
                rawStart = Math.min(rawStart, rightEdge - MIN);
                rawStart = Math.max(minStart, rawStart);
                const snapped = snap(rawStart, targets, pps);
                if (snapped !== rawStart && snapped >= minStart && snapped <= rightEdge - MIN) {
                    rawStart = snapped;
                    activeSnap = snapped;
                }
                const newDuration = rightEdge - rawStart;
                const newTrimIn = isAV ? drag.trimIn + (rawStart - drag.startTime) : drag.trimIn;
                drag.lastStartTime = rawStart;
                drag.lastDuration = newDuration;
                drag.lastTrimIn = Math.max(0, newTrimIn);
                node.style.left = `${rawStart * pps}px`;
                node.style.width = `${Math.max(8, newDuration * pps)}px`;
            } else {
                let raw = Math.max(0.1, drag.duration + deltaT);
                if (max !== null) raw = Math.min(raw, max);
                const trailing = drag.startTime + raw;
                const snappedTrailing = snap(trailing, targets, pps);
                let finalDuration = raw;
                if (snappedTrailing !== trailing) {
                    finalDuration = Math.max(0.1, snappedTrailing - drag.startTime);
                    if (max !== null) finalDuration = Math.min(finalDuration, max);
                    activeSnap = snappedTrailing;
                }
                drag.lastDuration = finalDuration;
                node.style.width = `${Math.max(8, finalDuration * pps)}px`;
            }

            onSnapChangeRef.current?.(activeSnap);
        };

        const onUp = () => {
            const drag = dragRef.current;
            window.removeEventListener('pointermove', onMoveEvt);
            window.removeEventListener('pointerup', onUp);
            onSnapChangeRef.current?.(null);
            if (!drag) return;
            dragRef.current = null;
            if (drag.kind === 'move') {
                onMoveRef.current?.(drag.lastStartTime);
            } else if (drag.kind === 'trim-start') {
                onTrimStartRef.current?.(drag.lastStartTime, drag.lastDuration, drag.lastTrimIn);
            } else {
                onResizeRightRef.current?.(drag.lastDuration);
            }
        };

        window.addEventListener('pointermove', onMoveEvt);
        window.addEventListener('pointerup', onUp);
    }, [layer.locked, layer.startTime, layer.trimIn, effectiveDuration]);

    const colorClass =
        sourceKind === 'video' ? 'bg-rose-400/70 border-rose-300/40' :
        sourceKind === 'audio' ? 'bg-violet-400/70 border-violet-300/40' :
        sourceKind === 'text' ? 'bg-emerald-400/60 border-emerald-300/40' :
        sourceKind === 'image' ? 'bg-sky-400/60 border-sky-300/40' :
        'bg-white/20 border-white/10';

    return (
        <div
            ref={elRef}
            className={cn(
                'absolute top-1 bottom-1 rounded-md border select-none flex items-center px-2 overflow-hidden',
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
                    className="absolute top-0 left-0 bottom-0 w-1.5 cursor-ew-resize hover:bg-white/30 z-10"
                    onPointerDown={(e) => onPointerDown(e, 'trim-start')}
                />
            )}
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
