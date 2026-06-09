// app/api/admin/templates/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';
import { deriveNodesUsed, collapseToActiveResults } from '@/lib/templates/snapshot';
import { resolveThumbnailFromSession, uploadTemplateThumbnail, copyImageUrlToBucket } from '@/lib/templates/thumbnail.server';
import { v4 as uuidv4 } from 'uuid';

export const dynamic = 'force-dynamic';

/** GET /api/admin/templates — list ALL templates (any status/source). */
export async function GET() {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { data, error } = await auth.supabase
    .from('workflow_templates')
    .select('*')
    .order('updated_at', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ templates: data });
}

/**
 * POST /api/admin/templates — create a template from a workflow session.
 * FormData fields: session_id, name, description, how_it_works, category,
 *   tags (JSON string[]), use_cases (JSON string[]), publish ('true'|'false'),
 *   thumbnail (optional File).
 */
export async function POST(req: NextRequest) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { user, supabase } = auth;

  const form = await req.formData();
  const sessionId = form.get('session_id') as string | null;
  const name = (form.get('name') as string | null)?.trim();
  if (!sessionId || !name) {
    return NextResponse.json({ error: 'session_id and name are required' }, { status: 400 });
  }

  // Load the source session's canvas.
  const { data: session, error: sErr } = await supabase
    .from('sessions')
    .select('canvas_state')
    .eq('id', sessionId)
    .single();
  if (sErr || !session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

  // Keep each node's outputs so the template detail view can render a faithful
  // read-only preview — but collapse multi-result nodes down to ONLY their active
  // result, so the other discarded iterations never ride along into the template.
  // The clone endpoint later sanitizes outputs entirely so a cloned workflow
  // still starts clean.
  const raw = session.canvas_state || { nodes: [], edges: [] };
  const workflow = collapseToActiveResults({ nodes: raw.nodes ?? [], edges: raw.edges ?? [] });
  const nodesUsed = deriveNodesUsed(workflow);

  // Author display name from auth user_metadata (profiles has no name column).
  const meta = (user.user_metadata as Record<string, unknown>) || {};
  const createdByName =
    (meta.full_name as string | undefined) ||
    (meta.name as string | undefined) ||
    (user.email as string | undefined) ||
    'Admin';

  const parseArr = (k: string): string[] => {
    try { const v = JSON.parse((form.get(k) as string) || '[]'); return Array.isArray(v) ? v : []; }
    catch { return []; }
  };

  const publish = (form.get('publish') as string) !== 'false';
  const id = uuidv4();

  // Thumbnail: uploaded file wins; else the client-provided last-canvas-image hint;
  // else a server-side lookup of the session's last image output; else null.
  const file = form.get('thumbnail') as File | null;
  const hint = (form.get('thumbnail_url_hint') as string | null) || null;
  let thumbnailUrl: string | null = null;
  if (file && file.size > 0) thumbnailUrl = await uploadTemplateThumbnail(supabase, id, file);
  else if (hint) thumbnailUrl = await copyImageUrlToBucket(supabase, id, hint);
  if (!thumbnailUrl) thumbnailUrl = await resolveThumbnailFromSession(supabase, id, sessionId);

  const { data, error } = await supabase
    .from('workflow_templates')
    .insert({
      id,
      name,
      description: (form.get('description') as string) || null,
      how_it_works: (form.get('how_it_works') as string) || null,
      category: (form.get('category') as string) || null,
      tags: parseArr('tags'),
      use_cases: parseArr('use_cases'),
      workflow,
      nodes_used: nodesUsed,
      thumbnail_url: thumbnailUrl,
      source: 'official',
      status: publish ? 'published' : 'draft',
      created_by: user.id,
      created_by_name: createdByName,
      source_session_id: sessionId,
      published_at: publish ? new Date().toISOString() : null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ template: data }, { status: 201 });
}
