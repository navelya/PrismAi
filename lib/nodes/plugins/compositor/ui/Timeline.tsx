'use client';

import React, { memo, useCallback, useMemo, useRef, useState } from 'react';
import { Eye, EyeOff, Lock, Unlock, Volume2, VolumeX, Play } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CompositorLayer } from '../definition';
import { LayerSourceKind, computeTimelineDuration, getEffectiveDuration } from '../shared';
import Transport from './Transport';
import ClipBlock from './ClipBlock';
import * as ContextMenu from '@radix-ui/react-context-menu';
import { Scissors, Trash2 } from 'lucide-react';

interface TimelineProps {
    /** Array order: array[0] = bottom of visual stack. We display TOP of stack
     *  at the TOP of the timeline (so we reverse for display), matching the
     *  compositor's left-side layer list and the After Effects convention. */
    layers: CompositorLayer[];
    sourceKindByLayerId: Record<string, LayerSourceKind>;
    intrinsicDurations: Record<string, number | null>;
    configuredTotalDuration: number | null;
    fps: number;
    playhead: number;
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

/** Pixels per second of the ruler. Stage 1 fixed; zoom slider is Stage 2. */
const PIXELS_PER_SECOND = 40;
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
    sourceKindByLayerId,
    intrinsicDurations,
    configuredTotalDuration,
    fps,
    playhead,
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

    const displayLayers = useMemo(() => [...layers].reverse(), [layers]);

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

    // Timeline zoom — pixels per second. (Promoted to state in a later task;
    // for now this aliases the module constant so render math reads from one
    // name.)
    const pixelsPerSecond = PIXELS_PER_SECOND;

    const tickMarks = useMemo(() => {
        const marks: number[] = [];
        const stepMajor = 5;
        for (let t = 0; t <= rulerLengthSeconds + stepMajor; t += stepMajor) marks.push(t);
        return marks;
    }, [rulerLengthSeconds]);

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
            const t = Math.max(0, Math.min(rulerLengthSeconds, x / PIXELS_PER_SECOND));
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
                const x = Math.max(0, Math.min(rulerLengthSeconds * PIXELS_PER_SECOND, clientX - rect.left));
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
    }, [rulerLengthSeconds, onSeek]);

    const playheadX = playhead * PIXELS_PER_SECOND;
    const totalWidth = rulerLengthSeconds * PIXELS_PER_SECOND;

    return (
        <div className="h-full flex flex-col bg-black/30 backdrop-blur-md">
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
                                                {head.name}{clipCount > 1 ? ` (${clipCount})` : ''}
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
                                        <ContextMenu.Content className="z-[200] min-w-[160px] rounded-lg border border-white/10 bg-surface-elevated/95 backdrop-blur-md p-1 shadow-xl">
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
                            className="relative cursor-pointer select-none border-b border-white/5 sticky top-0 bg-black/40 backdrop-blur-md z-10"
                            style={{ height: RULER_HEIGHT }}
                            onPointerDown={startScrub}
                        >
                            {tickMarks.map((t) => (
                                <div
                                    key={t}
                                    className="absolute top-0 bottom-0 border-l border-white/10"
                                    style={{ left: t * PIXELS_PER_SECOND }}
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
                                                        <ContextMenu.Content className="z-[200] min-w-[160px] rounded-lg border border-white/10 bg-surface-elevated/95 backdrop-blur-md p-1 shadow-xl">
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
                                className="absolute top-0 bottom-0 w-px bg-amber-300 pointer-events-none z-10 shadow-[0_0_4px_rgba(252,211,77,0.7)]"
                                style={{ left: activeSnap * PIXELS_PER_SECOND }}
                            />
                        )}

                        {/* Playhead overlay — the line itself is pointer-events-none so
                            clicks pass through to clips. The triangle handle at the top
                            re-enables pointer events so the user can grab the playhead
                            directly and drag it. */}
                        <div
                            ref={playheadOverlayRef}
                            className="absolute top-0 bottom-0 w-px bg-accent-primary pointer-events-none z-20"
                            style={{ left: playheadX }}
                        >
                            <div
                                className="absolute -top-1 -left-2 w-4 h-3 bg-accent-primary cursor-ew-resize pointer-events-auto"
                                style={{ clipPath: 'polygon(0 0, 100% 0, 50% 100%)' }}
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
