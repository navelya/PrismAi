import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';
import { getVersion, deleteVersion } from '@/lib/db/versions';

export const runtime = 'nodejs';

interface RouteParams { params: { id: string }; }

/** GET /api/versions/:id — full canvas_state (members, via RLS). */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const auth = await getAuthenticatedUser();
  if (auth.error) return auth.error;
  const { supabase } = auth;

  const version = await getVersion(supabase, params.id);
  if (!version) {
    return NextResponse.json({ error: 'Version not found' }, { status: 404 });
  }
  return NextResponse.json({ version });
}

/** DELETE /api/versions/:id — owner only. */
export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const auth = await getAuthenticatedUser();
  if (auth.error) return auth.error;
  const { user, supabase } = auth;

  const version = await getVersion(supabase, params.id);
  if (!version) {
    return NextResponse.json({ error: 'Version not found' }, { status: 404 });
  }
  const { data: session } = await supabase
    .from('sessions')
    .select('id')
    .eq('id', version.canvas_id)
    .eq('user_id', user.id)
    .single();
  if (!session) {
    return NextResponse.json({ error: 'Only the owner can delete versions' }, { status: 403 });
  }

  try {
    await deleteVersion(supabase, params.id);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
