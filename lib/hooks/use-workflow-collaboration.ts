'use client';
import { useCallback, useEffect, useRef } from 'react';
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

// In-flight group resize. Carries the live width/height plus the anchored-edge
// CSS shift (sx/sy) so the peer can mirror the exact geometry — including W/N
// resizes that pin the far edge. The committed size arrives later via `state`.
export interface GroupResizeEvent {
    userId: string;
    nodeId: string;
    w: number;
    h: number;
    sx: number;
    sy: number;
}

export function useWorkflowCollaboration(
    canvasId: string | null,
    me: { id: string; name: string; role: 'owner' | 'editor' | 'viewer' } | null,
    handlers: {
        onState: (e: WorkflowStateEvent) => void;
        onCursor: (c: CursorEvent) => void;
        onNodeDrag: (e: NodeDragEvent) => void;
        onSelection?: (e: SelectionEvent) => void;
        onGroupResize?: (e: GroupResizeEvent) => void;
        // Bug 2 fix: called when a new peer joins presence so the local user
        // can re-emit their current cursor position once (a single extra
        // broadcast; joins are rare so steady-state cost is ~zero).
        onPeerJoined?: () => void;
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
        // Bug 2 fix: when ANY peer joins the channel, fire onPeerJoined so the
        // local user re-broadcasts their last cursor position once. The 'join'
        // event fires for the remote peer's entry — not for ourselves — so this
        // doesn't trigger a self-loop. We use handlersRef so the callback always
        // sees the latest closure without needing to re-subscribe the channel.
        presence.on('presence', { event: 'join' }, () => {
            handlersRef.current.onPeerJoined?.();
        });
        presence.subscribe((status: string) => {
            if (status === 'SUBSCRIBED') {
                presence.track({ userId: me.id, name: me.name, role: me.role });
            }
        });

        const ops = supabase.channel(`workflow-ops-${canvasId}`, { config: { broadcast: { self: false } } });
        // Defense-in-depth: never act on our OWN broadcasts. `self: false` only
        // suppresses echoes within THIS connection. A SECOND connection of the
        // same user — a duplicate browser tab, or the brief overlap while this
        // channel re-subscribes after a canvas/role change — is a different
        // connection, so its messages are NOT "self" here and would otherwise
        // render a ghost of ourselves (e.g. our own cursor on a solo canvas, or
        // our own selection/drag mirrored back). Drop anything originating from us.
        const isSelf = (p: any) => p?.userId === me.id || p?.origin === me.id;
        ops.on('broadcast', { event: 'state' }, ({ payload }: any) => { if (isSelf(payload)) return; handlersRef.current.onState(payload); });
        ops.on('broadcast', { event: 'cursor' }, ({ payload }: any) => { if (isSelf(payload)) return; handlersRef.current.onCursor(payload); });
        ops.on('broadcast', { event: 'node-drag' }, ({ payload }: any) => { if (isSelf(payload)) return; handlersRef.current.onNodeDrag(payload); });
        ops.on('broadcast', { event: 'selection' }, ({ payload }: any) => { if (isSelf(payload)) return; handlersRef.current.onSelection?.(payload); });
        ops.on('broadcast', { event: 'group-resize' }, ({ payload }: any) => { if (isSelf(payload)) return; handlersRef.current.onGroupResize?.(payload); });
        ops.subscribe();
        opsChannelRef.current = ops;

        return () => { supabase.removeChannel(presence); supabase.removeChannel(ops); opsChannelRef.current = null; };
    }, [canvasId, me?.id, me?.role]);

    const sendCursor = useCallback((x: number, y: number) => {
        if (!me) return;
        opsChannelRef.current?.send({ type: 'broadcast', event: 'cursor', payload: { userId: me.id, x, y } });
    }, [me?.id]);
    // Legacy single-node drag send (kept for callers/back-compat).
    const sendNodeDrag = useCallback((nodeId: string, x: number, y: number) => {
        if (!me) return;
        opsChannelRef.current?.send({ type: 'broadcast', event: 'node-drag', payload: { userId: me.id, nodeId, x, y } });
    }, [me?.id]);
    // Multi-node drag send — broadcast all dragged nodes' live positions.
    const sendNodeDrags = useCallback((items: NodeDragItem[]) => {
        if (!me) return;
        opsChannelRef.current?.send({ type: 'broadcast', event: 'node-drag', payload: { userId: me.id, items } });
    }, [me?.id]);
    // Full structural state broadcast — the instant peer sync layer (the 2s DB
    // autosave still handles durability). Sent only on a SETTLED local edit.
    const sendState = useCallback((nodes: any[], edges: any[]) => {
        if (!me) return;
        opsChannelRef.current?.send({ type: 'broadcast', event: 'state', payload: { origin: me.id, nodes, edges } });
    }, [me?.id]);
    // In-flight group-resize broadcast — peers mirror the live geometry.
    const sendGroupResize = useCallback((nodeId: string, w: number, h: number, sx: number, sy: number) => {
        if (!me) return;
        opsChannelRef.current?.send({ type: 'broadcast', event: 'group-resize', payload: { userId: me.id, nodeId, w, h, sx, sy } });
    }, [me?.id]);
    // Ephemeral peer-selection broadcast (selected node ids + live marquee box).
    // No-ops while solo (me === null), so a non-collaborative session never sends.
    const sendSelection = useCallback((
        selectedIds: string[],
        marquee: { x: number; y: number; w: number; h: number } | null,
    ) => {
        if (!me) return;
        opsChannelRef.current?.send({ type: 'broadcast', event: 'selection', payload: { userId: me.id, selectedIds, marquee } });
    }, [me?.id]);
    return { sendCursor, sendNodeDrag, sendNodeDrags, sendState, sendSelection, sendGroupResize };
}
