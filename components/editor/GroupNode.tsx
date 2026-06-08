'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NodeProps, NodeToolbar, Position, useReactFlow } from 'reactflow';
import * as LucideIcons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAppStore } from '@/lib/store/app-store';
import { useShallow } from 'zustand/react/shallow';
import { GROUP_PADDING, GROUP_RESIZE_HANDLE_SIZE } from '@/lib/nodes/group-constants';
import { GroupHeaderToolbar } from './GroupHeaderToolbar';
import { useWireDrag } from '@/lib/editor/wire-drag-context';
import { useCollabCanvas } from '@/lib/editor/collab-canvas-context';

interface GroupNodeData {
    label: string;
    config: {
        width: number;
        height: number;
        icon?: string;
        color?: 'neutral' | 'indigo' | 'emerald' | 'rose' | 'amber' | 'sky';
    };
}

function resolveIcon(name: string | undefined): LucideIcon {
    if (!name) return LucideIcons.Folder;
    const Candidate = (LucideIcons as any)[name];
    if (Candidate && (typeof Candidate === 'function' || typeof Candidate === 'object')) {
        return Candidate as LucideIcon;
    }
    return LucideIcons.Folder;
}

type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const GROUP_COLOR_CLASSES: Record<string, { bgRgba: string; borderRgba: string }> = {
    neutral: { bgRgba: 'rgba(127, 127, 127, 0.10)', borderRgba: 'rgba(127, 127, 127, 0.375)' },
    indigo:  { bgRgba: 'rgba(99, 102, 241, 0.10)',  borderRgba: 'rgba(99, 102, 241, 0.375)' },
    emerald: { bgRgba: 'rgba(16, 185, 129, 0.10)',  borderRgba: 'rgba(16, 185, 129, 0.375)' },
    rose:    { bgRgba: 'rgba(244, 63, 94, 0.10)',   borderRgba: 'rgba(244, 63, 94, 0.375)' },
    amber:   { bgRgba: 'rgba(245, 158, 11, 0.10)',  borderRgba: 'rgba(245, 158, 11, 0.375)' },
    sky:     { bgRgba: 'rgba(14, 165, 233, 0.10)',  borderRgba: 'rgba(14, 165, 233, 0.375)' },
};

const HANDLES: Array<{ dir: ResizeDir; cursor: string; style: React.CSSProperties }> = [
    { dir: 'n',  cursor: 'ns-resize', style: { top: -GROUP_RESIZE_HANDLE_SIZE / 2, left: GROUP_RESIZE_HANDLE_SIZE, right: GROUP_RESIZE_HANDLE_SIZE, height: GROUP_RESIZE_HANDLE_SIZE } },
    { dir: 's',  cursor: 'ns-resize', style: { bottom: -GROUP_RESIZE_HANDLE_SIZE / 2, left: GROUP_RESIZE_HANDLE_SIZE, right: GROUP_RESIZE_HANDLE_SIZE, height: GROUP_RESIZE_HANDLE_SIZE } },
    { dir: 'e',  cursor: 'ew-resize', style: { right: -GROUP_RESIZE_HANDLE_SIZE / 2, top: GROUP_RESIZE_HANDLE_SIZE, bottom: GROUP_RESIZE_HANDLE_SIZE, width: GROUP_RESIZE_HANDLE_SIZE } },
    { dir: 'w',  cursor: 'ew-resize', style: { left: -GROUP_RESIZE_HANDLE_SIZE / 2, top: GROUP_RESIZE_HANDLE_SIZE, bottom: GROUP_RESIZE_HANDLE_SIZE, width: GROUP_RESIZE_HANDLE_SIZE } },
    { dir: 'ne', cursor: 'nesw-resize', style: { top: -GROUP_RESIZE_HANDLE_SIZE / 2, right: -GROUP_RESIZE_HANDLE_SIZE / 2, width: GROUP_RESIZE_HANDLE_SIZE, height: GROUP_RESIZE_HANDLE_SIZE } },
    { dir: 'nw', cursor: 'nwse-resize', style: { top: -GROUP_RESIZE_HANDLE_SIZE / 2, left: -GROUP_RESIZE_HANDLE_SIZE / 2, width: GROUP_RESIZE_HANDLE_SIZE, height: GROUP_RESIZE_HANDLE_SIZE } },
    { dir: 'se', cursor: 'nwse-resize', style: { bottom: -GROUP_RESIZE_HANDLE_SIZE / 2, right: -GROUP_RESIZE_HANDLE_SIZE / 2, width: GROUP_RESIZE_HANDLE_SIZE, height: GROUP_RESIZE_HANDLE_SIZE } },
    { dir: 'sw', cursor: 'nesw-resize', style: { bottom: -GROUP_RESIZE_HANDLE_SIZE / 2, left: -GROUP_RESIZE_HANDLE_SIZE / 2, width: GROUP_RESIZE_HANDLE_SIZE, height: GROUP_RESIZE_HANDLE_SIZE } },
];

export default function GroupNode({ id, data, selected }: NodeProps<GroupNodeData>) {
    const wireDrag = useWireDrag();
    const isWireDragging = wireDrag !== null;

    // AI-add reveal-on-settle: a freshly-added group stays invisible until the
    // end-of-turn measured re-layout reveals it in its settled position (same
    // gate child nodes use in BaseNode). Without this the group shell renders
    // immediately at the server's fallback-sized position, then jumps once the
    // re-layout runs — the "not sitting right" flash the user reported.
    const isHiddenForReveal = useAppStore((s) => !!s.aiTurn?.hiddenAddedIds?.includes(id));

    // Stored size — set at creation (AI synthesis or manual group action) and
    // updated by the resize handles. Acts as the FLOOR for our rendered size.
    const storedWidth = data.config?.width ?? 400;
    const storedHeight = data.config?.height ?? 300;
    const iconName = data.config?.icon ?? 'Folder';
    const colorToken = data.config?.color ?? 'neutral';
    const GroupIcon = resolveIcon(iconName);

    // Dynamic child bbox — read children with parentNode === id from the
    // store and compute the rightmost/bottommost extent. This reacts to:
    //   • child position changes (RF onNodesChange writes new positions)
    //   • child measured-size changes (RF ResizeObserver writes measured.w/h
    //     when content reflows — e.g., when execution output renders below
    //     a node and the node body grows).
    // useShallow keeps the selector from causing renders on object identity
    // alone; we re-render only when one of the numbers actually changes.
    const childBbox = useAppStore(useShallow((s) => {
        const allNodes = s.currentWorkflow?.nodes ?? [];
        let maxX = 0;
        let maxY = 0;
        for (const c of allNodes as any[]) {
            if (c.parentNode !== id) continue;
            const cx = c.position?.x ?? 0;
            const cy = c.position?.y ?? 0;
            const cw = c.measured?.width ?? c.width ?? 240;
            const ch = c.measured?.height ?? c.height ?? 120;
            if (cx + cw > maxX) maxX = cx + cw;
            if (cy + ch > maxY) maxY = cy + ch;
        }
        return { maxX, maxY };
    }));

    // Required size to fully wrap the children with consistent padding.
    // 0 when there are no children yet (bbox stays at 0,0) — falls back to
    // stored size.
    const requiredWidth  = childBbox.maxX > 0 ? childBbox.maxX + GROUP_PADDING : 0;
    const requiredHeight = childBbox.maxY > 0 ? childBbox.maxY + GROUP_PADDING : 0;

    // Final rendered size: max of stored and required. This means:
    //   • If the AI's bbox guess was too small (children's actual rendered
    //     widths are larger than the 240/120 fallback), the group grows to
    //     wrap them correctly.
    //   • If a child grows mid-execution (output renders below), the group
    //     follows along automatically.
    //   • If the user manually resized the group LARGER than its children,
    //     storedWidth/Height wins — we never shrink below user intent.
    //   • If the user dragged the group SMALLER than its children, required
    //     wins — you can't squeeze a group below its contents.
    const renameGroup = useAppStore((s) => s.renameGroup);
    const resizeGroup = useAppStore((s) => s.resizeGroup);
    const takeSnapshot = useAppStore((s) => s.takeSnapshot);
    const { getZoom } = useReactFlow();

    // Transient drag state, paired:
    //   • liveSize     — current displayed width/height during the drag
    //   • liveShift    — CSS transform applied to the inner div for anchored
    //                    edges (W/N). Children are flat DOM siblings (not
    //                    nested inside the group's div), so a transform on
    //                    THIS div doesn't move them — they stay world-pinned
    //                    for free, with zero setNodes / zero Zustand writes
    //                    per pointer tick.
    // Both clear on pointerup once resizeGroup commits the final geometry.
    const [liveSize, setLiveSize] = useState<{ w: number; h: number } | null>(null);
    const [liveShift, setLiveShift] = useState<{ x: number; y: number } | null>(null);

    // Collaboration: broadcast our own in-flight resize, and mirror a peer's.
    const collab = useCollabCanvas();
    // A peer's live resize geometry for THIS group (undefined unless a peer is
    // actively resizing it). We're never both the resizer and a receiver of our
    // own broadcast (self:false), so liveSize (local) and remoteLive never clash.
    const remoteLive = useAppStore((s) => s.liveNodeSizes[id]);

    const baseWidth  = Math.max(storedWidth,  requiredWidth);
    const baseHeight = Math.max(storedHeight, requiredHeight);
    const width  = liveSize?.w ?? remoteLive?.w ?? baseWidth;
    const height = liveSize?.h ?? remoteLive?.h ?? baseHeight;
    // Anchored-edge shift: our own during a local resize, else a peer's.
    const shift = liveShift ?? (remoteLive ? { x: remoteLive.sx, y: remoteLive.sy } : null);

    const hoveredGroupId = useAppStore((s) => s.dragHoverGroupId);
    const isHoverTarget = hoveredGroupId === id;
    const updateNodeConfig = useAppStore((s) => s.updateNodeConfig);
    const ungroupNode = useAppStore((s) => s.ungroupNode);
    // View-only (collaboration viewer): no group editing — rename, icon/color
    // picker, and ungroup are all disabled.
    const isViewer = useAppStore((s) => s.collabRole === 'viewer');

    const handleIconChange = useCallback((icon: string) => {
        if (isViewer) return;
        updateNodeConfig(id, { ...data.config, icon });
    }, [id, data.config, updateNodeConfig, isViewer]);

    const handleColorChange = useCallback((color: 'neutral' | 'indigo' | 'emerald' | 'rose' | 'amber' | 'sky') => {
        if (isViewer) return;
        updateNodeConfig(id, { ...data.config, color });
    }, [id, data.config, updateNodeConfig, isViewer]);

    const handleUngroup = useCallback(() => {
        if (isViewer) return;
        ungroupNode(id);
    }, [id, ungroupNode, isViewer]);

    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [titleDraft, setTitleDraft] = useState(data.label || '');
    const inputRef = useRef<HTMLInputElement>(null);

    // Sync draft when label changes externally (undo/redo, AI patch).
    useEffect(() => {
        if (!isEditingTitle) setTitleDraft(data.label || '');
    }, [data.label, isEditingTitle]);

    const commitTitle = useCallback(() => {
        const next = titleDraft.trim() || 'Group';
        renameGroup(id, next);
        setIsEditingTitle(false);
    }, [id, titleDraft, renameGroup]);

    const cancelTitle = useCallback(() => {
        setTitleDraft(data.label || '');
        setIsEditingTitle(false);
    }, [data.label]);

    useEffect(() => {
        if (isEditingTitle) inputRef.current?.select();
    }, [isEditingTitle]);

    // Auto-size the title input to its content. We render an off-screen span
    // with the SAME font styling as the input, then read its offsetWidth and
    // mirror it onto the input. useLayoutEffect runs synchronously before
    // paint so the user never sees a stale width while typing.
    const measureRef = useRef<HTMLSpanElement>(null);
    const [inputWidth, setInputWidth] = useState(40);
    useLayoutEffect(() => {
        if (!isEditingTitle) return;
        if (measureRef.current) {
            // +6px buffer leaves room for the caret on the trailing edge.
            setInputWidth(Math.max(20, measureRef.current.offsetWidth + 6));
        }
    }, [titleDraft, isEditingTitle]);

    const dragStateRef = useRef<{
        dir: ResizeDir;
        startX: number;
        startY: number;
        startW: number;
        startH: number;
    } | null>(null);

    // rAF-coalesce per-tick work to one update per frame; high-poll mice can
    // fire 240–1000 Hz pointermoves which would otherwise do redundant work.
    const rafIdRef = useRef<number | null>(null);
    const latestPointerRef = useRef<{ clientX: number; clientY: number } | null>(null);

    const flushResize = useCallback(() => {
        rafIdRef.current = null;
        const s = dragStateRef.current;
        const pos = latestPointerRef.current;
        if (!s || !pos) return;

        // Screen→canvas conversion: RF viewport is `transform: scale(zoom)`.
        const zoom = getZoom() || 1;
        const dx = (pos.clientX - s.startX) / zoom;
        const dy = (pos.clientY - s.startY) / zoom;

        let newW = s.startW;
        let newH = s.startH;
        if (s.dir.includes('e')) newW = s.startW + dx;
        if (s.dir.includes('w')) newW = s.startW - dx;
        if (s.dir.includes('s')) newH = s.startH + dy;
        if (s.dir.includes('n')) newH = s.startH - dy;

        // Hard floor only — soft floor (children-bbox) is enforced by the
        // slice on commit. During the drag we let the user push toward it
        // and the slice clamps cleanly when they release.
        newW = Math.max(newW, GROUP_PADDING * 2);
        newH = Math.max(newH, GROUP_PADDING * 2);

        setLiveSize({ w: newW, h: newH });

        // Anchored axes: shift the inner div left/up via CSS transform so the
        // un-dragged edge stays pinned in world space. Children are flat DOM
        // siblings (not nested), so the transform doesn't touch them —
        // world-pinning happens for free.
        const anchorRight = s.dir.includes('w');
        const anchorBottom = s.dir.includes('n');
        const sx = anchorRight ? -(newW - s.startW) : 0;
        const sy = anchorBottom ? -(newH - s.startH) : 0;
        if (anchorRight || anchorBottom) {
            setLiveShift({ x: sx, y: sy });
        } else if (liveShift !== null) {
            setLiveShift(null);
        }

        // Broadcast the in-flight geometry + live cursor so peers see the border
        // resize (and the cursor track) during the drag, not only on release.
        collab.liveResize(id, newW, newH, sx, sy);
        collab.cursorMove(pos.clientX, pos.clientY);
    }, [getZoom, liveShift, collab, id]);

    const onResizePointerDown = useCallback((e: React.PointerEvent, dir: ResizeDir) => {
        e.stopPropagation();
        e.preventDefault();
        (e.target as Element).setPointerCapture(e.pointerId);
        // Single undo snapshot covering the whole drag.
        takeSnapshot();
        dragStateRef.current = {
            dir,
            startX: e.clientX,
            startY: e.clientY,
            startW: width,
            startH: height,
        };
        latestPointerRef.current = { clientX: e.clientX, clientY: e.clientY };
    }, [width, height, takeSnapshot]);

    const onResizePointerMove = useCallback((e: React.PointerEvent) => {
        if (!dragStateRef.current) return;
        latestPointerRef.current = { clientX: e.clientX, clientY: e.clientY };
        if (rafIdRef.current !== null) return;
        rafIdRef.current = requestAnimationFrame(flushResize);
    }, [flushResize]);

    const onResizePointerUp = useCallback((e: React.PointerEvent) => {
        if ((e.target as Element).hasPointerCapture(e.pointerId)) {
            (e.target as Element).releasePointerCapture(e.pointerId);
        }
        if (rafIdRef.current !== null) {
            cancelAnimationFrame(rafIdRef.current);
            rafIdRef.current = null;
        }
        const s = dragStateRef.current;
        const pos = latestPointerRef.current;
        if (s && pos) {
            const zoom = getZoom() || 1;
            const dx = (pos.clientX - s.startX) / zoom;
            const dy = (pos.clientY - s.startY) / zoom;
            let newW = s.startW;
            let newH = s.startH;
            if (s.dir.includes('e')) newW = s.startW + dx;
            if (s.dir.includes('w')) newW = s.startW - dx;
            if (s.dir.includes('s')) newH = s.startH + dy;
            if (s.dir.includes('n')) newH = s.startH - dy;
            const anchorRight = s.dir.includes('w');
            const anchorBottom = s.dir.includes('n');
            // Final geometry to peers so their live ghost matches the commit;
            // the committed structural state (debounced) clears it shortly after.
            const sx = anchorRight ? -(newW - s.startW) : 0;
            const sy = anchorBottom ? -(newH - s.startH) : 0;
            collab.liveResize(id, newW, newH, sx, sy);
            // Slice owns the soft-floor clamp, the group-origin shift, and the
            // inverse child-local-position shift that keeps children world-
            // pinned. Snapshot already taken at pointerdown.
            resizeGroup(id, newW, newH, { anchorRight, anchorBottom, skipSnapshot: true });
            // Push the SETTLED structure to peers at once (Zustand set above is
            // synchronous, so currentWorkflow already holds the committed size).
            // This replaces the peer's live ghost immediately — without it the
            // commit only rode the 250ms debounce, which post-resize measured-
            // size churn kept rescheduling, so the peer snapped back to the old
            // size instead of updating.
            collab.commitNow();
        }
        setLiveSize(null);
        setLiveShift(null);
        dragStateRef.current = null;
        latestPointerRef.current = null;
    }, [id, resizeGroup, getZoom, collab]);

    return (
        <>
            {/* Title bubble — floats above the top-left of the group.
                NodeToolbar is rendered in a portal at constant screen-size,
                so the bubble does NOT scale with the canvas zoom (matching
                the multi-select toolbar's behavior). Click to edit. */}
            <NodeToolbar
                isVisible={!isHiddenForReveal}
                nodeId={id}
                position={Position.Top}
                align="start"
            >
                <div
                    className="nopan nowheel flex items-center px-2 py-1 rounded-md bg-surface-elevated/95 backdrop-blur-md border border-stroke-subtle shadow-lg"
                    style={{ pointerEvents: 'auto' }}
                    onMouseDown={(e) => e.stopPropagation()}
                >
                    <GroupIcon size={12} className="mr-1.5 text-content-secondary shrink-0" />
                    {isEditingTitle ? (
                        <>
                            <input
                                ref={inputRef}
                                value={titleDraft}
                                onChange={(e) => setTitleDraft(e.target.value)}
                                onBlur={commitTitle}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') commitTitle();
                                    else if (e.key === 'Escape') cancelTitle();
                                }}
                                style={{ width: inputWidth }}
                                className="bg-transparent text-content-primary text-xs font-medium px-1 outline-none focus:ring-0 nopan nodrag"
                            />
                            {/* Off-screen mirror used solely for width measurement.
                                whitespace:pre preserves leading/trailing spaces so the
                                width tracks exactly what's visible. */}
                            <span
                                ref={measureRef}
                                aria-hidden
                                className="text-xs font-medium px-1"
                                style={{
                                    position: 'absolute',
                                    visibility: 'hidden',
                                    whiteSpace: 'pre',
                                    pointerEvents: 'none',
                                    left: -9999,
                                    top: -9999,
                                }}
                            >
                                {titleDraft || ' '}
                            </span>
                        </>
                    ) : (
                        <button
                            type="button"
                            onClick={(e) => {
                                e.stopPropagation();
                                if (isViewer) return;
                                setIsEditingTitle(true);
                            }}
                            className={
                                "text-content-primary text-xs font-medium px-1 " +
                                (isViewer ? "cursor-default" : "cursor-text")
                            }
                        >
                            {data.label || 'Group'}
                        </button>
                    )}
                    {/* Icon / color / ungroup menu — hidden in view-only. */}
                    {!isViewer && (
                        <GroupHeaderToolbar
                            currentIcon={iconName}
                            currentColor={colorToken}
                            onIconChange={handleIconChange}
                            onColorChange={handleColorChange}
                            onUngroup={handleUngroup}
                        />
                    )}
                </div>
            </NodeToolbar>

            <div
                className={
                    // Border state precedence: drag-IN target highlight > selection
                    // highlight > hover highlight > default. Hover-into-group during
                    // a drag (isHoverTarget) wins because it's a transient action.
                    "group relative rounded-2xl transition-colors " +
                    (isHoverTarget
                        ? "border-2 border-accent-primary"
                        : selected
                            ? "border-2 border-accent-primary"
                            : "border")
                }
                style={{
                    width,
                    height,
                    // Translucent color fill — driven by the group's color token.
                    background: GROUP_COLOR_CLASSES[colorToken]?.bgRgba ?? GROUP_COLOR_CLASSES.neutral.bgRgba,
                    // Tinted border when not selected/hover-target.
                    borderColor: (isHoverTarget || selected) ? undefined : GROUP_COLOR_CLASSES[colorToken]?.borderRgba,
                    // CSS transform during anchored-axis drags (W/N) — shifts
                    // the inner div visually without touching RF's data model
                    // for the group OR its children. Cleared on pointerup. Uses a
                    // peer's broadcast shift when they're the one resizing.
                    transform: shift ? `translate(${shift.x}px, ${shift.y}px)` : undefined,
                    // Let pointer events pass through the body so edges (wires)
                    // routed inside the group remain clickable. Interactive bits
                    // (resize handles, title bubble) opt back in below.
                    pointerEvents: 'none',
                    // Reveal-on-settle hide wins over wire-drag dimming.
                    // Wire-drag dimming: group containers have no connection handles
                    // so they are always incompatible during any active wire drag.
                    opacity: isHiddenForReveal ? 0 : (isWireDragging ? 0.3 : undefined),
                    filter: isWireDragging ? 'grayscale(0.6)' : undefined,
                    transition: (isWireDragging || isHiddenForReveal)
                        ? 'opacity 200ms, filter 150ms, border-color 150ms'
                        : 'opacity 200ms',
                }}
                data-group-id={id}
                data-group-selected={selected ? 'true' : 'false'}
            >
                {/* Resize handles — visible on hover or when the group is selected.
                    Always rendered so they participate in pointer hit-testing; their
                    opacity is what changes. */}
                {HANDLES.map((h) => (
                    <div
                        key={h.dir}
                        onPointerDown={(e) => onResizePointerDown(e, h.dir)}
                        onPointerMove={onResizePointerMove}
                        onPointerUp={onResizePointerUp}
                        className={
                            "absolute z-20 nopan nodrag transition-opacity " +
                            (selected ? "opacity-100" : "opacity-0 group-hover:opacity-100")
                        }
                        style={{ ...h.style, cursor: h.cursor, pointerEvents: 'auto' }}
                    />
                ))}
            </div>
        </>
    );
}
