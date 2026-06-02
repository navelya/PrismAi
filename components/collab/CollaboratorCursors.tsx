'use client';
import React, { useImperativeHandle, useRef, forwardRef } from 'react';
import { useReactFlow } from 'reactflow';

export interface CursorsHandle {
    update: (userId: string, name: string, color: string, fx: number, fy: number) => void;
    remove: (userId: string) => void;
}

// Minimal HTML escape — `name` and `color` are interpolated into innerHTML.
function esc(s: string): string {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Renders remote cursors. Positions are pushed imperatively (via ref) to avoid
// React re-renders on every cursor broadcast. flow-coords → screen via the RF viewport.
export const CollaboratorCursors = forwardRef<CursorsHandle, {}>(function CollaboratorCursors(_props, ref) {
    const layerRef = useRef<HTMLDivElement>(null);
    const elsRef = useRef<Map<string, HTMLDivElement>>(new Map());
    const rf = useReactFlow();

    useImperativeHandle(ref, () => ({
        update(userId, name, color, fx, fy) {
            const { x, y, zoom } = rf.getViewport();
            const sx = fx * zoom + x, sy = fy * zoom + y;
            let el = elsRef.current.get(userId);
            if (!el && layerRef.current) {
                const c = esc(color);
                el = document.createElement('div');
                el.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;transition:transform 60ms linear;z-index:50';
                el.innerHTML = `<div style="width:10px;height:10px;border-radius:50%;background:${c}"></div>
                    <div style="background:${c};color:#fff;font-size:10px;border-radius:4px;padding:1px 5px;margin-top:2px;white-space:nowrap">${esc(name)}</div>`;
                layerRef.current.appendChild(el);
                elsRef.current.set(userId, el);
            }
            if (el) el.style.transform = `translate(${sx}px, ${sy}px)`;
        },
        remove(userId) {
            const el = elsRef.current.get(userId);
            if (el) { el.remove(); elsRef.current.delete(userId); }
        },
    }), [rf]);

    return <div ref={layerRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />;
});
