'use client';

import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Eye, EyeOff, Lock, Unlock, Volume2, VolumeX, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CompositorLayer } from '../definition';
import { LayerSourceKind, computeTimelineDuration, getEffectiveDuration } from '../shared';
import { TransportClock } from '../transport-clock';
import Transport from './Transport';
import ClipBlock from './ClipBlock';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { Scissors, Trash2 } from 'lucide-react';

interface TimelineProps {
    /** Array order: array[0] = TOP of the visual stack (the renderer reverses
     *  before drawing, so array[0] is painted last = on top). We display rows
     *  in this same order — array[0] at the TOP of the timeline — so the top
     *  row matches the top of the left-side layer list and the highest z-index.
     */
    layers: CompositorLayer[];
    /** layerId → live display title (mirrors the source node's current title). */
    layerNames?: Record<string, string>;
    sourceKindByLayerId: Record<string, LayerSourceKind>;
    intrinsicDurations: Record<string, number | null>;
    configuredTotalDuration: number | null;
    fps: number;
    playhead: number;
    /**
     * Surface transport clock. While playing, the playhead line follows it
     * per-frame via direct-DOM style writes (the React `playhead` prop only
     * commits at ~10Hz and would make the line step visibly).
     */
    clock?: TransportClock | null;
    isPlaying: boolean;
    audioMuted: boolean;
    selectedLayerId: string | null;
    onTogglePlay: () => void;
    onSeek: (t: number) => void;
    onToggleAudioMute: () => void;
    onSelectLayer: (layerId: string) => void;
    onUpdateLayer: (layerId: string, patch: Partial<CompositorLayer>) => void;
    onTrimStart: (layerId: string, startTime: number, duration: number, trimIn: number) => void;
    onSplitLayer: (layerId: string) => void;
    onDeleteClip: (layerId: string) => void;
    onToggleRow: (sourceHandleId: string, field: 'visible' | 'locked' | 'muted') => void;
    onRemoveRow: (sourceHandleId: string) => void;
}

/** Default pixels-per-second for the ruler — the seed for the session-only
 *  zoom state. Live scale lives in component state (`pixelsPerSecond`). */
const PIXELS_PER_SECOND = 40;
/** Zoom slider bounds (pixels per second). */
const PPS_MIN = 10;
const PPS_MAX = 120;
/** Per-row height — kept in sync with TimelineTrack visuals. */
const ROW_HEIGHT = 36;
/** Width of the fixed label column on the left. */
const LABEL_COLUMN_WIDTH = 180;
/** Height of the ruler row at the top of the lane. */
const RULER_HEIGHT = 24;

/**
 * Bottom-panel timeline.
 *
 * Layout (after the ruler-alignment fix):
 *
 *   ┌───────────────┬─────────────────────────────────────┐
 *   │  Transport (full-width bar above everything)        │
 *   ├───────────────┼─────────────────────────────────────┤
 *   │ <empty>       │  Ruler (0s ──── 5s ──── 10s ──── )  │
 *   │               │ ─────────────────────────────────── │
 *   │ Track label 1 │ [Clip block]                        │
 *   │ Track label 2 │           [Clip block]              │
 *   │ Track label 3 │                                     │
 *   │               │   ← Playhead overlay                │
 *   └───────────────┴─────────────────────────────────────┘
 *
 * Labels and clip rows scroll vertically together; ruler + clips share the
 * horizontal scroll. The 0s mark on the ruler aligns exactly with the left
 * edge of the clip lane.
 */
const Timeline = memo(function Timeline({
    layers,
    layerNames,
    sourceKindByLayerId,
    intrinsicDurations,
    configuredTotalDuration,
    fps,
    playhead,
    clock = null,
    isPlaying,
    audioMuted,
    selectedLayerId,
    onTogglePlay,
    onSeek,
    onToggleAudioMute,
    onSelectLayer,
    onUpdateLayer,
    onTrimStart,
    onSplitLayer,
    onDeleteClip,
    onToggleRow,
    onRemoveRow,
}: TimelineProps) {
    const total = useMemo(
        () => computeTimelineDuration(layers, configuredTotalDuration, intrinsicDurations),
        [layers, configuredTotalDuration, intrinsicDurations],
    );

    const rulerLengthSeconds = Math.max(total, 5);

    // Display in array order: array[0] = top of the visual stack, shown as the
    // TOP row — matching the left-side layer list and the actual z-index (the
    // renderer paints array[0] last = on top). Previously this reversed, which
    // put the top layer at the BOTTOM of the timeline (inconsistent with the
    // side panel).
    const displayLayers = layers;

    // Group display layers into rows by sourceHandleId. One row = all clips
    // fed by the same upstream connection. Order follows displayLayers, so
    // z-order and the contiguity invariant are preserved.
    const rows = useMemo(() => {
        const out: { sourceHandleId: string; layers: CompositorLayer[] }[] = [];
        const indexByHandle = new Map<string, number>();
        for (const layer of displayLayers) {
            const key = layer.sourceHandleId;
            let i = indexByHandle.get(key);
            if (i === undefined) {
                i = out.length;
                indexByHandle.set(key, i);
                out.push({ sourceHandleId: key, layers: [] });
            }
            out[i].layers.push(layer);
        }
        return out;
    }, [displayLayers]);

    // Timeline zoom — pixels per second. Session-only view state (never
    // persisted to node config). Default matches the historical fixed value.
    const [pixelsPerSecond, setPixelsPerSecond] = useState(PIXELS_PER_SECOND);

    const tickStep = useMemo(() => {
        // Smallest "nice" step whose on-screen gap is >= 48px, so labels never crowd.
        const NICE = [1, 2, 5, 10, 15, 30, 60, 120, 300];
        const minPx = 48;
        for (const s of NICE) {
            if (s * pixelsPerSecond >= minPx) return s;
        }
        return NICE[NICE.length - 1];
    }, [pixelsPerSecond]);

    const tickMarks = useMemo(() => {
        const marks: number[] = [];
        for (let t = 0; t <= rulerLengthSeconds + tickStep; t += tickStep) marks.push(t);
        return marks;
    }, [rulerLengthSeconds, tickStep]);

    // Per-layer snap targets, memoized so the array reference is stable across
    // Timeline re-renders. ClipBlock keeps a ref to this; reusing the same
    // reference means no churn inside the drag handler.
    const snapTargetsByLayerId = useMemo<Record<string, number[]>>(() => {
        const map: Record<string, number[]> = {};
        for (const layer of layers) {
            const targets: number[] = [0];
            for (const other of layers) {
                if (other.id === layer.id) continue;
                const otherKind = sourceKindByLayerId[other.id] ?? 'unknown';
                const otherIntrinsic = intrinsicDurations[other.id] ?? null;
                const otherEff = getEffectiveDuration(other, otherKind, otherIntrinsic, total);
                const start = Math.max(0, other.startTime || 0);
                targets.push(start, start + otherEff);
            }
            map[layer.id] = targets;
        }
        return map;
    }, [layers, sourceKindByLayerId, intrinsicDurations, total]);

    const labelScrollRef = useRef<HTMLDivElement>(null);
    const laneScrollRef = useRef<HTMLDivElement>(null);
    // Ref to the inner content div (the one whose width equals the ruler's
    // total pixel length). Drag-to-scrub uses its bounding rect to convert
    // pointer clientX into a timeline second.
    const contentRef = useRef<HTMLDivElement>(null);
    // Ref to the playhead line — direct-DOM updates during a scrub drag
    // bypass React's render path so the line follows the cursor 1:1 even
    // when the surrounding tree is slow to re-render.
    const playheadOverlayRef = useRef<HTMLDivElement>(null);

    // Snap guide: a child `<ClipBlock>` reports a snap value while the user
    // drags; we render a vertical line across all tracks at that x-position
    // so the snap point is visible (matches the visual feedback in
    // professional video editors).
    const [activeSnap, setActiveSnap] = useState<number | null>(null);

    // Sync vertical scroll between label gutter and lane so rows always line
    // up across the divider.
    const onLabelScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
        const lane = laneScrollRef.current;
        if (lane && lane.scrollTop !== e.currentTarget.scrollTop) {
            lane.scrollTop = e.currentTarget.scrollTop;
        }
    }, []);
    const onLaneScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
        const label = labelScrollRef.current;
        if (label && label.scrollTop !== e.currentTarget.scrollTop) {
            label.scrollTop = e.currentTarget.scrollTop;
        }
    }, []);

    /**
     * Click-and-drag scrub. Replaces the previous `onClick` (which couldn't
     * fire until pointer release — that's why the playhead used to "jump" to
     * the drop point instead of following the cursor).
     *
     * The pointer position is converted to a timeline second once per
     * animation frame (rAF-coalesced, so 1000Hz mice don't flood React with
     * setState calls), AND the playhead line's `style.left` is written
     * directly to the DOM every move so the user sees it follow the cursor
     * even if React's re-render is slow.
     */
    const startScrub = useCallback((e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const captureTarget = e.currentTarget as Element;
        captureTarget.setPointerCapture?.(e.pointerId);

        let pending: number | null = null;
        let rafHandle: number | null = null;

        const flush = () => {
            rafHandle = null;
            if (pending === null) return;
            const el = contentRef.current;
            if (!el) { pending = null; return; }
            const rect = el.getBoundingClientRect();
            const x = pending - rect.left;
            const t = Math.max(0, Math.min(rulerLengthSeconds, x / pixelsPerSecond));
            onSeek(t);
            pending = null;
        };

        const apply = (clientX: number) => {
            // 1. Instant visual feedback via direct-DOM. The line follows the
            //    cursor at native pointer rate.
            const el = contentRef.current;
            const overlay = playheadOverlayRef.current;
            if (el && overlay) {
                const rect = el.getBoundingClientRect();
                const x = Math.max(0, Math.min(rulerLengthSeconds * pixelsPerSecond, clientX - rect.left));
                overlay.style.left = `${x}px`;
            }
            // 2. rAF-coalesced React state update so the video / transport
            //    catch up at 60Hz max.
            pending = clientX;
            if (rafHandle === null) rafHandle = requestAnimationFrame(flush);
        };

        apply(e.clientX);

        const onMove = (ev: PointerEvent) => apply(ev.clientX);
        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            if (rafHandle !== null) cancelAnimationFrame(rafHandle);
            // Ensure the final position is committed to state (otherwise a
            // very fast click-and-release could leave `pending` unflushed).
            flush();
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }, [rulerLengthSeconds, onSeek, pixelsPerSecond]);

    const playheadX = playhead * pixelsPerSecond;
    const totalWidth = rulerLengthSeconds * pixelsPerSecond;

    // While playing, drive the playhead line per-frame straight from the
    // transport clock — same direct-DOM mechanism the scrub drag uses above.
    // React's `playhead` prop commits at ~10Hz; left as the paused/structural
    // position (the inline style below re-syncs on every commit).
    useEffect(() => {
        if (!clock || !isPlaying) return;
        const unsub = clock.subscribe((t) => {
            const overlay = playheadOverlayRef.current;
            if (overlay) overlay.style.left = `${t * pixelsPerSecond}px`;
        });
        return unsub;
    }, [clock, isPlaying, pixelsPerSecond]);

    return (
        // No backdrop-filter here: the playhead line moves every frame during
        // playback, and a blur over it re-rasterizes the whole panel per frame.
        <div className="h-full flex flex-col bg-black/40">
            <Transport
                playhead={playhead}
                totalDuration={total}
                fps={fps}
                isPlaying={isPlaying}
                audioMuted={audioMuted}
                onTogglePlay={onTogglePlay}
                onSeek={onSeek}
                onToggleAudioMute={onToggleAudioMute}
            />

            <div className="flex items-center gap-2 px-3 py-1 border-b border-white/5 bg-black/20">
                <span className="text-[9px] uppercase tracking-widest text-white/30">Zoom</span>
                <input
                    type="range"
                    min={PPS_MIN}
                    max={PPS_MAX}
                    step={1}
                    value={pixelsPerSecond}
                    onChange={(e) => setPixelsPerSecond(Number(e.target.value))}
                    className="w-40 h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-accent-primary"
                />
                <span className="text-[9px] tabular-nums text-white/40 w-10">{pixelsPerSecond}px/s</span>
            </div>

            <div className="flex-1 flex overflow-hidden">
                {/* ── LABEL COLUMN ────────────────────────────────────────── */}
                <div
                    className="flex-shrink-0 border-r border-white/5 bg-white/[0.02] flex flex-col"
                    style={{ width: LABEL_COLUMN_WIDTH }}
                >
                    {/* Empty spacer to match ruler height — keeps row N's label
                        aligned with row N's clip lane. */}
                    <div
                        className="flex-shrink-0 border-b border-white/5"
                        style={{ height: RULER_HEIGHT }}
                    />
                    <div
                        ref={labelScrollRef}
                        className="flex-1 overflow-y-auto custom-scrollbar"
                        onScroll={onLabelScroll}
                    >
                        {rows.map((row) => {
                            const head = row.layers[0];
                            const kind = sourceKindByLayerId[head.id] ?? 'unknown';
                            const rowSelected = row.layers.some((l) => l.id === selectedLayerId);
                            const clipCount = row.layers.length;
                            return (
                                <ContextMenu.Root key={row.sourceHandleId}>
                                    <ContextMenu.Trigger asChild>
                                        <div
                                            className={cn(
                                                'flex items-center gap-1.5 px-2 border-b border-white/[0.03]',
                                                rowSelected && 'bg-white/[0.04]',
                                            )}
                                            style={{ height: ROW_HEIGHT }}
                                            onClick={() => onSelectLayer(head.id)}
                                        >
                                            <Play className="w-3 h-3 text-white/40 flex-shrink-0" />
                                            <span className="text-[11px] text-white/70 truncate flex-1 cursor-default select-none">
                                                {(layerNames?.[head.id] || head.name)}{clipCount > 1 ? ` (${clipCount})` : ''}
                                            </span>
                                            {(kind === 'video' || kind === 'audio') && (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); onToggleRow(row.sourceHandleId, 'muted'); }}
                                                    className="p-0.5 text-white/40 hover:text-white/80 transition-colors"
                                                    title={head.muted ? 'Unmute row' : 'Mute row'}
                                                >
                                                    {head.muted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
                                                </button>
                                            )}
                                            <button
                                                onClick={(e) => { e.stopPropagation(); onToggleRow(row.sourceHandleId, 'visible'); }}
                                                className="p-0.5 text-white/40 hover:text-white/80 transition-colors"
                                                title={head.visible ? 'Hide row' : 'Show row'}
                                            >
                                                {head.visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                                            </button>
                                            <button
                                                onClick={(e) => { e.stopPropagation(); onToggleRow(row.sourceHandleId, 'locked'); }}
                                                className="p-0.5 text-white/40 hover:text-white/80 transition-colors"
                                                title={head.locked ? 'Unlock row' : 'Lock row'}
                                            >
                                                {head.locked
                                                    ? <Lock className="w-3 h-3 text-amber-500" />
                                                    : <Unlock className="w-3 h-3" />}
                                            </button>
                                        </div>
                                    </ContextMenu.Trigger>
                                    <ContextMenu.Portal>
                                        <ContextMenu.Content className="z-[100001] min-w-[160px] rounded-lg border border-white/10 bg-surface-elevated/95 backdrop-blur-md p-1 shadow-xl">
                                            <ContextMenu.Item
                                                onSelect={() => onRemoveRow(row.sourceHandleId)}
                                                className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-white/80 rounded-md cursor-pointer outline-none data-[highlighted]:bg-white/10"
                                            >
                                                <Trash2 className="w-3 h-3" /> Remove row
                                            </ContextMenu.Item>
                                        </ContextMenu.Content>
                                    </ContextMenu.Portal>
                                </ContextMenu.Root>
                            );
                        })}
                    </div>
                </div>

                {/* ── LANE (ruler + clip rows + playhead) ─────────────────── */}
                <div
                    ref={laneScrollRef}
                    className="flex-1 overflow-x-auto overflow-y-auto custom-scrollbar relative"
                    onScroll={onLaneScroll}
                >
                    <div ref={contentRef} className="relative" style={{ width: totalWidth, minHeight: '100%' }}>
                        {/* Ruler — left=0 here aligns with the lane's left edge,
                            which is the right side of the label column. So 0s
                            visually sits exactly where clip startTime=0 sits. */}
                        <div
                            className="cursor-pointer select-none border-b border-white/5 sticky top-0 bg-[#101014]/95 z-10"
                            style={{ height: RULER_HEIGHT }}
                            onPointerDown={startScrub}
                        >
                            {tickMarks.map((t) => (
                                <div
                                    key={t}
                                    className="absolute top-0 bottom-0 border-l border-white/10"
                                    style={{ left: t * pixelsPerSecond }}
                                >
                                    <span className="absolute top-0.5 left-1 text-[9px] text-white/40 tabular-nums">
                                        {t}s
                                    </span>
                                </div>
                            ))}
                        </div>

                        {/* Clip rows — one per source row; clips share the row */}
                        <div className="relative">
                            {rows.map((row) => {
                                const rowSelected = row.layers.some((l) => l.id === selectedLayerId);
                                return (
                                    <div
                                        key={row.sourceHandleId}
                                        className={cn(
                                            'relative border-b border-white/[0.03]',
                                            rowSelected && 'bg-white/[0.04]',
                                        )}
                                        style={{ height: ROW_HEIGHT }}
                                    >
                                        {row.layers.map((layer) => {
                                            const kind = sourceKindByLayerId[layer.id] ?? 'unknown';
                                            const intrinsic = intrinsicDurations[layer.id] ?? null;
                                            const eff = getEffectiveDuration(layer, kind, intrinsic, total);
                                            const isSelected = selectedLayerId === layer.id;
                                            const maxDuration = (kind === 'video' || kind === 'audio') && intrinsic !== null
                                                ? Math.max(0.1, intrinsic - (layer.trimIn || 0))
                                                : null;
                                            return (
                                                <ContextMenu.Root key={layer.id}>
                                                    <ContextMenu.Trigger asChild>
                                                        <div className="contents">
                                                            <ClipBlock
                                                                layer={layer}
                                                                sourceKind={kind}
                                                                effectiveDuration={eff}
                                                                pixelsPerSecond={pixelsPerSecond}
                                                                maxDuration={maxDuration}
                                                                isSelected={isSelected}
                                                                onSelect={() => onSelectLayer(layer.id)}
                                                                onMove={(startTime) => onUpdateLayer(layer.id, { startTime })}
                                                                onResizeRight={(duration) => onUpdateLayer(layer.id, { duration })}
                                                                onTrimStart={(startTime, duration, trimIn) => onTrimStart(layer.id, startTime, duration, trimIn)}
                                                                snapTargets={snapTargetsByLayerId[layer.id] || [0]}
                                                                onSnapChange={setActiveSnap}
                                                            />
                                                        </div>
                                                    </ContextMenu.Trigger>
                                                    <ContextMenu.Portal>
                                                        <ContextMenu.Content className="z-[100001] min-w-[160px] rounded-lg border border-white/10 bg-surface-elevated/95 backdrop-blur-md p-1 shadow-xl">
                                                            <ContextMenu.Item
                                                                onSelect={() => onSplitLayer(layer.id)}
                                                                className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-white/80 rounded-md cursor-pointer outline-none data-[highlighted]:bg-white/10"
                                                            >
                                                                <Scissors className="w-3 h-3" /> Split at playhead
                                                            </ContextMenu.Item>
                                                            <ContextMenu.Item
                                                                onSelect={() => onDeleteClip(layer.id)}
                                                                className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-white/80 rounded-md cursor-pointer outline-none data-[highlighted]:bg-white/10"
                                                            >
                                                                <Trash2 className="w-3 h-3" /> Delete clip
                                                            </ContextMenu.Item>
                                                        </ContextMenu.Content>
                                                    </ContextMenu.Portal>
                                                </ContextMenu.Root>
                                            );
                                        })}
                                    </div>
                                );
                            })}
                            {rows.length === 0 && (
                                <div className="h-12 flex items-center justify-center text-[10px] text-white/30">
                                    Connect layers to see them on the timeline.
                                </div>
                            )}
                        </div>

                        {/* Snap guide — visible only while a clip drag is hitting a
                            snap target. Sits below the playhead's z-index so the
                            playhead always wins visually if they overlap. */}
                        {activeSnap !== null && (
                            <div
                                className="absolute top-0 bottom-0 w-px bg-accent-primary/70 pointer-events-none z-10 shadow-[0_0_2px_rgb(var(--accent-primary)/0.45)]"
                                style={{ left: activeSnap * pixelsPerSecond }}
                            />
                        )}

                        {/* Playhead — thin neutral line; small flat grip at top.
                            Line is pointer-events-none so clicks pass to clips. */}
                        <div
                            ref={playheadOverlayRef}
                            className="absolute top-0 bottom-0 w-px bg-white/70 pointer-events-none z-20"
                            style={{ left: playheadX }}
                        >
                            <div
                                className="absolute -top-0.5 -left-1 w-2 h-2 rounded-sm bg-white/80 cursor-ew-resize pointer-events-auto"
                                onPointerDown={startScrub}
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
});

export default Timeline;
