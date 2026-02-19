
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';

interface RouteParams {
    params: { id: string }; // Session ID
}

/**
 * POST /api/sessions/[id]/reset
 * Clears all messages in a session, effectively resetting it to a new state.
 * Keeps the session itself (ID, title, etc) but removes conversation history.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;
    const sessionId = params.id;

    // 1. Verify Session Ownership
    const { data: session } = await supabase
        .from('sessions')
        .select('id')
        .eq('id', sessionId)
        .eq('user_id', user.id)
        .single();

    if (!session) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    // 2. Delete All Messages in Session
    const { error: deleteError } = await supabase
        .from('messages')
        .delete()
        .eq('session_id', sessionId);

    if (deleteError) {
        return NextResponse.json({ error: 'Failed to clear session messages' }, { status: 500 });
    }

    // 3. Reset Session State (Workflow) to empty/initial
    const { error: updateError } = await supabase
        .from('sessions')
        .update({
            canvas_state: {}, // Empty JSON object for initial state
            updated_at: new Date().toISOString(),
        })
        .eq('id', sessionId);

    if (updateError) {
        return NextResponse.json({ error: 'Failed to reset session state' }, { status: 500 });
    }

    return NextResponse.json({
        success: true,
        message: 'Session reset complete',
    });
}
