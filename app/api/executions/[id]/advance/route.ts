import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';
import { createServiceClient } from '@/lib/supabase/service';
import { advanceExecutionJobs } from '@/lib/workflow/sweep-pending';

// The completion pipeline (mirror, claim RPC, child dispatch) needs the Node
// runtime, like the cron sweep it shares logic with.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * On-demand completion for NON-webhook async providers (FAL/WaveSpeed/KIE/Kinovi),
 * scoped to one execution. The client polls this every few seconds while a node is
 * running so results land live without depending on the background cron sweep
 * (which only some deployments schedule). Replicate is untouched — its webhook
 * still owns completion. Returns { pending } so the client knows when to stop.
 */
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const auth = await getAuthenticatedUser();
  if (auth.error) return auth.error;

  const executionId = params.id;
  if (!executionId) return NextResponse.json({ error: 'Missing execution id' }, { status: 400 });

  // Ownership: only the user who owns the execution's session may advance it.
  // (advanceExecutionJobs uses the service client, so we gate access here.)
  const svc = createServiceClient();
  const { data: exec } = await svc
    .from('executions')
    .select('id, sessions(user_id)')
    .eq('id', executionId)
    .single();
  if (!exec) return NextResponse.json({ error: 'Execution not found' }, { status: 404 });
  const ownerId = (exec.sessions as any)?.user_id;
  if (ownerId && ownerId !== auth.user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL
    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  try {
    const result = await advanceExecutionJobs(executionId, baseUrl);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'advance failed' }, { status: 500 });
  }
}
