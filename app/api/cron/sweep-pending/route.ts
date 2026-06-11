import { NextResponse } from 'next/server';
import { sweepPendingJobs } from '@/lib/workflow/sweep-pending';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // generous; sweep is bounded by MAX_PER_SWEEP

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  try {
    // Webhooks call back to NEXT_PUBLIC_APP_URL; use the same base for any child
    // dispatch the sweep triggers, so downstream nodes' webhooks are addressable.
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
    const report = await sweepPendingJobs(baseUrl);
    console.log('[Cron/SweepPending] done:', JSON.stringify(report));
    return NextResponse.json({ success: true, ...report });
  } catch (error: any) {
    console.error('[Cron/SweepPending] error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
