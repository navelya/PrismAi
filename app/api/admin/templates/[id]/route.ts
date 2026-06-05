// app/api/admin/templates/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';
import { uploadTemplateThumbnail } from '@/lib/templates/thumbnail.server';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/admin/templates/[id] — update metadata/status/source/thumbnail.
 * Accepts FormData (so a new thumbnail File can ride along). Recipe (workflow) is NOT editable here.
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
