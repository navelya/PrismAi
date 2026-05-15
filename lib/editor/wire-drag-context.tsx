'use client';

import React, { createContext, useContext } from 'react';

/**
 * Snapshot of an in-flight wire drag. `null` whenever no wire is being dragged.
 *
 * Populated by EditorCanvas in onConnectStart, cleared in onConnectEnd. Consumed
 * by BaseNode (for dim + label-reveal styling) and by EditorCanvas itself (for
 * edge dimming).
 */
export type WireDragState = {
    originNodeId: string;
    originHandleId: string | null;
    /**
     * 'source' = wire originated from an OUTPUT handle (looking for an INPUT).
     * 'target' = wire originated from an INPUT handle (looking for an OUTPUT).
     */
    originHandleType: 'source' | 'target';
    /** Resolved data type of the origin handle, via getNodeHandleType. */
    dataType: string | string[];
} | null;

const WireDragContext = createContext<WireDragState>(null);

export function WireDragProvider({
    value,
    children,
}: {
    value: WireDragState;
    children: React.ReactNode;
}) {
    return <WireDragContext.Provider value={value}>{children}</WireDragContext.Provider>;
}

export function useWireDrag(): WireDragState {
    return useContext(WireDragContext);
}
