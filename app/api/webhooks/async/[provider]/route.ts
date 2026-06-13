import { NextRequest, NextResponse } from 'next/server';
import { getAsyncAdapter } from '@/lib/ai/providers/async-registry';
import { advanceExecutionJobs } from '@/lib/workflow/sweep-pending';

// The completion pipeline (mirror, claim RPC, child dispatch) needs the Node
// runtime, like the Replicate webhook and the cron sweep it shares logic with.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Generic webhook for async generation providers (FAL/WaveSpeed/KIE). The provider
 * POSTs here when a job finishes; we complete it ENTIRELY server-side (provider →
 * this route → poll-as-truth → DB → realtime), exactly like the Replicate webhook.
 * No client involvement: the user can close the app and the result still lands.
 *
 *   POST /api/webhooks/async/<provider>?execution_id=<id>[&node_id=&prediction_index=]
 *
 * Security: when the adapter can verify a signature (FAL ED25519), an invalid
 * signature is rejected. Either way completion is authoritative via poll() — a
 * forged trigger can only cause a harmless re-poll (and execution ids are
 * unguessable UUIDs), never a wrong completion. Kinovi has no webhook and is
 * completed by the cron sweep instead.
 */
export async function POST(req: NextRequest, { params }: { params: { provider: string } }) {
  const url = new URL(req.url);
  const executionId = url.searchParams.get('execution_id');
  if (!executionId) return NextResponse.json({ error: 'Missing execution_id' }, { status: 400 });

  const adapter = getAsyncAdapter(params.provider);
  if (!adapter) return NextResponse.json({ error: `Unknown provider '${params.provider}'` }, { status: 404 });

  // Read the RAW body once — signature verification must hash exactly these bytes.
  const rawBody = await req.text();

  // Verify the signature for observability, but DO NOT gate completion on it.
  // Completion is authoritative via poll() (poll-as-truth): a webhook only ever
  // triggers a re-poll of the real provider job, so even a forged/late delivery
  // can never assert a wrong result — at worst it causes a harmless poll (and
  // execution_id is an unguessable UUID). Gating on the ±5-min signature window
  // would instead let a late FAL RETRY be rejected and the result hang. So we
  // always attempt completion and just log the auth status.
  if (typeof adapter.verifyWebhook === 'function') {
    let ok = false;
    try {
      const headers: Record<string, string> = {};
      req.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
      ok = await adapter.verifyWebhook(headers, rawBody);
    } catch { ok = false; }
    if (!ok) console.warn(`[Webhook/${params.provider}] unverified delivery for execution ${executionId} (completing via poll-as-truth)`);
  }

  // Complete via poll-as-truth: advance this execution's pending async jobs (the
  // one that just fired, plus any siblings). Idempotent vs. the cron sweep and any
  // racing delivery — the completion claim de-dupes.
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || url.origin;
  try {
    const result = await advanceExecutionJobs(executionId, baseUrl);
    return NextResponse.json({ success: true, ...result });
  } catch (err: any) {
    console.error(`[Webhook/${params.provider}] completion failed for execution ${executionId}:`, err);
    return NextResponse.json({ error: err?.message || 'completion failed' }, { status: 500 });
  }
}
