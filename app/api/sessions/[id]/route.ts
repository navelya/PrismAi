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
        .eq('is_deleted', false)
        .single();

    if (sessionError || !session) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Load only the ACTIVE chat's messages (a session can hold many chats; the
    // others are history, fetched on demand when switched to). Fallbacks keep
    // the route working if the chats migration hasn't run yet:
    //   - active_chat_id present → filter by chat_id
    //   - else, legacy soft-clear boundary (cleared_at), if any
    let messagesQuery = supabase
        .from('messages')
        .select('*')
        .eq('session_id', params.id);
    if ((session as any).active_chat_id) {
        messagesQuery = messagesQuery.eq('chat_id', (session as any).active_chat_id);
    } else if ((session as any).cleared_at) {
        messagesQuery = messagesQuery.gt('created_at', (session as any).cleared_at);
    }
    const { data: messages, error: messagesError } = await messagesQuery
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
    // "New chat" soft-clear boundary (null clears it; a timestamp sets it).
    if (body.cleared_at !== undefined) allowedFields.cleared_at = body.cleared_at;
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
 * POST /api/sessions/:id — Support for navigator.sendBeacon (which only sends POST)
 * Proxies to the same logic as PATCH.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
    return PATCH(request, { params });
}


/**
 * DELETE /api/sessions/:id — Delete a session and all associated assets
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;

    try {
        // 1. Authenticate & Verify Ownership
        const { data: session, error: sessionFetchError } = await supabase
            .from('sessions')
            .select('id')
            .eq('id', params.id)
            .eq('user_id', user.id)
            .single();

        if (sessionFetchError || !session) {
            return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 });
        }

        // 2. Perform Soft Delete
        const { error: dbError } = await supabase
            .from('sessions')
            .update({ is_deleted: true, deleted_at: new Date().toISOString() })
            .eq('id', params.id);

        if (dbError) {
            return NextResponse.json({ error: dbError.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, deletedFiles: 0 });

    } catch (error: any) {
        console.error('Session deletion error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
