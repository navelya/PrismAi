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

// Lucide `mouse-pointer-2` path (24x24 viewBox). Tip is at ~(4.04, 4.69).
const CURSOR_PATH = 'M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z';
const SVG_NS = 'http://www.w3.org/2000/svg';
// Rendered glyph size (px). The SVG is shifted up-left by the path-tip offset
// so the arrow tip lands on the cursor coordinate (Figma-style).
const CURSOR_SIZE = 16;
// Pixel offset of the path tip when the 24-unit viewBox is rendered at
// CURSOR_SIZE (4.04 * 16/24 ≈ 2.7, 4.69 * 16/24 ≈ 3.1), rounded to whole
// pixels (a fractional left/top on a drop-shadow-filtered SVG blurs the glyph;
// the ≤0.5px tip shift is invisible).
const TIP_X = 3, TIP_Y = 3;

// Renders remote cursors. Positions are pushed imperatively (via ref) to avoid
// React re-renders on every cursor broadcast. flow-coords → screen via the RF viewport.
export const CollaboratorCursors = forwardRef<CursorsHandle, {}>(function CollaboratorCursors(_props, ref) {
    const layerRef = useRef<HTMLDivElement>(null);
    const elsRef = useRef<Map<string, CursorEls>>(new Map());
    const rf = useReactFlow();

    useImperativeHandle(ref, () => ({
        update(userId, name, color, fx, fy) {
            const { x, y, zoom } = rf.getViewport();
            // Snap to whole pixels (avoids sub-pixel bilinear blur on the translate).
            const sx = Math.round(fx * zoom + x), sy = Math.round(fy * zoom + y);
            let entry = elsRef.current.get(userId);
            if (!entry && layerRef.current) {
                const root = document.createElement('div');
                // NO `will-change: transform` and NO transform-transition: either one
                // promotes this to its own GPU layer, and Chromium clamps that layer's
                // raster scale BELOW the device pixel ratio (badly so when an ancestor
                // uses backdrop-filter — which the app's glass chrome does), baking the
                // SVG glyph + label text into a low-res bitmap that looks pixelated.
                // Painting into the parent layer keeps everything at full DPR = crisp.
                root.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;z-index:50';

                const svg = document.createElementNS(SVG_NS, 'svg');
                svg.setAttribute('width', String(CURSOR_SIZE));
                svg.setAttribute('height', String(CURSOR_SIZE));
                svg.setAttribute('viewBox', '0 0 24 24');
                svg.style.cssText = `position:absolute;left:${-TIP_X}px;top:${-TIP_Y}px;display:block;filter:drop-shadow(0 1px 1px rgba(0,0,0,.3))`;
                const path = document.createElementNS(SVG_NS, 'path');
                path.setAttribute('d', CURSOR_PATH);
                path.setAttribute('stroke', 'white');
                path.setAttribute('stroke-width', '2');
                path.setAttribute('stroke-linejoin', 'round');
                path.setAttribute('stroke-linecap', 'round');
                svg.appendChild(path);

                const label = document.createElement('div');
                label.style.cssText = 'position:absolute;left:10px;top:11px;color:#fff;font-size:12px;font-weight:600;line-height:1.2;border-radius:7px;padding:3px 9px;white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.2);font-family:system-ui,-apple-system,sans-serif';

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
