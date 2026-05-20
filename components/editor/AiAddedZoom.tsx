'use client';

import { useEffect, useRef } from 'react';
import { useReactFlow, useStore } from 'reactflow';
import { useAppStore } from '@/lib/store/app-store';

const DURING_STREAM_DURATION = 400;
const DURING_STREAM_PADDING = 0.2;
const END_OF_TURN_DURATION = 700;
const END_OF_TURN_PADDING = 0.25;
const MAX_FIT_ZOOM = 0.8;
const STREAM_DEBOUNCE_MS = 150;
const ALREADY_VISIBLE_INSET_PX = 40;
const FALLBACK_NODE_W = 200;
const FALLBACK_NODE_H = 100;

interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Mounted inside <ReactFlow>. Watches `aiTurn` from the app store and
 * smoothly fits the camera to the union of nodes the AI has touched in the
 * current chat turn. Two phases:
 *
 *   1. During the stream — debounced by STREAM_DEBOUNCE_MS, only fits when
 *      the touched bbox is NOT fully visible (with a small inset). Avoids
 *      moving the camera when the user can already see the new nodes.
 *   2. End of turn — one definitive settle fit with a longer animation.
 *
 * User override: any user-initiated viewport change during the turn flips
 * `userOverrodeViewport` and suppresses both fits for the rest of the turn.
 * Programmatic moves (our own `fitBounds` calls) are guarded so they don't
 * self-trigger the override.
 *
 * Returns null — no visual output.
 */
export function AiAddedZoom() {
    const { getNodes, getViewport, fitBounds } = useReactFlow();
    const aiTurn = useAppStore((s) => s.aiTurn);

    // React Flow's internal viewport state. Subscribing here ensures the
    // override-detection effect re-runs whenever the user pans/zooms — not
    // just when our patch state changes.
    const viewportTransform = useStore(
        (s) => `${s.transform[0]},${s.transform[1]},${s.transform[2]}`,
    );

    const isProgrammaticMoveRef = useRef(false);
    const userOverrodeViewportRef = useRef(false);
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Two separate "previous active" trackers so the reset effect and the
    // end-of-turn effect can each read a fresh value without one clobbering
    // the other. Effects run in declaration order; previously a single ref
    // was overwritten before the second effect could observe the transition.
    const resetPrevActiveRef = useRef(false);
    const endTurnPrevActiveRef = useRef(false);
    const prevPatchTickRef = useRef(0);
    // Mirror of aiTurn.active read by the viewport-change effect WITHOUT
    // putting `aiTurn?.active` in its deps. If we put it in deps, the effect
    // re-fires on every begin/end turn and treats the active-flag transition
    // as a "viewport changed" event — instantly setting userOverrodeViewport
    // to true before any patch ever arrives, which suppresses every fit.
    const aiTurnActiveRef = useRef(false);
    const prevViewportTransformRef = useRef<string | null>(null);

    // Reset per-turn refs the moment a new turn begins. We key off
    // (active true && patchTick 0) — beginAiTurn always resets patchTick to 0.
    useEffect(() => {
        if (!aiTurn) return;
        if (aiTurn.active && aiTurn.patchTick === 0 && !resetPrevActiveRef.current) {
            userOverrodeViewportRef.current = false;
            prevPatchTickRef.current = 0;
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
                debounceTimerRef.current = null;
            }
        }
        resetPrevActiveRef.current = aiTurn.active;
    }, [aiTurn]);

    // Mirror aiTurn.active into a ref so the viewport effect can read it
    // without re-firing on begin/end transitions.
    useEffect(() => {
        aiTurnActiveRef.current = !!aiTurn?.active;
    }, [aiTurn?.active]);

    // User-override detection: any viewport change that isn't our own
    // programmatic fit is treated as user input. We deliberately read the
    // active flag from a ref (not deps) so this effect only runs on real
    // viewport changes, never on active-flag flips.
    useEffect(() => {
        if (prevViewportTransformRef.current === null) {
            // First run — initialize and skip.
            prevViewportTransformRef.current = viewportTransform;
            return;
        }
        if (viewportTransform === prevViewportTransformRef.current) return;
        prevViewportTransformRef.current = viewportTransform;
        if (!aiTurnActiveRef.current) return;
        if (isProgrammaticMoveRef.current) return;
        userOverrodeViewportRef.current = true;
    }, [viewportTransform]);

    // During-stream fit (debounced). Fires on every patchTick bump while
    // the turn is active. Skipped if the user has taken over or the touched
    // bbox is already fully visible.
    useEffect(() => {
        if (!aiTurn?.active) return;
        if (aiTurn.patchTick === 0) return;
        if (aiTurn.patchTick === prevPatchTickRef.current) return;
        prevPatchTickRef.current = aiTurn.patchTick;

        if (userOverrodeViewportRef.current) return;
        if (aiTurn.touchedNodeIds.length === 0) return;

        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(() => {
            debounceTimerRef.current = null;
            if (userOverrodeViewportRef.current) return;
            const bbox = computeBbox(getNodes(), aiTurn.touchedNodeIds);
            if (!bbox) return;
            if (isBboxFullyVisible(bbox, getViewport(), ALREADY_VISIBLE_INSET_PX)) return;
            runProgrammaticFit(bbox, DURING_STREAM_DURATION, DURING_STREAM_PADDING);
        }, STREAM_DEBOUNCE_MS);

        return () => {
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
                debounceTimerRef.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [aiTurn?.patchTick, aiTurn?.active]);

    // End-of-turn settle fit. Triggered when active flips from true → false.
    useEffect(() => {
        const isActive = !!aiTurn?.active;
        const wasActive = endTurnPrevActiveRef.current;
        endTurnPrevActiveRef.current = isActive;

        // Only run on the active → inactive transition.
        if (!(wasActive && !isActive)) return;
        if (!aiTurn) return;
        if (aiTurn.patchTick === 0) return;
        if (userOverrodeViewportRef.current) return;
        if (aiTurn.touchedNodeIds.length === 0) return;

        // Cancel any pending during-stream fit — the settle is the canonical move.
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
        }

        // One rAF so React Flow has measured any nodes added in the very last
        // patch before we compute the bbox.
        const raf = requestAnimationFrame(() => {
            if (userOverrodeViewportRef.current) return;
            const bbox = computeBbox(getNodes(), aiTurn.touchedNodeIds);
            if (!bbox) return;
            runProgrammaticFit(bbox, END_OF_TURN_DURATION, END_OF_TURN_PADDING);
        });
        return () => cancelAnimationFrame(raf);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [aiTurn?.active]);

    function runProgrammaticFit(bbox: Rect, duration: number, padding: number) {
        isProgrammaticMoveRef.current = true;
        fitBounds(bbox, { duration, padding, maxZoom: MAX_FIT_ZOOM } as any);
        // Hold the guard until just after the animation completes — React
        // Flow fires viewport-change events throughout the tween.
        setTimeout(() => {
            isProgrammaticMoveRef.current = false;
        }, duration + 50);
    }

    return null;
}

/**
 * Bounding box of the given ids using their measured width/height when
 * available, falling back to default node dimensions for nodes whose
 * size hasn't been observed yet (typical for the just-added node in the
 * very first during-stream tick).
 */
function computeBbox(
    nodes: ReturnType<ReturnType<typeof useReactFlow>['getNodes']>,
    ids: string[],
): Rect | null {
    const wanted = new Set(ids);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let found = false;
    for (const n of nodes) {
        if (!wanted.has(n.id)) continue;
        // React Flow exposes `width`/`height` once measured; pre-measurement
        // they're undefined. positionAbsolute accounts for being inside a group.
        const pos = (n as any).positionAbsolute || n.position;
        if (!pos) continue;
        const w = (n.width ?? (n as any).measured?.width ?? FALLBACK_NODE_W) as number;
        const h = (n.height ?? (n as any).measured?.height ?? FALLBACK_NODE_H) as number;
        minX = Math.min(minX, pos.x);
        minY = Math.min(minY, pos.y);
        maxX = Math.max(maxX, pos.x + w);
        maxY = Math.max(maxY, pos.y + h);
        found = true;
    }
    if (!found) return null;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Returns true when the entire bbox sits inside the viewport's visible
 * flow-space rect, shrunk by `insetPx` screen pixels on all sides. The
 * inset prevents the camera from doing nothing when a new node lands
 * right at the edge of the screen.
 */
function isBboxFullyVisible(
    bbox: Rect,
    viewport: { x: number; y: number; zoom: number },
    insetPx: number,
): boolean {
    const root = document.querySelector('.react-flow') as HTMLElement | null;
    if (!root) return false;
    const rect = root.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;

    const zoom = viewport.zoom || 1;
    const insetFlow = insetPx / zoom;
    const visible: Rect = {
        x: -viewport.x / zoom + insetFlow,
        y: -viewport.y / zoom + insetFlow,
        width: rect.width / zoom - insetFlow * 2,
        height: rect.height / zoom - insetFlow * 2,
    };

    return (
        bbox.x >= visible.x &&
        bbox.y >= visible.y &&
        bbox.x + bbox.width <= visible.x + visible.width &&
        bbox.y + bbox.height <= visible.y + visible.height
    );
}
