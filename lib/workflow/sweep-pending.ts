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
// Age FLOOR: rows older than this are left untouched. The provider-job column
// backfill marked historic stranded rows pollable; sweeping them would mass-refund
// old executions and re-dispatch children into dead sessions. Pre-clean such rows
// manually if desired.
const MAX_AGE_MS = 48 * 3600_000;
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

type FanOutRow = {
  execution_id: string;
  node_id: string;
  prediction_index: number;
};

type Supa = ReturnType<typeof createServiceClient>;

/**
 * Guarded terminal-failure write for one fan-out iteration: only flips a row that
 * is still 'pending' (a concurrent webhook may have completed it — flipping a
 * completed iteration to failed would refund a success). Refunds ONLY if the
 * update actually affected a row. Returns whether the row was flipped.
 */
async function failIterationGuarded(supabase: Supa, row: FanOutRow, error: string): Promise<boolean> {
  const { data: affected } = await supabase.from('node_predictions').update({
    status: 'failed', error, updated_at: new Date().toISOString(),
  })
    .eq('execution_id', row.execution_id).eq('node_id', row.node_id)
    .eq('prediction_index', row.prediction_index)
    .eq('status', 'pending')
    .select('prediction_index');
  if (!affected || affected.length === 0) return false;
  await refundFailedIteration(supabase, row.execution_id, row.node_id, row.prediction_index);
  return true;
}

/** Fetch the execution context a fan-out resolution needs (output type + expected count). */
async function getFanOutExecContext(supabase: Supa, row: FanOutRow) {
  const { data: execCtx } = await supabase
    .from('executions').select('graph_json, session_id, sessions(user_id)').eq('id', row.execution_id).single();
  const outputType: NodeResultType = await resolveNodeOutputWireTypeFromGraph(
    supabase, execCtx?.graph_json, row.node_id
  );
  const graphNode = ((execCtx?.graph_json as any)?.nodes ?? [])
    .find((n: any) => n?.id === row.node_id);
  const expectedCount = clampIterations(graphNode?.data?.config?.iterations ?? graphNode?.config?.iterations);
  return { execCtx, outputType, expectedCount };
}

/** Claim fan-out finalization; the winner dispatches children (idempotent vs. a racing webhook). */
async function finalizeFanOut(
  supabase: Supa, row: FanOutRow, outputType: NodeResultType, expectedCount: number, baseUrl: string
): Promise<void> {
  const { data: claimed } = await supabase.rpc('finalize_fan_out', {
    p_execution_id: row.execution_id, p_node_id: row.node_id,
    p_output_type: outputType, p_expected_count: expectedCount,
  });
  if (claimed === true) {
    await checkAndDispatchChildren(row.execution_id, row.node_id, baseUrl);
  } else {
    console.log(`[Sweep] fanout ${row.execution_id}/${row.node_id} finalize did not claim (not all iterations resolved or parent not running)`);
  }
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
  const minUpdatedAt = new Date(Date.now() - MAX_AGE_MS).toISOString();

  // ── Single-node jobs ───────────────────────────────────────────────────────
  const { data: singles } = await supabase
    .from('node_results')
    .select('execution_id, node_id, provider_id, provider_job_id, status, updated_at, last_polled_at')
    .in('status', ['pending', 'running'])
    .not('provider_job_id', 'is', null)
    .gte('updated_at', minUpdatedAt)
    .order('last_polled_at', { ascending: true, nullsFirst: true })
    .limit(MAX_PER_SWEEP);

  for (const row of singles || []) {
    report.scanned++;
    if (!isStale(row.last_polled_at, row.updated_at)) { report.stillPending++; continue; }
    if (!row.provider_id) { report.errors++; continue; }

    // Bump last_polled_at FIRST (success, throw, and unknown-adapter paths alike):
    // a perma-throwing poll must not keep the row at the head of every sweep and
    // starve the rest of the queue. updated_at is untouched, so the deadline
    // reference (last real status write) is preserved.
    await supabase.from('node_results')
      .update({ last_polled_at: new Date().toISOString() })
      .eq('execution_id', row.execution_id).eq('node_id', row.node_id);

    try {
      const adapter = getAsyncAdapter(row.provider_id);
      // Unknown adapter gets the same treatment as a throwing poll: the catch
      // below deadline-fails it once it's past the deadline, else errors++.
      if (!adapter) throw new Error(`No async adapter registered for provider '${row.provider_id}'`);
      const poll = await adapter.poll(row.provider_job_id as string);

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
      console.error(`[Sweep] single ${row.execution_id}/${row.node_id} sweep failed:`, err);
      if (pastDeadline(row.updated_at)) {
        // The job has been unresolvable (poll/adapter failing) past the deadline:
        // terminal-fail + refund so it can't be swept forever. Own try/catch so a
        // failing fail-path still just logs and never kills the sweep loop.
        try {
          await completeJob({
            executionId: row.execution_id, nodeId: row.node_id,
            providerId: row.provider_id as string, providerJobId: row.provider_job_id as string,
            outcome: { status: 'failed', error: 'Generation unresolvable (poll failing past deadline)' }, baseUrl,
          });
          report.deadlined++;
          continue;
        } catch (failErr) {
          console.error(`[Sweep] single ${row.execution_id}/${row.node_id} deadline-fail also failed:`, failErr);
        }
      }
      report.errors++;
    }
  }

  // ── Fan-out predictions ─────────────────────────────────────────────────────
  const { data: preds } = await supabase
    .from('node_predictions')
    .select('execution_id, node_id, prediction_index, provider_id, provider_job_id, status, updated_at, last_polled_at')
    .eq('status', 'pending')
    .not('provider_job_id', 'is', null)
    .gte('updated_at', minUpdatedAt)
    .order('last_polled_at', { ascending: true, nullsFirst: true })
    .limit(MAX_PER_SWEEP);

  for (const row of preds || []) {
    report.scanned++;
    if (!isStale(row.last_polled_at, row.updated_at)) { report.stillPending++; continue; }
    if (!row.provider_id) { report.errors++; continue; }

    // Same starvation guard as the single loop: bump BEFORE polling so a
    // throwing poll / unknown adapter can't pin the row at the queue head.
    await supabase.from('node_predictions')
      .update({ last_polled_at: new Date().toISOString() })
      .eq('execution_id', row.execution_id).eq('node_id', row.node_id)
      .eq('prediction_index', row.prediction_index);

    try {
      const adapter = getAsyncAdapter(row.provider_id);
      if (!adapter) throw new Error(`No async adapter registered for provider '${row.provider_id}'`);
      const poll = await adapter.poll(row.provider_job_id as string);

      if (poll.status === 'pending' && !pastDeadline(row.updated_at)) { report.stillPending++; continue; }

      const { execCtx, outputType, expectedCount } = await getFanOutExecContext(supabase, row);

      if (poll.status === 'completed') {
        let resultData = toResultDataForType(outputType, poll.outputs);
        if (isMediaResultType(outputType)) {
          try {
            resultData = await mirrorMediaToStorage(
              supabase,
              resultData.filter((i): i is string => typeof i === 'string'),
              outputType,
              (execCtx?.sessions as any)?.user_id || 'unknown_user',
              (execCtx as any)?.session_id || 'unknown_session',
              row.node_id
            );
          } catch (mirrorErr) {
            // Never persist un-mirrored provider URLs (they expire). Retry next
            // tick until the deadline, then give up: fail + refund the iteration.
            if (pastDeadline(row.updated_at)) {
              if (await failIterationGuarded(
                supabase, row, 'Generation completed but media could not be stored (mirror failing past deadline)'
              )) report.deadlined++;
              await finalizeFanOut(supabase, row, outputType, expectedCount, baseUrl);
              continue;
            }
            console.error(`[Sweep] fanout ${row.execution_id}/${row.node_id}#${row.prediction_index} mirror failed (will retry):`, mirrorErr);
            report.errors++;
            continue;
          }
        }
        // Guarded: only flip a row that's still pending — a concurrent webhook
        // may have already resolved this iteration; never clobber it.
        const { data: affected } = await supabase.from('node_predictions').update({
          status: 'completed', result_data: resultData, error: null, updated_at: new Date().toISOString(),
        })
          .eq('execution_id', row.execution_id).eq('node_id', row.node_id)
          .eq('prediction_index', row.prediction_index)
          .eq('status', 'pending')
          .select('prediction_index');
        if (affected && affected.length > 0) report.completed++;
        // Affected nothing → already resolved elsewhere; still fall through to finalize.
      } else {
        const flipped = await failIterationGuarded(
          supabase, row,
          poll.error || (poll.status === 'pending' ? 'Iteration timed out' : 'Iteration failed')
        );
        if (flipped) report.failed++;
      }

      await finalizeFanOut(supabase, row, outputType, expectedCount, baseUrl);
    } catch (err) {
      console.error(`[Sweep] fanout ${row.execution_id}/${row.node_id}#${row.prediction_index} sweep failed:`, err);
      if (pastDeadline(row.updated_at)) {
        // Unresolvable past the deadline: guarded fail + refund + finalize, all
        // inside its own try/catch so a failing fail-path still just logs.
        try {
          const flipped = await failIterationGuarded(
            supabase, row, 'Generation unresolvable (poll failing past deadline)'
          );
          const { outputType, expectedCount } = await getFanOutExecContext(supabase, row);
          await finalizeFanOut(supabase, row, outputType, expectedCount, baseUrl);
          if (flipped) { report.deadlined++; continue; }
        } catch (failErr) {
          console.error(`[Sweep] fanout ${row.execution_id}/${row.node_id}#${row.prediction_index} deadline-fail also failed:`, failErr);
        }
      }
      report.errors++;
    }
  }

  return report;
}
