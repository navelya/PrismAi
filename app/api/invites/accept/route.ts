import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';

export async function POST(req: NextRequest) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { supabase } = auth;
    let body: any;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
    const { token } = body;
    if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 });

    const { data, error } = await supabase.rpc('accept_workflow_invite', { p_token: token });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ canvasId: data });
}
