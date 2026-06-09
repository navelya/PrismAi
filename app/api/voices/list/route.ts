import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';

/**
 * GET /api/voices/list
 * Query params:
 *   q          - free text (matched against name, ilike)
 *   provider   - provider_id (default: 'elevenlabs')
 *   gender, language, category, use_case - exact-match filters
 *   external_id - return a single voice by its external_voice_id (for resolving
 *                 a selected voice's display name)
 *   page (0-based), page_size (default 60, max 120)
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;

    const { searchParams } = new URL(req.url);
    const q = searchParams.get('q')?.trim();
    const provider = searchParams.get('provider') || 'elevenlabs';
    const externalId = searchParams.get('external_id');
    const gender = searchParams.get('gender');
    const language = searchParams.get('language');
    const category = searchParams.get('category');
    const useCase = searchParams.get('use_case');
    const page = Math.max(0, parseInt(searchParams.get('page') || '0', 10) || 0);
    const pageSize = Math.min(120, Math.max(1, parseInt(searchParams.get('page_size') || '60', 10) || 60));

    let query = auth.supabase
      .from('voices')
      .select('id, external_voice_id, name, description, gender, age, accent, language, use_case, category, preview_url, labels')
      .eq('is_active', true)
      .eq('provider_id', provider);

    if (externalId) {
      query = query.eq('external_voice_id', externalId);
    } else {
      if (q) query = query.ilike('name', `%${q}%`);
      if (gender) query = query.eq('gender', gender);
      if (language) query = query.eq('language', language);
      if (category) query = query.eq('category', category);
      if (useCase) query = query.eq('use_case', useCase);
    }

    const from = page * pageSize;
    const to = from + pageSize - 1;
    query = query.order('name', { ascending: true }).range(from, to);

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ voices: data || [], hasMore: (data?.length || 0) === pageSize });
  } catch (err: any) {
    console.error('[Voices List API] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
