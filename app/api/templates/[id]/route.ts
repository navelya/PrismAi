// app/api/templates/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';

export const dynamic = 'force-dynamic';

/** GET /api/templates/[id] — a single published template (full detail incl. how_it_works). */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getAuthenticatedUser();
  if (auth.error) return auth.error;
  const { supabase } = auth;

  const { data, error } = await supabase
    .from('workflow_templates')
    .select('id,name,description,how_it_works,thumbnail_url,category,tags,use_cases,nodes_used,source,created_by_name,usage_count,created_at,workflow')
    .eq('id', params.id)
    .eq('status', 'published')
    .single();

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ template: data });
}
