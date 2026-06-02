import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sessions — List owned (non-companion) + shared canvases for the authenticated user.
 */
export async function GET() {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;

    // Owned canvases (exclude companion threads: canvas_session_id IS NOT NULL).
    const ownedQ = supabase
        .from('sessions')
        .select('id, title, updated_at, user_id')
        .eq('user_id', user.id)
        .is('canvas_session_id', null)
        .eq('is_deleted', false);

    // Canvases shared with me.
    const sharedQ = supabase
        .from('session_collaborators')
        .select('role, sessions:session_id ( id, title, updated_at, user_id, is_deleted )')
        .eq('user_id', user.id);

    const [{ data: owned, error: e1 }, { data: shared, error: e2 }] = await Promise.all([ownedQ, sharedQ]);
    if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
    if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });

    const ownedRows = (owned || []).map((s: any) => ({ ...s, shared: false, role: 'owner' }));
    const sharedRows = (shared || [])
        .flatMap((r: any) => {
            // Supabase may return the nested row as an object or a single-element array
            // depending on relationship inference; handle both shapes.
            const s = Array.isArray(r.sessions) ? r.sessions[0] : r.sessions;
            if (!s || s.is_deleted) return [];
            return [{
                id: s.id, title: s.title, updated_at: s.updated_at,
                shared: true, role: r.role,
            }];
        });

    const all = [...ownedRows, ...sharedRows]
        .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
    return NextResponse.json({ sessions: all });
}

/**
 * POST /api/sessions — Create a new session
 */
export async function POST(request: NextRequest) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;

    let title = '';
    let id: string | undefined;
    try {
        const body = await request.json();
        if (body.title) title = body.title;
        if (body.id) id = body.id;
    } catch {
        // No body is fine, use defaults
    }

    const { data, error } = await supabase
        .from('sessions')
        .insert({
            ...(id ? { id } : {}),
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
