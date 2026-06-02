'use client';
import { useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAppStore } from '@/lib/store/app-store';

// Deterministic per-user color so it's stable across clients.
function colorFor(userId: string): string {
    let h = 0; for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) % 360;
    return `hsl(${h} 70% 55%)`;
}

export interface CursorEvent { userId: string; x: number; y: number; }
export interface WorkflowOp {
    origin: string;
    kind: 'node:add' | 'node:delete' | 'node:move-commit' | 'node:config' | 'edge:add' | 'edge:delete';
    payload: any;
}

export function useWorkflowCollaboration(
    canvasId: string | null,
    me: { id: string; name: string; role: 'owner' | 'editor' | 'viewer' } | null,
    handlers: { onOp: (op: WorkflowOp) => void; onCursor: (c: CursorEvent) => void; onNodeDrag: (e: any) => void; },
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
        ops.on('broadcast', { event: 'op' }, ({ payload }: any) => handlersRef.current.onOp(payload));
        ops.on('broadcast', { event: 'cursor' }, ({ payload }: any) => handlersRef.current.onCursor(payload));
        ops.on('broadcast', { event: 'node-drag' }, ({ payload }: any) => handlersRef.current.onNodeDrag(payload));
        ops.subscribe();
        opsChannelRef.current = ops;

        return () => { supabase.removeChannel(presence); supabase.removeChannel(ops); opsChannelRef.current = null; };
    }, [canvasId, me?.id, me?.role]);

    const sendCursor = (x: number, y: number) => {
        if (!me) return;
        opsChannelRef.current?.send({ type: 'broadcast', event: 'cursor', payload: { userId: me.id, x, y } });
    };
    const sendNodeDrag = (nodeId: string, x: number, y: number) => {
        if (!me) return;
        opsChannelRef.current?.send({ type: 'broadcast', event: 'node-drag', payload: { userId: me.id, nodeId, x, y } });
    };
    const sendOp = (op: Omit<WorkflowOp, 'origin'>) => {
        if (!me) return;
        opsChannelRef.current?.send({ type: 'broadcast', event: 'op', payload: { ...op, origin: me.id } });
    };
    return { sendCursor, sendNodeDrag, sendOp };
}
