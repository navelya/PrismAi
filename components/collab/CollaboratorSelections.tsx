'use client';
import React from 'react';
import { useStore, useViewport } from 'reactflow';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '@/lib/store/app-store';
import { colorFor } from '@/lib/hooks/use-workflow-collaboration';

function hslaFill(hsl: string, alpha: number) {
    // colorFor returns `hsl(H 70% 55%)` → `hsla(H 70% 55% / a)`
    return hsl.replace('hsl(', 'hsla(').replace(')', ` / ${alpha})`);
}

// Flow-space padding between the selected nodes' bounds and the selection box,
// mirroring the small inset React Flow leaves around its own multi-select box.
const BOX_PAD = 8;

/**
 * Renders a peer's ephemeral selection in their colour, transformed by the live
 * RF viewport. Two things only — both transient group-selection affordances,
 * never a border on an individual element:
 *   1. the live drag-to-select marquee rectangle, and
 *   2. a single bounding box around the peer's multi-node selection (the same
 *      box RF draws around 2+ marquee-selected nodes).
 *
 * Deliberately does NOT draw a ring around each selected node/group — a second,
 * colour-shifting border on an element was unwanted, so each element keeps only
 * its own original border. The union box (2+ nodes) is a selection-group
 * indicator, not a per-element border, so it's shown.
 *
 * Pure pointer-events:none overlay — it only READS peerSelections + RF node
 * geometry and NEVER mutates the local user's own selection.
 *
 * Mounted inside <ReactFlowProvider> (so useStore/useViewport resolve) next to
 * <CollaboratorCursors />. Renders nothing while peerSelections is empty (solo).
 *
 * Split in two so the heavy subscriptions (nodeInternals + viewport, which change
 * on every local drag/zoom) only mount when a peer actually has a selection.
 */
export function CollaboratorSelections() {
    const peers = useAppStore(useShallow((s) => s.peerSelections));
    if (Object.keys(peers).length === 0) return null;
    return <SelectionsLayer peers={peers} />;
}

function SelectionsLayer({ peers }: { peers: Record<string, { selectedIds: string[]; marquee: { x: number; y: number; w: number; h: number } | null }> }) {
    const { x, y, zoom } = useViewport();
    // Map<id, Node{ positionAbsolute?, position, width, height }> in reactflow v11.
    const nodeInternals = useStore((s) => s.nodeInternals);

    return (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 49 }}>
            {Object.entries(peers).map(([userId, sel]) => {
                const color = colorFor(userId);

                // Union bounding box of the peer's selected nodes. Only shown for a
                // multi-node selection (2+), matching when RF draws its own selection
                // box — a single node keeps just its own border (no second border).
                let box: { left: number; top: number; w: number; h: number } | null = null;
                const ids = sel.selectedIds || [];
                if (ids.length >= 2) {
                    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, n = 0;
                    for (const id of ids) {
                        const node: any = nodeInternals.get(id);
                        if (!node || !node.width || !node.height) continue;
                        const pos = node.positionAbsolute || node.position;
                        minX = Math.min(minX, pos.x);
                        minY = Math.min(minY, pos.y);
                        maxX = Math.max(maxX, pos.x + node.width);
                        maxY = Math.max(maxY, pos.y + node.height);
                        n++;
                    }
                    if (n >= 2) {
                        box = {
                            left: (minX - BOX_PAD) * zoom + x,
                            top: (minY - BOX_PAD) * zoom + y,
                            w: (maxX - minX + BOX_PAD * 2) * zoom,
                            h: (maxY - minY + BOX_PAD * 2) * zoom,
                        };
                    }
                }

                return (
                    <React.Fragment key={userId}>
                        {box && (
                            <div style={{
                                position: 'absolute',
                                left: box.left,
                                top: box.top,
                                width: box.w,
                                height: box.h,
                                border: `1.5px solid ${color}`,
                                borderRadius: 8 * zoom,
                                background: hslaFill(color, 0.06),
                                boxSizing: 'border-box',
                            }} />
                        )}
                        {sel.marquee && (
                            <div style={{
                                position: 'absolute',
                                left: sel.marquee.x * zoom + x,
                                top: sel.marquee.y * zoom + y,
                                width: sel.marquee.w * zoom,
                                height: sel.marquee.h * zoom,
                                border: `1px solid ${color}`,
                                background: hslaFill(color, 0.12),
                            }} />
                        )}
                    </React.Fragment>
                );
            })}
        </div>
    );
}
