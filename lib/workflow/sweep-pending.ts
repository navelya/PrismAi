import { createServiceClient } from '@/lib/supabase/service';
import { getAsyncAdapter } from '@/lib/ai/providers/async-registry';
import { completeJob } from '@/lib/workflow/complete-job';
import { resolveNodeOutputWireTypeFromGraph } from '@/lib/workflow/output-type';
import { toResultDataForType, isMediaResultType, NodeResultType } from '@/lib/workflow/result-format';
import { mirrorMediaToStorage } from '@/lib/workflow/media-mirror';
import { refundFailedIteration } from '@/lib/workflow/refund';
import { checkAndDispatchChildren } from '@/lib/workflow/orchestrator';
import { clampIterations } from '@/lib/billing/cost';

// Only poll a job that's been idle for at least this long — webhooks resolve most
// jobs first; the sweep is the backstop for the ones that didn't get a callback.
const STALE_MS = 90_000;
// A job that never reaches a terminal status is failed + refunded past this age,
// so a submitted-but-dropped job can't be swept forever or strand the execution.
// Set generously ABOVE the slowest model's worst-case wall-clock: Replicate
// predictions self-terminate (poll() catches their failed/canceled), so this is
// only a backstop for a vanished/dropped job — not a timeout for slow generation.
// Too low would force-fail a still-processing long video and refund it, then a
// later success webhook would lose the claim and the real result would be lost.
const DEADLINE_MS = 60 * 60_000;
// Bound per-tick work so one invocation never exceeds the function timeout.
const MAX_PER_SWEEP = 50;

function isStale(lastPolledAt: string | null, fallbackAt: string | null): boolean {
  const ref = lastPolledAt || fallbackAt;
  if (!ref) return true;
  return Date.now() - new Date(ref).getTime() >= STALE_MS;
}
function pastDeadline(updatedAt: string | null): boolean {
  if (!updatedAt) return false;
  return Date.now() - new Date(updatedAt).getTime() >= DEADLINE_MS;
}

export interface SweepReport {
  scanned: number;
  completed: number;
  failed: number;
  stillPending: number;
  deadlined: number;
  errors: number;
}

/**
 * Poll stale, non-terminal provider jobs and drive them to completion through the
 * same pipeline the webhook uses. Self-healing backstop for missed webhooks.
 * Idempotent: completeJob / finalize_fan_out claim the transition, so racing a
 * late webhook is safe.
 */
export async function sweepPendingJobs(baseUrl: string): Promise<SweepReport> {
  const supabase = createServiceClient();
  const report: SweepReport = { scanned: 0, completed: 0, failed: 0, stillPending: 0, deadlined: 0, errors: 0 };

  // ── Single-node jobs ───────────────────────────────────────────────────────
  const { data: singles } = await supabase
    .from('node_results')
    .select('execution_id, node_id, provider_id, provider_job_id, status, updated_at, last_polled_at')
    .in('status', ['pending', 'running'])
    .not('provider_job_id', 'is', null)
    .order('last_polled_at', { ascending: true, nullsFirst: true })
    .limit(MAX_PER_SWEEP);

  for (const row of singles || []) {
    report.scanned++;
    if (!isStale(row.last_polled_at, row.updated_at)) { report.stillPending++; continue; }
    if (!row.provider_id) { report.errors++; continue; }
    try {
      const adapter = getAsyncAdapter(row.provider_id);
      if (!adapter) { report.errors++; continue; }
      const poll = await adapter.poll(row.provider_job_id as string);
      await supabase.from('node_results')
        .update({ last_polled_at: new Date().toISOString() })
        .eq('execution_id', row.execution_id).eq('node_id', row.node_id);

      if (poll.status === 'completed') {
        await completeJob({
          executionId: row.execution_id, nodeId: row.node_id,
          providerId: row.provider_id as string, providerJobId: row.provider_job_id as string,
          outcome: { status: 'completed', outputs: poll.outputs }, baseUrl,
        });
        report.completed++;
      } else if (poll.status === 'failed') {
        await completeJob({
          executionId: row.execution_id, nodeId: row.node_id,
          providerId: row.provider_id as string, providerJobId: row.provider_job_id as string,
          outcome: { status: 'failed', error: poll.error || 'Generation failed' }, baseUrl,
        });
        report.failed++;
      } else if (pastDeadline(row.updated_at)) {
        await completeJob({
          executionId: row.execution_id, nodeId: row.node_id,
          providerId: row.provider_id as string, providerJobId: row.provider_job_id as string,
          outcome: { status: 'failed', error: 'Generation timed out (no result from provider)' }, baseUrl,
        });
        report.deadlined++;
      } else {
        report.stillPending++;
      }
    } catch (err) {
      report.errors++;
      console.error(`[Sweep] single ${row.execution_id}/${row.node_id} poll failed:`, err);
    }
  }

  // ── Fan-out predictions ─────────────────────────────────────────────────────
  const { data: preds } = await supabase
    .from('node_predictions')
    .select('execution_id, node_id, prediction_index, provider_id, provider_job_id, status, updated_at, last_polled_at')
    .eq('status', 'pending')
    .not('provider_job_id', 'is', null)
    .order('last_polled_at', { ascending: true, nullsFirst: true })
    .limit(MAX_PER_SWEEP);

  for (const row of preds || []) {
    report.scanned++;
    if (!isStale(row.last_polled_at, row.updated_at)) { report.stillPending++; continue; }
    if (!row.provider_id) { report.errors++; continue; }
    try {
      const adapter = getAsyncAdapter(row.provider_id);
      if (!adapter) { report.errors++; continue; }
      const poll = await adapter.poll(row.provider_job_id as string);
      await supabase.from('node_predictions')
        .update({ last_polled_at: new Date().toISOString() })
        .eq('execution_id', row.execution_id).eq('node_id', row.node_id)
        .eq('prediction_index', row.prediction_index);

      if (poll.status === 'pending' && !pastDeadline(row.updated_at)) { report.stillPending++; continue; }

      const { data: execCtx } = await supabase
        .from('executions').select('graph_json, session_id, sessions(user_id)').eq('id', row.execution_id).single();
      const outputType: NodeResultType = await resolveNodeOutputWireTypeFromGraph(
        supabase, execCtx?.graph_json, row.node_id
      );
      const graphNode = ((execCtx?.graph_json as any)?.nodes ?? [])
        .find((n: any) => n?.id === row.node_id);
      const expectedCount = clampIterations(graphNode?.data?.config?.iterations ?? graphNode?.config?.iterations);

      if (poll.status === 'completed') {
        let resultData = toResultDataForType(outputType, poll.outputs);
        if (isMediaResultType(outputType)) {
          resultData = await mirrorMediaToStorage(
            supabase,
            resultData.filter((i): i is string => typeof i === 'string'),
            outputType,
            (execCtx?.sessions as any)?.user_id || 'unknown_user',
            (execCtx as any)?.session_id || 'unknown_session',
            row.node_id
          );
        }
        await supabase.from('node_predictions').update({
          status: 'completed', result_data: resultData, error: null, updated_at: new Date().toISOString(),
        }).eq('execution_id', row.execution_id).eq('node_id', row.node_id).eq('prediction_index', row.prediction_index);
        report.completed++;
      } else {
        await supabase.from('node_predictions').update({
          status: 'failed',
          error: poll.error || (poll.status === 'pending' ? 'Iteration timed out' : 'Iteration failed'),
          updated_at: new Date().toISOString(),
        }).eq('execution_id', row.execution_id).eq('node_id', row.node_id).eq('prediction_index', row.prediction_index);
        await refundFailedIteration(supabase, row.execution_id, row.node_id, row.prediction_index);
        report.failed++;
      }

      const { data: claimed } = await supabase.rpc('finalize_fan_out', {
        p_execution_id: row.execution_id, p_node_id: row.node_id,
        p_output_type: outputType, p_expected_count: expectedCount,
      });
      if (claimed === true) {
        await checkAndDispatchChildren(row.execution_id, row.node_id, baseUrl);
      } else {
        console.log(`[Sweep] fanout ${row.execution_id}/${row.node_id} finalize did not claim (not all iterations resolved or parent not running)`);
      }
    } catch (err) {
      report.errors++;
      console.error(`[Sweep] fanout ${row.execution_id}/${row.node_id}#${row.prediction_index} poll failed:`, err);
    }
  }

  return report;
}
