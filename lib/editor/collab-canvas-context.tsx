'use client';

import React, { createContext, useContext } from 'react';

/**
 * Canvas-level collaboration API exposed to node components that handle their
 * own pointer gestures (e.g. GroupNode's resize handles) and therefore can't
 * route through ReactFlow's drag events that EditorCanvas listens on.
 *
 * Lets GroupNode broadcast its in-flight resize geometry and the live cursor
 * position so peers see the border move (and the cursor track) DURING the drag,
 * not only after release. All methods no-op while solo (no collaboration), so
 * non-collaborative sessions pay nothing.
 *
 * Provided by EditorCanvas around the <ReactFlow> subtree; consumed via
 * useCollabCanvas(). Defaults to no-ops so the node renders fine without a
 * provider (e.g. read-only previews).
 */
export interface CollabCanvasApi {
    /** Broadcast in-flight group geometry (w/h + anchored-edge CSS shift). */
    liveResize: (nodeId: string, w: number, h: number, sx: number, sy: number) => void;
    /** Broadcast the live cursor from a raw screen point (throttled + converted). */
    cursorMove: (clientX: number, clientY: number) => void;
    /**
     * Immediately broadcast the current structural state to peers, bypassing the
     * debounced auto-broadcast. Used on resize/gesture COMMIT so the settled
     * geometry replaces the peer's live ghost at once instead of after the
     * debounce (which post-commit measured-size churn keeps rescheduling).
     */
    commitNow: () => void;
}

const NOOP_API: CollabCanvasApi = {
    liveResize: () => {},
    cursorMove: () => {},
    commitNow: () => {},
};

const CollabCanvasContext = createContext<CollabCanvasApi>(NOOP_API);

export function CollabCanvasProvider({
    value,
    children,
}: {
    value: CollabCanvasApi;
    children: React.ReactNode;
}) {
    return <CollabCanvasContext.Provider value={value}>{children}</CollabCanvasContext.Provider>;
}

export function useCollabCanvas(): CollabCanvasApi {
    return useContext(CollabCanvasContext);
}
