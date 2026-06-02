import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';
import { sendWorkflowInvite } from '@/lib/email/workflow-invite';

interface RouteParams { params: { id: string }; }

export async function GET(_req: NextRequest, { params }: RouteParams) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { supabase } = auth;
    const { data, error } = await supabase
        .from('session_collaborators')
        .select('id, invited_email, role, user_id, accepted_at, created_at')
        .eq('session_id', params.id)
        .order('created_at', { ascending: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ collaborators: data || [] });
}

export async function POST(req: NextRequest, { params }: RouteParams) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;

    let body: any;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
    const { email, role } = body;
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!cleanEmail || !['editor', 'viewer'].includes(role)) {
        return NextResponse.json({ error: 'email and role (editor|viewer) required' }, { status: 400 });
    }

    const { data: canvas } = await supabase
        .from('sessions').select('id, title, user_id, canvas_session_id')
        .eq('id', params.id).single();
    if (!canvas || canvas.user_id !== user.id || canvas.canvas_session_id) {
        return NextResponse.json({ error: 'Not allowed' }, { status: 403 });
    }
    if (cleanEmail === (user.email || '').toLowerCase()) {
        return NextResponse.json({ error: 'You already own this workflow' }, { status: 400 });
    }

    const { data: existingId } = await supabase.rpc('find_user_id_by_email', { p_email: cleanEmail });

    const { data: row, error: upErr } = await supabase
        .from('session_collaborators')
        .upsert({
            session_id: params.id,
            invited_email: cleanEmail,
            role,
            invited_by: user.id,
            user_id: existingId || null,
            ...(existingId ? { accepted_at: new Date().toISOString() } : {}),
        }, { onConflict: 'session_id,invited_email' })
        .select('id, invite_token, invited_email, role, user_id')
        .single();
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 });

    let emailSent = true;
    try {
        const base = process.env.NEXT_PUBLIC_APP_URL || '';
        await sendWorkflowInvite({
            to: cleanEmail,
            workflowName: canvas.title || 'a workflow',
            inviterName: user.email || 'A PrismAi user',
            acceptUrl: `${base}/share/${row.invite_token}`,
        });
    } catch (err) {
        emailSent = false;
        console.error('[collaborators] invite email failed to send:', err instanceof Error ? err.message : err);
    }

    return NextResponse.json({ collaborator: row, emailSent }, { status: 201 });
}
