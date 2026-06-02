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
 */
export function CollaboratorSelections() {
    const { x, y, zoom } = useViewport();
    // Map<id, Node{ positionAbsolute?, position, width, height }> in reactflow v11.
    const nodeInternals = useStore((s) => s.nodeInternals);
    const peers = useAppStore(useShallow((s) => s.peerSelections));

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
                            return (
                                <div key={id} style={{
                                    position: 'absolute',
                                    left: pos.x * zoom + x,
                                    top: pos.y * zoom + y,
                                    width: n.width * zoom,
                                    height: n.height * zoom,
                                    border: `2px solid ${color}`,
                                    borderRadius: 6 * zoom,
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
