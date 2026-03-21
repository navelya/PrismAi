import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';

interface RouteParams {
    params: { id: string };
}

/**
 * GET /api/sessions/:id/messages — Get all messages for a session
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;

    // Verify session ownership
    const { data: session } = await supabase
        .from('sessions')
        .select('id')
        .eq('id', params.id)
        .eq('user_id', user.id)
        .single();

    if (!session) {
        return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 });
    }

    const { data: messages, error } = await supabase
        .from('messages')
        .select('*')
        .eq('session_id', params.id)
        .order('created_at', { ascending: true });

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ messages: messages || [] });
}

/**
 * POST /api/sessions/:id/messages — Insert a new message into a session
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;

    // Verify session ownership
    const { data: session } = await supabase
        .from('sessions')
        .select('id')
        .eq('id', params.id)
        .eq('user_id', user.id)
        .single();

    if (!session) {
        return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 });
    }

    const body = await request.json();
    const { role, content, images, created_at } = body;

    if (!role || !['user', 'assistant'].includes(role)) {
        return NextResponse.json({ error: 'Invalid role' }, { status: 400 });
    }

    // Insert the message
    const { data: message, error: msgError } = await supabase
        .from('messages')
        .insert({
            session_id: params.id,
            role,
            content: content || '',
            images: images || [],
            created_at: created_at || new Date().toISOString(),
        })
        .select()
        .single();

    if (msgError) {
        return NextResponse.json({ error: msgError.message }, { status: 500 });
    }

    // Update session timestamp
    await supabase
        .from('sessions')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', params.id);

    return NextResponse.json({ message }, { status: 201 });
}

