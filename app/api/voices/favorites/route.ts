import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';

/**
 * Per-user voice favorites.
 *
 * GET    /api/voices/favorites           → { external_ids: string[] }  (the caller's favorite voice ids)
 * POST   /api/voices/favorites { external_voice_id }  → favorite a voice
 * DELETE /api/voices/favorites?external_id=... | { external_voice_id }  → unfavorite
 *
 * RLS on voice_favorites scopes every row to auth.uid(); the session client is used
 * (never the service client), so a user can only ever touch their own favorites.
 */
export async function GET() {
  try {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;

    const { data, error } = await auth.supabase
      .from('voice_favorites')
      .select('external_voice_id');
    if (error) throw error;

    return NextResponse.json({ external_ids: (data || []).map((r: any) => r.external_voice_id) });
  } catch (err: any) {
    console.error('[Voices Favorites API] GET error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;

    const body = await req.json().catch(() => ({}));
    const externalId = body.external_voice_id;
    if (!externalId) return NextResponse.json({ error: 'external_voice_id required' }, { status: 400 });

    // Resolve the FK so embedded reads (favorites tab) work.
    const { data: voice, error: vErr } = await auth.supabase
      .from('voices')
      .select('id')
      .eq('external_voice_id', externalId)
      .maybeSingle();
    if (vErr) throw vErr;
    if (!voice) return NextResponse.json({ error: 'voice not found' }, { status: 404 });

    const { error } = await auth.supabase
      .from('voice_favorites')
      .upsert(
        { user_id: auth.user.id, voice_id: voice.id, external_voice_id: externalId },
        { onConflict: 'user_id,voice_id' }
      );
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[Voices Favorites API] POST error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;

    const { searchParams } = new URL(req.url);
    let externalId = searchParams.get('external_id');
    if (!externalId) {
      const body = await req.json().catch(() => ({}));
      externalId = body.external_voice_id;
    }
    if (!externalId) return NextResponse.json({ error: 'external_voice_id required' }, { status: 400 });

    const { error } = await auth.supabase
      .from('voice_favorites')
      .delete()
      .eq('user_id', auth.user.id)
      .eq('external_voice_id', externalId);
    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[Voices Favorites API] DELETE error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
