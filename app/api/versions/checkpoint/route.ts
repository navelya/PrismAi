import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';
import { createCheckpoint } from '@/lib/db/versions';

export const runtime = 'nodejs';

/** POST /api/versions/checkpoint { canvasId, label } — owner only. */
export async function POST(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (auth.error) return auth.error;
  const { user, supabase } = auth;

  const body = await request.json().catch(() => ({}));
  const canvasId = typeof body.canvasId === 'string' ? body.canvasId : '';
  const label = typeof body.label === 'string' ? body.label.slice(0, 120) : '';
  if (!canvasId) {
    return NextResponse.json({ error: 'Missing canvasId' }, { status: 400 });
  }

  // Explicit ownership check (RLS also enforces this).
  const { data: session } = await supabase
    .from('sessions')
    .select('id')
    .eq('id', canvasId)
    .eq('user_id', user.id)
    .single();
  if (!session) {
    return NextResponse.json({ error: 'Only the owner can create checkpoints' }, { status: 403 });
  }

  try {
    const version = await createCheckpoint(supabase, canvasId, label || 'Checkpoint', user.id);
    return NextResponse.json({ version });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
