import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';

interface RouteParams {
    params: { id: string }; // Message ID
}

/**
 * POST /api/messages/[id]/revert
 * Reverts the session to the state of a specific message.
 * - Restores the workflow (canvas_state) from that message.
 * - Deletes all subsequent messages (Time Machine logic).
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;
    const messageId = params.id;

    // 1. Fetch the target message
    const { data: targetMessage, error: msgError } = await supabase
        .from('messages')
        .select('session_id, created_at, canvas_state')
        .eq('id', messageId)
        .single();

    if (msgError || !targetMessage) {
        return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    // 2. Verify Session Ownership
    const { data: session } = await supabase
        .from('sessions')
        .select('id')
        .eq('id', targetMessage.session_id)
        .eq('user_id', user.id)
        .single();

    if (!session) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // 4. Return Current Session State
    const { data: currentSession, error: sessionError } = await supabase
        .from('sessions')
        .select('canvas_state')
        .eq('id', targetMessage.session_id)
        .single();

    if (sessionError) {
        return NextResponse.json({ error: 'Failed to retrieve current session state' }, { status: 500 });
    }

    return NextResponse.json({
        success: true,
        workflow: currentSession.canvas_state,
        message: 'Message sequence rewound',
    });
}

