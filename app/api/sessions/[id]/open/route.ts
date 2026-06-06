import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';

interface RouteParams { params: { id: string }; }

// POST /api/sessions/:id/open
// :id is a CANVAS session id. Returns the calling user's chat thread for it:
//  - owner            → the canvas session itself
//  - editor collab    → their companion thread (created if missing)
//  - viewer collab    → the canvas session (read-only; client shows owner's thread)
export async function POST(_req: NextRequest, { params }: RouteParams) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;
    const canvasId = params.id;

    const { data: canvas, error: cErr } = await supabase
        .from('sessions').select('id, user_id, title, canvas_session_id')
        .eq('id', canvasId).eq('is_deleted', false).single();
    if (cErr || !canvas) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (canvas.canvas_session_id) {
        return NextResponse.json({ error: 'Not a canvas session' }, { status: 400 });
    }

    if (canvas.user_id === user.id) {
        return NextResponse.json({ threadId: canvas.id, canvasId, role: 'owner' });
    }

    const { data: collab } = await supabase
        .from('session_collaborators').select('role')
        .eq('session_id', canvasId).eq('user_id', user.id).single();
    if (!collab) return NextResponse.json({ error: 'No access' }, { status: 403 });

    if (collab.role === 'viewer') {
        return NextResponse.json({ threadId: canvasId, canvasId, role: 'viewer' });
    }

    const { data: existing } = await supabase
        .from('sessions').select('id')
        .eq('user_id', user.id).eq('canvas_session_id', canvasId)
        .eq('is_deleted', false).maybeSingle();
    if (existing) {
        return NextResponse.json({ threadId: existing.id, canvasId, role: 'editor' });
    }
    const { data: created, error: insErr } = await supabase
        .from('sessions')
        .insert({ user_id: user.id, title: canvas.title || 'Shared workflow', canvas_session_id: canvasId })
        .select('id').single();
    if (insErr) {
        // Lost a concurrent-open race → the row now exists; fetch and return it.
        if ((insErr as any).code === '23505') {
            const { data: raced } = await supabase
                .from('sessions').select('id')
                .eq('user_id', user.id).eq('canvas_session_id', canvasId)
                .eq('is_deleted', false).maybeSingle();
            if (raced) return NextResponse.json({ threadId: raced.id, canvasId, role: 'editor' });
        }
        return NextResponse.json({ error: insErr.message || 'Create failed' }, { status: 500 });
    }
    if (!created) return NextResponse.json({ error: 'Create failed' }, { status: 500 });
    // Seed the companion thread with one active chat (parity with own sessions),
    // so the message-insert trigger has a target and history works.
    try {
        const { data: chat } = await supabase
            .from('chats').insert({ session_id: created.id }).select('id').single();
        if (chat?.id) await supabase.from('sessions').update({ active_chat_id: chat.id }).eq('id', created.id);
    } catch (chatErr) {
        console.error('[sessions/open] failed to seed companion thread chat', chatErr);
    }
    return NextResponse.json({ threadId: created.id, canvasId, role: 'editor' });
}
