'use client';
import React, { useImperativeHandle, useRef, forwardRef } from 'react';
import { useReactFlow } from 'reactflow';

export interface CursorsHandle {
    update: (userId: string, name: string, color: string, fx: number, fy: number) => void;
    remove: (userId: string) => void;
}

interface CursorEls {
    root: HTMLDivElement;
    path: SVGPathElement;
    label: HTMLDivElement;
    name: string;
    color: string;
}

// Figma-style pointer arrow. The tip sits at (0,0) of the SVG so the element's
// translate(sx, sy) places the tip exactly at the collaborator's cursor point.
const CURSOR_PATH = 'M0 0 L0 16 L4.41 12.79 L6.98 18.97 L9.4 17.98 L6.83 11.8 L12 11.8 Z';
const SVG_NS = 'http://www.w3.org/2000/svg';

// Renders remote cursors. Positions are pushed imperatively (via ref) to avoid
// React re-renders on every cursor broadcast. flow-coords → screen via the RF viewport.
export const CollaboratorCursors = forwardRef<CursorsHandle, {}>(function CollaboratorCursors(_props, ref) {
    const layerRef = useRef<HTMLDivElement>(null);
    const elsRef = useRef<Map<string, CursorEls>>(new Map());
    const rf = useReactFlow();

    useImperativeHandle(ref, () => ({
        update(userId, name, color, fx, fy) {
            const { x, y, zoom } = rf.getViewport();
            const sx = fx * zoom + x, sy = fy * zoom + y;
            let entry = elsRef.current.get(userId);
            if (!entry && layerRef.current) {
                const root = document.createElement('div');
                root.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;transition:transform 80ms linear;z-index:50;will-change:transform';

                const svg = document.createElementNS(SVG_NS, 'svg');
                svg.setAttribute('width', '16');
                svg.setAttribute('height', '23');
                svg.setAttribute('viewBox', '0 0 14 20');
                svg.style.cssText = 'display:block;filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.35))';
                const path = document.createElementNS(SVG_NS, 'path');
                path.setAttribute('d', CURSOR_PATH);
                path.setAttribute('stroke', 'white');
                path.setAttribute('stroke-width', '1.4');
                path.setAttribute('stroke-linejoin', 'round');
                svg.appendChild(path);

                const label = document.createElement('div');
                label.style.cssText = 'position:absolute;left:13px;top:15px;color:#fff;font-size:11px;font-weight:600;line-height:1;border-radius:8px;padding:3px 7px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.25);font-family:system-ui,-apple-system,sans-serif';

                root.appendChild(svg);
                root.appendChild(label);
                layerRef.current.appendChild(root);
                entry = { root, path, label, name: '', color: '' };
                elsRef.current.set(userId, entry);
            }
            if (!entry) return;
            // Update text/colors only when they change (cheap, and lets the name
            // correct itself once the presence roster resolves after the first move).
            if (entry.name !== name) { entry.label.textContent = name; entry.name = name; }
            if (entry.color !== color) {
                entry.path.setAttribute('fill', color);
                entry.label.style.background = color;
                entry.color = color;
            }
            entry.root.style.transform = `translate(${sx}px, ${sy}px)`;
        },
        remove(userId) {
            const entry = elsRef.current.get(userId);
            if (entry) { entry.root.remove(); elsRef.current.delete(userId); }
        },
    }), [rf]);

    return <div ref={layerRef} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />;
});
