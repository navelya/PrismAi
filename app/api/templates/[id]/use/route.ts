// app/api/templates/[id]/use/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';
import { sanitizeTemplateWorkflow } from '@/lib/templates/snapshot';

export const dynamic = 'force-dynamic';

/** POST /api/templates/[id]/use — clone a published template into a NEW session owned by the caller. */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getAuthenticatedUser();
  if (auth.error) return auth.error;
  const { user, supabase } = auth;

  // RLS guarantees we only read published templates.
  const { data: tpl, error: tErr } = await supabase
    .from('workflow_templates')
    .select('name, workflow, status')
    .eq('id', params.id)
    .single();
  if (tErr || !tpl) return NextResponse.json({ error: 'Template not found' }, { status: 404 });

  const canvas = sanitizeTemplateWorkflow(tpl.workflow || { nodes: [], edges: [] });

  const { data: session, error: sErr } = await supabase
    .from('sessions')
    .insert({ user_id: user.id, title: tpl.name, canvas_state: canvas })
    .select('id')
    .single();
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });

  // Best-effort usage bump (RPC is SECURITY DEFINER; failure must not block the clone).
  await supabase.rpc('increment_template_usage', { p_template_id: params.id });

  return NextResponse.json({ session_id: session.id }, { status: 201 });
}
