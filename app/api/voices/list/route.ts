import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';

const VOICE_COLUMNS =
  'id, external_voice_id, name, description, gender, age, accent, language, language_codes, use_case, category, preview_url, popularity, featured, labels';

/**
 * GET /api/voices/list
 * Query params:
 *   q          - free text (matched against name, ilike)
 *   provider   - provider_id (default: 'elevenlabs')
 *   gender, age, language, category, use_case - exact-match filters
 *   sort       - 'popular' (featured desc, popularity desc) | 'name' (default)
 *   favorites  - '1' to return ONLY the caller's favorited voices (ignores paging
 *                and other filters; favorites lists are small)
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
    const age = searchParams.get('age');
    const language = searchParams.get('language');
    const category = searchParams.get('category');
    const useCase = searchParams.get('use_case');
    const sort = searchParams.get('sort');
    const favorites = searchParams.get('favorites') === '1';
    const page = Math.max(0, parseInt(searchParams.get('page') || '0', 10) || 0);
    const pageSize = Math.min(120, Math.max(1, parseInt(searchParams.get('page_size') || '60', 10) || 60));

    // Favorites tab: read the caller's favorites with the voice rows embedded via
    // the voice_favorites.voice_id → voices.id FK. RLS scopes rows to this user.
    if (favorites) {
      const { data, error } = await auth.supabase
        .from('voice_favorites')
        .select(`created_at, voices(${VOICE_COLUMNS})`)
        .order('created_at', { ascending: false });
      if (error) throw error;
      const voices = (data || []).map((r: any) => r.voices).filter(Boolean);
      return NextResponse.json({ voices, hasMore: false });
    }

    let query = auth.supabase
      .from('voices')
      .select(VOICE_COLUMNS)
      .eq('is_active', true)
      .eq('provider_id', provider);

    if (externalId) {
      query = query.eq('external_voice_id', externalId);
    } else {
      if (q) query = query.ilike('name', `%${q}%`);
      if (gender) query = query.eq('gender', gender);
      if (age) query = query.eq('age', age);
      // language filters against the per-voice supported-languages array.
      if (language) query = query.contains('language_codes', [language.toLowerCase()]);
      if (category) query = query.eq('category', category);
      if (useCase) query = query.eq('use_case', useCase);
    }

    if (sort === 'popular') {
      query = query
        .order('featured', { ascending: false })
        .order('popularity', { ascending: false })
        .order('name', { ascending: true });
    } else {
      query = query.order('name', { ascending: true });
    }

    const from = page * pageSize;
    const to = from + pageSize - 1;
    query = query.range(from, to);

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ voices: data || [], hasMore: (data?.length || 0) === pageSize });
  } catch (err: any) {
    console.error('[Voices List API] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
