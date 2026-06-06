import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';

interface RouteParams {
    params: { id: string };
}

/**
 * GET /api/sessions/:id/chats — list a session's chats (history dropdown).
 * Newest activity first. Also returns which chat is currently active.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;

    const { data: session, error: sessionError } = await supabase
        .from('sessions')
        .select('id, active_chat_id')
        .eq('id', params.id)
        .eq('user_id', user.id)
        .single();

    if (sessionError || !session) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const { data: chats, error } = await supabase
        .from('chats')
        .select('id, title, created_at, updated_at')
        .eq('session_id', params.id)
        .order('updated_at', { ascending: false });

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ chats: chats || [], activeChatId: (session as any).active_chat_id ?? null });
}

/**
 * POST /api/sessions/:id/chats — start a new chat in this session and make it
 * active. The previous chat is archived (kept), not deleted. The canvas is
 * untouched.
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;

    const { data: session, error: sessionError } = await supabase
        .from('sessions')
        .select('id')
        .eq('id', params.id)
        .eq('user_id', user.id)
        .single();

    if (sessionError || !session) {
        return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 });
    }

    const { data: chat, error } = await supabase
        .from('chats')
        .insert({ session_id: params.id })
        .select('id, title, created_at, updated_at')
        .single();

    if (error || !chat) {
        return NextResponse.json({ error: error?.message || 'Failed to create chat' }, { status: 500 });
    }

    await supabase
        .from('sessions')
        .update({ active_chat_id: chat.id, updated_at: new Date().toISOString() })
        .eq('id', params.id)
        .eq('user_id', user.id);

    return NextResponse.json({ chat }, { status: 201 });
}
