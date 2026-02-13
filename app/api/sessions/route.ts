import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';

/**
 * GET /api/sessions — List all sessions for the authenticated user
 */
export async function GET() {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;

    const { data, error } = await supabase
        .from('sessions')
        .select('id, title, updated_at')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false });

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ sessions: data });
}

/**
 * POST /api/sessions — Create a new session
 */
export async function POST(request: NextRequest) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;

    let title = 'New Workflow';
    try {
        const body = await request.json();
        if (body.title) title = body.title;
    } catch {
        // No body is fine, use defaults
    }

    const { data, error } = await supabase
        .from('sessions')
        .insert({
            user_id: user.id,
            title,
        })
        .select()
        .single();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ session: data }, { status: 201 });
}
