import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';

interface RouteParams {
    params: { id: string };
}

/**
 * GET /api/sessions/:id — Load a session with its messages
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;

    const { data: session, error: sessionError } = await supabase
        .from('sessions')
        .select('*')
        .eq('id', params.id)
        .eq('user_id', user.id) // Enforce ownership
        .single();

    if (sessionError || !session) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const { data: messages, error: messagesError } = await supabase
        .from('messages')
        .select('*')
        .eq('session_id', params.id)
        .order('created_at', { ascending: true });

    if (messagesError) {
        return NextResponse.json({ error: messagesError.message }, { status: 500 });
    }

    return NextResponse.json({ session, messages: messages || [] });
}

/**
 * PATCH /api/sessions/:id — Update a session (title, canvas_state, etc.)
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;

    const body = await request.json();

    // Only allow whitelisted fields
    const allowedFields: Record<string, any> = {};
    if (body.title !== undefined) allowedFields.title = body.title;
    if (body.canvas_state !== undefined) allowedFields.canvas_state = body.canvas_state;
    allowedFields.updated_at = new Date().toISOString();

    if (Object.keys(allowedFields).length === 1) {
        // Only updated_at — nothing meaningful to update
        return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const { data, error } = await supabase
        .from('sessions')
        .update(allowedFields)
        .eq('id', params.id)
        .eq('user_id', user.id) // Enforce ownership
        .select()
        .single();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
        return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 });
    }

    return NextResponse.json({ session: data });
}

/**
 * DELETE /api/sessions/:id — Delete a session (and cascade messages)
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;

    // Verify ownership first
    const { data: session } = await supabase
        .from('sessions')
        .select('id')
        .eq('id', params.id)
        .eq('user_id', user.id)
        .single();

    if (!session) {
        return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 });
    }

    // Delete messages first (cascade), then session
    await supabase.from('messages').delete().eq('session_id', params.id);
    const { error } = await supabase.from('sessions').delete().eq('id', params.id);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
}
