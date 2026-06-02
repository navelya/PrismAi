'use client';
import React from 'react';
import { useViewport } from 'reactflow';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '@/lib/store/app-store';
import { colorFor } from '@/lib/hooks/use-workflow-collaboration';

function hslaFill(hsl: string, alpha: number) {
    // colorFor returns `hsl(H 70% 55%)` → `hsla(H 70% 55% / a)`
    return hsl.replace('hsl(', 'hsla(').replace(')', ` / ${alpha})`);
}

/**
 * Renders a peer's live drag-to-select marquee rectangle, transformed by the
 * live RF viewport. Pure pointer-events:none overlay — it only READS
 * peerSelections and NEVER mutates the local user's own selection.
 *
 * Deliberately does NOT draw a ring around a peer's selected nodes/groups: a
 * second border around an element (which would shift colour by who selected it)
 * was unwanted — each element keeps only its own original border. The marquee
 * is a transient selection rectangle, not a border on any element, so it stays.
 *
 * Mounted inside <ReactFlowProvider> (so useViewport resolves) next to
 * <CollaboratorCursors />. Renders nothing while peerSelections is empty (solo).
 *
 * Split in two so the viewport subscription (changes on every local drag/zoom)
 * only mounts when a peer actually has a selection — the solo/no-peer path
 * subscribes to nothing but the small peerSelections map.
 */
export function CollaboratorSelections() {
    const peers = useAppStore(useShallow((s) => s.peerSelections));
    if (Object.keys(peers).length === 0) return null;
    return <SelectionsLayer peers={peers} />;
}

function SelectionsLayer({ peers }: { peers: Record<string, { selectedIds: string[]; marquee: { x: number; y: number; w: number; h: number } | null }> }) {
    const { x, y, zoom } = useViewport();

    return (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 49 }}>
            {Object.entries(peers).map(([userId, sel]) => {
                const color = colorFor(userId);
                return (
                    <React.Fragment key={userId}>
                        {/* No per-node selection ring: a peer selecting a node/group must
                            NOT draw a second, colour-shifting border around it — the
                            element's own border always stays its original colour. We still
                            render the peer's live drag-to-select marquee below (that's a
                            transient selection rectangle, not a border on any element). */}
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
