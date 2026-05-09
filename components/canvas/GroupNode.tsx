'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { NodeProps } from 'reactflow';
import { useAppStore } from '@/lib/store/app-store';
import {
    GROUP_TITLE_BAR_HEIGHT,
    GROUP_RESIZE_HANDLE_SIZE,
} from '@/lib/nodes/group-constants';

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
        <div
            className="group relative rounded-2xl bg-bg-primary/60 border border-stroke-subtle/60 transition-colors"
            style={{
                width,
                height,
                // The "group" Tailwind utility class above lets handles use
                // group-hover:opacity-100 to fade in on hover.
            }}
            data-group-id={id}
            data-group-selected={selected ? 'true' : 'false'}
        >
            {/* Title (top-right). Single click selects the group via RF's normal
                selection handler; second click on the title turns into an input. */}
            <div
                className="absolute top-0 right-0 flex items-center pr-3 pointer-events-auto"
                style={{ height: GROUP_TITLE_BAR_HEIGHT }}
                onMouseDown={(e) => e.stopPropagation()}
            >
                {isEditingTitle ? (
                    <input
                        ref={inputRef}
                        value={titleDraft}
                        onChange={(e) => setTitleDraft(e.target.value)}
                        onBlur={commitTitle}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') commitTitle();
                            else if (e.key === 'Escape') cancelTitle();
                        }}
                        className="bg-transparent border-b border-stroke-subtle text-content-primary text-sm px-1 py-0.5 outline-none focus:border-accent-primary nopan nodrag"
                    />
                ) : (
                    <button
                        type="button"
                        onClick={(e) => {
                            // Only enter rename mode on a second click — this stops
                            // the very first click from immediately stealing focus
                            // before the user even sees that the group is selected.
                            if (selected) {
                                e.stopPropagation();
                                setIsEditingTitle(true);
                            }
                        }}
                        className="text-content-primary text-sm font-medium px-1 py-0.5 rounded hover:bg-white/5 cursor-text"
                    >
                        {data.label || 'Group'}
                    </button>
                )}
            </div>

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
    );
}
