// app/api/admin/templates/[id]/edit-session/route.ts
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/templates/[id]/edit-session
 * Find-or-create THIS admin's reusable edit session for the template, seeded from
 * the template's current workflow (outputs kept so the canvas shows visuals).
 * Reopening re-seeds from the saved template, so editing always starts from the
 * source of truth. These sessions carry template_edit_id and are hidden from the
 * normal session list. Returns { session_id }.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;
  const { user, supabase } = auth;

  const { data: tpl, error: tErr } = await supabase
    .from('workflow_templates')
    .select('name, workflow')
    .eq('id', params.id)
    .single();
  if (tErr || !tpl) return NextResponse.json({ error: 'Template not found' }, { status: 404 });

  const raw = tpl.workflow || { nodes: [], edges: [] };
  const canvas = { nodes: raw.nodes ?? [], edges: raw.edges ?? [] };
  const title = `Editing: ${tpl.name}`;

  // Reuse this admin's existing edit session for the template if present.
  const { data: existing } = await supabase
    .from('sessions')
    .select('id')
    .eq('user_id', user.id)
    .eq('template_edit_id', params.id)
    .eq('is_deleted', false)
    .maybeSingle();

  if (existing) {
    await supabase.from('sessions').update({ canvas_state: canvas, title }).eq('id', existing.id);
    return NextResponse.json({ session_id: existing.id });
  }

  const { data: session, error: sErr } = await supabase
    .from('sessions')
    .insert({ user_id: user.id, title, canvas_state: canvas, template_edit_id: params.id })
    .select('id')
    .single();
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });
  return NextResponse.json({ session_id: session.id }, { status: 201 });
}
