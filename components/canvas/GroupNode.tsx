'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { NodeProps, NodeToolbar, Position } from 'reactflow';
import { useAppStore } from '@/lib/store/app-store';
import { GROUP_RESIZE_HANDLE_SIZE } from '@/lib/nodes/group-constants';

interface GroupNodeData {
    label: string;
    config: { width: number; height: number };
}

type ResizeDir = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

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
    const width = data.config?.width ?? 400;
    const height = data.config?.height ?? 300;

    const renameGroup = useAppStore((s) => s.renameGroup);
    const resizeGroup = useAppStore((s) => s.resizeGroup);
    const hoveredGroupId = useAppStore((s) => s.dragHoverGroupId);
    const isHoverTarget = hoveredGroupId === id;

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

    // Pointer-driven resize. We capture the pointer on mousedown, then the
    // active-direction state and starting geometry are read from refs (NOT
    // React state) so the handler fires at native rate without re-renders.
    const dragStateRef = useRef<{
        dir: ResizeDir;
        startX: number;
        startY: number;
        startW: number;
        startH: number;
    } | null>(null);

    const onResizePointerDown = useCallback((e: React.PointerEvent, dir: ResizeDir) => {
        e.stopPropagation();
        e.preventDefault();
        (e.target as Element).setPointerCapture(e.pointerId);
        dragStateRef.current = {
            dir,
            startX: e.clientX,
            startY: e.clientY,
            startW: width,
            startH: height,
        };
    }, [width, height]);

    const onResizePointerMove = useCallback((e: React.PointerEvent) => {
        const s = dragStateRef.current;
        if (!s) return;
        const dx = e.clientX - s.startX;
        const dy = e.clientY - s.startY;

        let newW = s.startW;
        let newH = s.startH;
        if (s.dir.includes('e')) newW = s.startW + dx;
        if (s.dir.includes('w')) newW = s.startW - dx;
        if (s.dir.includes('s')) newH = s.startH + dy;
        if (s.dir.includes('n')) newH = s.startH - dy;

        // The slice clamps min size; we don't double-clamp here.
        resizeGroup(id, newW, newH);
    }, [id, resizeGroup]);

    const onResizePointerUp = useCallback((e: React.PointerEvent) => {
        if ((e.target as Element).hasPointerCapture(e.pointerId)) {
            (e.target as Element).releasePointerCapture(e.pointerId);
        }
        dragStateRef.current = null;
    }, []);

    return (
        <>
            {/* Title bubble — floats above the top-left of the group.
                NodeToolbar is rendered in a portal at constant screen-size,
                so the bubble does NOT scale with the canvas zoom (matching
                the multi-select toolbar's behavior). Click to edit. */}
            <NodeToolbar
                isVisible={true}
                nodeId={id}
                position={Position.Top}
                align="start"
            >
                <div
                    className="nopan nowheel flex items-center px-2 py-1 rounded-md bg-surface-elevated/95 backdrop-blur-md border border-stroke-subtle shadow-lg"
                    style={{ pointerEvents: 'auto' }}
                    onMouseDown={(e) => e.stopPropagation()}
                >
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
                                setIsEditingTitle(true);
                            }}
                            className="text-content-primary text-xs font-medium px-1 cursor-text"
                        >
                            {data.label || 'Group'}
                        </button>
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
                            : "border border-stroke-subtle/60 hover:border-content-secondary")
                }
                style={{
                    width,
                    height,
                    // Translucent gray fill — independent of theme tokens so the
                    // tint is visible on both dark and light canvas backgrounds.
                    background: 'rgba(127, 127, 127, 0.10)',
                    // The "group" Tailwind utility class above lets handles use
                    // group-hover:opacity-100 to fade in on hover.
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
                        style={{ ...h.style, cursor: h.cursor }}
                    />
                ))}
            </div>
        </>
    );
}
