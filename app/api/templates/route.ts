// app/api/templates/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';

export const dynamic = 'force-dynamic';

/** GET /api/templates — published templates. Query: category, tag, q, source (default official). */
export async function GET(req: NextRequest) {
  const auth = await getAuthenticatedUser();
  if (auth.error) return auth.error;
  const { supabase } = auth;
  const sp = req.nextUrl.searchParams;

  let q = supabase
    .from('workflow_templates')
    .select('id,name,description,how_it_works,thumbnail_url,category,tags,use_cases,nodes_used,source,created_by_name,usage_count,created_at')
    .eq('status', 'published')
    .eq('source', sp.get('source') || 'official')
    .order('usage_count', { ascending: false })
    .order('created_at', { ascending: false });

  const category = sp.get('category');
  if (category) q = q.eq('category', category);
  const tag = sp.get('tag');
  if (tag) q = q.contains('tags', [tag]);
  const search = sp.get('q');
  if (search) q = q.ilike('name', `%${search}%`);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // "Popular" = top-10 most-cloned in the last 2 weeks (time-windowed, not the
  // all-time usage_count). Computed via SECURITY DEFINER RPC and flagged per row
  // so the cached store list can render the badge / power the Popular tab without
  // a second round-trip. Best-effort: a failure just means no popular badges.
  const { data: pop } = await supabase.rpc('popular_template_ids', { p_days: 14, p_limit: 10 });
  const popular = new Set<string>((pop ?? []).map((r: { template_id: string }) => r.template_id));
  const templates = (data ?? []).map((t) => ({ ...t, is_popular: popular.has(t.id) }));

  return NextResponse.json({ templates });
}
