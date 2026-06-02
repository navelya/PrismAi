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

/**
 * Renders peers' ephemeral selection (drag-to-select marquee box + a colored
 * outline around each node they have selected), transformed by the live RF
 * viewport. Pure pointer-events:none overlay — it only READS peerSelections +
 * RF's node geometry and NEVER mutates the local user's own selection.
 *
 * Mounted inside <ReactFlowProvider> (so useStore/useViewport resolve) next to
 * <CollaboratorCursors />. Renders nothing while peerSelections is empty (solo).
 *
 * Split in two so the heavy subscriptions (nodeInternals + viewport, which change
 * on every local drag/zoom) only mount when a peer actually has a selection —
 * the solo/no-peer path subscribes to nothing but the small peerSelections map.
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
                return (
                    <React.Fragment key={userId}>
                        {sel.selectedIds.map((id) => {
                            const n: any = nodeInternals.get(id);
                            if (!n || !n.width || !n.height) return null;
                            const pos = n.positionAbsolute || n.position;
                            // Draw the selection ring OUTSET from the node bounds so it reads
                            // as a selection box around the node/group — never recolouring the
                            // element's own border (important for group frames).
                            const out = 4 * zoom;
                            return (
                                <div key={id} style={{
                                    position: 'absolute',
                                    left: pos.x * zoom + x - out,
                                    top: pos.y * zoom + y - out,
                                    width: n.width * zoom + out * 2,
                                    height: n.height * zoom + out * 2,
                                    border: `1.5px solid ${color}`,
                                    borderRadius: 8 * zoom + out,
                                    boxSizing: 'border-box',
                                }} />
                            );
                        })}
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
