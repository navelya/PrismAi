// app/api/admin/templates/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';
import { uploadTemplateThumbnail } from '@/lib/templates/thumbnail.server';
import { deriveNodesUsed, collapseToActiveResults } from '@/lib/templates/snapshot';

export const dynamic = 'force-dynamic';

/** GET /api/admin/templates/[id] — full row (any status) for the edit form prefill. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { data, error } = await auth.supabase
    .from('workflow_templates').select('*').eq('id', params.id).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json({ template: data });
}

/**
 * PATCH /api/admin/templates/[id] — update metadata/status/source/thumbnail and,
 * optionally, the workflow graph itself (sent as a `workflow` JSON field by the
 * admin edit-on-canvas flow). When the workflow changes, nodes_used is re-derived.
 * Accepts FormData (so a new thumbnail File can ride along).
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { supabase } = auth;
  const form = await req.formData();

  const patch: Record<string, any> = {};
  const setStr = (k: string) => { const v = form.get(k); if (v !== null) patch[k] = (v as string) || null; };
  const setArr = (k: string) => {
    const v = form.get(k);
    if (v !== null) { try { const a = JSON.parse(v as string); if (Array.isArray(a)) patch[k] = a; } catch {} }
  };
  setStr('name'); setStr('description'); setStr('how_it_works'); setStr('category');
  setArr('tags'); setArr('use_cases');

  const status = form.get('status') as string | null;
  if (status && ['draft','published','archived'].includes(status)) {
    patch.status = status;
    patch.published_at = status === 'published' ? new Date().toISOString() : null;
  }
  const source = form.get('source') as string | null;
  if (source && ['official','community'].includes(source)) patch.source = source;

  // Optional workflow graph update (admin edit-on-canvas). Keep the active output
  // so the gallery preview stays faithful, but collapse multi-result nodes to just
  // their active result; re-derive the nodes_used chip list.
  const wfRaw = form.get('workflow');
  if (typeof wfRaw === 'string' && wfRaw) {
    try {
      const wf = JSON.parse(wfRaw);
      if (wf && Array.isArray(wf.nodes)) {
        const workflow = collapseToActiveResults({ nodes: wf.nodes, edges: Array.isArray(wf.edges) ? wf.edges : [] });
        patch.workflow = workflow;
        patch.nodes_used = deriveNodesUsed(workflow);
      }
    } catch { /* ignore malformed workflow; leave the stored graph untouched */ }
  }

  const file = form.get('thumbnail') as File | null;
  if (file && file.size > 0) patch.thumbnail_url = await uploadTemplateThumbnail(supabase, params.id, file);

  const { data, error } = await supabase
    .from('workflow_templates').update(patch).eq('id', params.id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ template: data });
}

/** DELETE /api/admin/templates/[id] — delete the row and its thumbnail folder. */
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { supabase } = auth;

  // Best-effort thumbnail cleanup (folder = templates/<id>/).
  const { data: files } = await supabase.storage.from('template-thumbnails').list(`templates/${params.id}`);
  if (files?.length) {
    await supabase.storage.from('template-thumbnails')
      .remove(files.map((f: any) => `templates/${params.id}/${f.name}`));
  }

  const { error } = await supabase.from('workflow_templates').delete().eq('id', params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
