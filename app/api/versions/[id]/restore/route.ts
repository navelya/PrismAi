import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';
import { getVersion, restoreVersion } from '@/lib/db/versions';

export const runtime = 'nodejs';

interface RouteParams { params: { id: string }; }

/** POST /api/versions/:id/restore — safety-snapshot + overwrite. Owner only. */
export async function POST(_request: NextRequest, { params }: RouteParams) {
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
    return NextResponse.json({ error: 'Only the owner can restore' }, { status: 403 });
  }

  try {
    const { canvasId, canvasState } = await restoreVersion(supabase, params.id, user.id);
    return NextResponse.json({ canvasId, canvasState });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
