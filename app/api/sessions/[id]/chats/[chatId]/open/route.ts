import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';

interface RouteParams {
    params: { id: string; chatId: string };
}

/**
 * POST /api/sessions/:id/chats/:chatId/open — make :chatId the session's active
 * chat. The client then re-runs loadSession to hydrate that chat's messages.
 * The canvas is untouched (chats share the session's one canvas).
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;

    // Verify the chat belongs to this session (RLS already restricts to the
    // user's own sessions).
    const { data: chat, error: chatError } = await supabase
        .from('chats')
        .select('id')
        .eq('id', params.chatId)
        .eq('session_id', params.id)
        .single();

    if (chatError || !chat) {
        return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
    }

    const { data: session, error } = await supabase
        .from('sessions')
        .update({ active_chat_id: params.chatId })
        .eq('id', params.id)
        .eq('user_id', user.id)
        .select('id')
        .single();

    if (error || !session) {
        return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
}
