'use client';
import { useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAppStore } from '@/lib/store/app-store';

// Deterministic per-user color so it's stable across clients.
export function colorFor(userId: string): string {
    let h = 0; for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) % 360;
    return `hsl(${h} 70% 55%)`;
}

export interface CursorEvent { userId: string; x: number; y: number; }

// Ephemeral peer-selection broadcast: which nodes a peer has selected, plus
// their live drag-to-select marquee rectangle (flow coords) or null when no
// marquee is in flight. Rendered as a colored overlay on the receiver.
export interface SelectionEvent {
    userId: string;
    selectedIds: string[];
    marquee: { x: number; y: number; w: number; h: number } | null;
}

/**
 * Full structural state broadcast payload. Replaces the old per-op model:
 * the originator of a settled local edit broadcasts the WHOLE {nodes, edges}
 * structure, and peers MERGE it into their currentWorkflow (preserving their
 * own selection + execution state). This catches every edit kind uniformly
 * (multi-node move, group create/resize, config edits, deletes, adds) where
 * per-op broadcasting missed cases.
 */
export interface WorkflowStateEvent {
    origin: string;
    nodes: any[];
    edges: any[];
}

// A live drag broadcast. New shape carries an array of {id,x,y} items so a
// multi-node / selection drag moves all dragged nodes on the peer in one send.
// The legacy single-node shape ({ userId, nodeId, x, y }) is still accepted by
// the receiver for safety.
export interface NodeDragItem { id: string; x: number; y: number; }
export interface NodeDragEvent {
    userId: string;
    items?: NodeDragItem[];
    nodeId?: string;
    x?: number;
    y?: number;
}

export function useWorkflowCollaboration(
    canvasId: string | null,
    me: { id: string; name: string; role: 'owner' | 'editor' | 'viewer' } | null,
    handlers: {
        onState: (e: WorkflowStateEvent) => void;
        onCursor: (c: CursorEvent) => void;
        onNodeDrag: (e: NodeDragEvent) => void;
        onSelection?: (e: SelectionEvent) => void;
    },
) {
    const supabaseRef = useRef(createClient());
    const opsChannelRef = useRef<any>(null);
    const handlersRef = useRef(handlers);
    handlersRef.current = handlers;

    useEffect(() => {
        if (!canvasId || !me) return;
        const supabase = supabaseRef.current;
        const setPresence = useAppStore.getState().setPresence;

        const presence = supabase.channel(`workflow-presence-${canvasId}`, {
            config: { presence: { key: me.id } },
        });
        presence.on('presence', { event: 'sync' }, () => {
            const state = presence.presenceState() as any;
            const roster: Record<string, any> = {};
            Object.values(state).forEach((arr: any) => {
                const p = arr[0];
                if (p) roster[p.userId] = { userId: p.userId, name: p.name, color: colorFor(p.userId), role: p.role };
            });
            setPresence(roster);
        });
        presence.subscribe((status: string) => {
            if (status === 'SUBSCRIBED') {
                presence.track({ userId: me.id, name: me.name, role: me.role });
            }
        });

        const ops = supabase.channel(`workflow-ops-${canvasId}`, { config: { broadcast: { self: false } } });
        ops.on('broadcast', { event: 'state' }, ({ payload }: any) => handlersRef.current.onState(payload));
        ops.on('broadcast', { event: 'cursor' }, ({ payload }: any) => handlersRef.current.onCursor(payload));
        ops.on('broadcast', { event: 'node-drag' }, ({ payload }: any) => handlersRef.current.onNodeDrag(payload));
        ops.on('broadcast', { event: 'selection' }, ({ payload }: any) => handlersRef.current.onSelection?.(payload));
        ops.subscribe();
        opsChannelRef.current = ops;

        return () => { supabase.removeChannel(presence); supabase.removeChannel(ops); opsChannelRef.current = null; };
    }, [canvasId, me?.id, me?.role]);

    const sendCursor = (x: number, y: number) => {
        if (!me) return;
        opsChannelRef.current?.send({ type: 'broadcast', event: 'cursor', payload: { userId: me.id, x, y } });
    };
    // Legacy single-node drag send (kept for callers/back-compat).
    const sendNodeDrag = (nodeId: string, x: number, y: number) => {
        if (!me) return;
        opsChannelRef.current?.send({ type: 'broadcast', event: 'node-drag', payload: { userId: me.id, nodeId, x, y } });
    };
    // Multi-node drag send — broadcast all dragged nodes' live positions.
    const sendNodeDrags = (items: NodeDragItem[]) => {
        if (!me) return;
        opsChannelRef.current?.send({ type: 'broadcast', event: 'node-drag', payload: { userId: me.id, items } });
    };
    // Full structural state broadcast — the instant peer sync layer (the 2s DB
    // autosave still handles durability). Sent only on a SETTLED local edit.
    const sendState = (nodes: any[], edges: any[]) => {
        if (!me) return;
        opsChannelRef.current?.send({ type: 'broadcast', event: 'state', payload: { origin: me.id, nodes, edges } });
    };
    // Ephemeral peer-selection broadcast (selected node ids + live marquee box).
    // No-ops while solo (me === null), so a non-collaborative session never sends.
    const sendSelection = (
        selectedIds: string[],
        marquee: { x: number; y: number; w: number; h: number } | null,
    ) => {
        if (!me) return;
        opsChannelRef.current?.send({ type: 'broadcast', event: 'selection', payload: { userId: me.id, selectedIds, marquee } });
    };
    return { sendCursor, sendNodeDrag, sendNodeDrags, sendState, sendSelection };
}
