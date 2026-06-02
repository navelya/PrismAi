import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';

interface RouteParams { params: { id: string; collabId: string }; }

export async function PATCH(req: NextRequest, { params }: RouteParams) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { supabase } = auth;
    // Owner-only enforcement relies on session_collaborators RLS policies + the user-scoped supabase client (do NOT switch to service-role here).
    let body: any;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
    const { role } = body;
    if (!['editor', 'viewer'].includes(role)) {
        return NextResponse.json({ error: 'role must be editor|viewer' }, { status: 400 });
    }
    const { data, error } = await supabase
        .from('session_collaborators').update({ role })
        .eq('id', params.collabId).eq('session_id', params.id)
        .select('id, role').single();
    if (error || !data) return NextResponse.json({ error: error?.message || 'Not found' }, { status: 404 });
    return NextResponse.json({ collaborator: data });
}

export async function DELETE(_req: NextRequest, { params }: RouteParams) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { supabase } = auth;
    // Owner-only enforcement relies on session_collaborators RLS policies + the user-scoped supabase client (do NOT switch to service-role here).

    const { data: row } = await supabase
        .from('session_collaborators').select('user_id')
        .eq('id', params.collabId).eq('session_id', params.id).single();

    const { error } = await supabase
        .from('session_collaborators').delete()
        .eq('id', params.collabId).eq('session_id', params.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    if (row?.user_id) {
        await supabase.from('sessions').delete()
            .eq('user_id', row.user_id).eq('canvas_session_id', params.id);
    }
    return NextResponse.json({ success: true });
}
