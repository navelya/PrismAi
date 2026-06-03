import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';
import { listVersions } from '@/lib/db/versions';

export const runtime = 'nodejs';

/** GET /api/versions?canvasId=… — list versions (metadata only), newest first. */
export async function GET(request: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (auth.error) return auth.error;
  const { supabase } = auth;

  const canvasId = request.nextUrl.searchParams.get('canvasId');
  if (!canvasId) {
    return NextResponse.json({ error: 'Missing canvasId' }, { status: 400 });
  }

  try {
    const versions = await listVersions(supabase, canvasId);
    return NextResponse.json({ versions });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
