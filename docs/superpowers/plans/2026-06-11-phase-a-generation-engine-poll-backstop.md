# Phase A — Generation Engine Generalization + Poll Backstop — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every generation provider a poll-capable adapter behind one idempotent completion pipeline, and add a cron poll-backstop so a missed Replicate webhook can no longer strand a job on "loading" — all with Replicate as the only provider (regression-safe), before any new vendor is added.

**Architecture:** Extract the completion logic welded inside the Replicate webhook route into a provider-agnostic `completeJob()` gated by a new atomic `claim_node_completion` RPC (modeled on the existing `finalize_fan_out`). Generalize the result tables with `provider_id` / `provider_job_id` / `attempt` / `last_polled_at`. Add a `ReplicateAsyncAdapter` implementing `submit`/`poll`/`classifyError`. Add an every-minute `/api/cron/sweep-pending` that polls stale `pending`/`running` jobs and drives them to completion through the same pipeline.

**Tech stack:** Next.js App Router (route handlers, `nodejs` runtime), Supabase (Postgres + service-role client, SQL migrations/RPCs), the `replicate` npm SDK, TypeScript.

**Verification note (read first):** This repo has **no unit-test runner** (see CLAUDE.md). Verification in every task uses (a) `npx tsc --noEmit` for typecheck, and (b) ad-hoc `node scripts/<name>.js` integration scripts run against live Supabase + env (the established pattern in `scripts/`). SQL is verified by applying the migration to the live database and running a probe script. Do **not** introduce Jest/Vitest.

**Plan-wide prerequisites:**
- A working `.env.local` with `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `REPLICATE_API_TOKEN`, `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`.
- Database migrations are applied with the project's existing mechanism (Supabase SQL editor or `node scripts/apply-migration.js` if present — confirm before Task 1; if neither, apply by pasting the SQL into the Supabase SQL editor).
- **Vercel plan:** an every-minute cron (`* * * * *`) requires **Vercel Pro**. If the project is on Hobby (daily-only cron), see Task 12's fallback (external 1/min pinger hitting the same authenticated route). Confirm the plan before Task 11.

**Spec:** `docs/superpowers/specs/2026-06-11-multi-provider-generation-failover-design.md` (Phase A = §7 first bullet; completion model §5.1; concurrency §6; adapter interface §5.3).

---

## File Structure (what this phase creates/modifies)

**Create:**
- `supabase/migrations/20260611_add_provider_job_columns.sql` — generalize result tables.
- `supabase/migrations/20260611_claim_node_completion.sql` — single-node atomic completion claim RPC.
- `lib/workflow/complete-job.ts` — provider-agnostic single-node completion pipeline.
- `lib/ai/providers/replicate.ts` — `ReplicateAsyncAdapter` (submit/poll/classifyError).
- `lib/ai/providers/async-registry.ts` — maps `providers.adapter_key`/`'replicate'` → async adapter.
- `app/api/cron/sweep-pending/route.ts` — the poll backstop.
- `lib/workflow/sweep-pending.ts` — sweep logic (selection + poll + drive completion), imported by the route.
- `scripts/probe-replicate-poll.js` — live probe for `ReplicateAsyncAdapter.poll()`.
- `scripts/verify-phase-a-schema.js` — asserts the new columns + RPC exist.

**Modify:**
- `lib/ai/providers/types.ts` — add `AsyncProviderAdapter` + `ErrorClass` (keep existing sync `ProviderAdapter`).
- `app/api/webhooks/replicate-v2/route.ts` — single-prediction success/failure paths call `completeJob`.
- `lib/workflow/dispatch-v2.ts` — single-node `running` write records `provider_id`/`provider_job_id`.
- `vercel.json` — add the `sweep-pending` cron entry.

**Deliberately NOT changed in Phase A:** the fan-out `finalize_fan_out` path keeps its existing webhook handling; the sweep covers fan-out predictions too (Task 10b) but reuses the existing `finalize_fan_out` RPC. The `replicate_id` columns are kept (aliased) and dropped in a later phase, not here.

---

## Task 1: Migration — generalize result tables with provider columns

**Files:**
- Create: `supabase/migrations/20260611_add_provider_job_columns.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Migration: Generalize result tables for multi-provider generation (Phase A)
-- Date: 2026-06-11
-- Description:
--   Adds provider-agnostic job identity + poll bookkeeping to node_results and
--   node_predictions. Replicate is backfilled as the provider for every existing
--   row that carries a replicate_id. The replicate_id columns are KEPT (aliased)
--   and dropped in a later phase — nothing in Phase A relies on their removal.
--
--   provider_id     : adapter key of the provider that owns the job ('replicate' for all today)
--   provider_job_id : the provider's job/prediction id (mirror of replicate_id for Replicate)
--   attempt         : failover attempt index (0 for every Phase A row; used by Phase C)
--   last_polled_at  : when the cron sweep last polled this job (NULL = never); drives backoff

ALTER TABLE public.node_results
  ADD COLUMN IF NOT EXISTS provider_id     TEXT,
  ADD COLUMN IF NOT EXISTS provider_job_id TEXT,
  ADD COLUMN IF NOT EXISTS attempt         INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_polled_at  TIMESTAMPTZ;

ALTER TABLE public.node_predictions
  ADD COLUMN IF NOT EXISTS provider_id     TEXT,
  ADD COLUMN IF NOT EXISTS provider_job_id TEXT,
  ADD COLUMN IF NOT EXISTS attempt         INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_polled_at  TIMESTAMPTZ;

-- Backfill existing rows: anything with a replicate_id is a Replicate job.
UPDATE public.node_results
  SET provider_id = 'replicate', provider_job_id = replicate_id
  WHERE replicate_id IS NOT NULL AND provider_id IS NULL;

UPDATE public.node_predictions
  SET provider_id = 'replicate', provider_job_id = replicate_id
  WHERE replicate_id IS NOT NULL AND provider_id IS NULL;

-- The sweep selects non-terminal rows that have a provider job to poll. A partial
-- index keeps that scan cheap as the tables grow.
CREATE INDEX IF NOT EXISTS idx_node_results_pending_jobs
  ON public.node_results (last_polled_at)
  WHERE status IN ('pending', 'running') AND provider_job_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_node_predictions_pending_jobs
  ON public.node_predictions (last_polled_at)
  WHERE status = 'pending' AND provider_job_id IS NOT NULL;
```

- [ ] **Step 2: Apply the migration to the live database**

Apply with the project's migration mechanism (Supabase SQL editor, or `node scripts/apply-migration.js supabase/migrations/20260611_add_provider_job_columns.sql` if that helper exists). Expected: no errors; statements are idempotent (`IF NOT EXISTS`).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260611_add_provider_job_columns.sql
git commit -m "feat(db): add provider_id/provider_job_id/attempt/last_polled_at to result tables"
```

---

## Task 2: Migration — `claim_node_completion` RPC (single-node atomic claim)

**Files:**
- Create: `supabase/migrations/20260611_claim_node_completion.sql`

This is the load-bearing fix: the single-prediction completion path currently does a plain upsert + unconditional child dispatch, which is only safe with exactly one trigger. The cron sweep adds a second trigger, so completion must be claimed exactly once — mirroring `finalize_fan_out`.

- [ ] **Step 1: Write the migration**

```sql
-- Migration: Atomic single-node completion claim (Phase A)
-- Date: 2026-06-11
-- Description:
--   Claims the running/pending -> terminal transition for a SINGLE (non-fan-out)
--   node exactly once, writing the terminal result in the same locked statement.
--   Returns TRUE only for the caller that won the transition; that caller is the
--   one allowed to dispatch children. Mirrors finalize_fan_out's locking style so
--   concurrent triggers (a late webhook + the cron sweep) cannot double-complete
--   or double-dispatch.
--
--   The loser (status already terminal) gets FALSE and writes nothing, so its own
--   mirrored media is simply discarded (storage waste is acceptable; correctness
--   is not). Callers therefore mirror media BEFORE calling this, then pass the
--   durable result_data in.

CREATE OR REPLACE FUNCTION public.claim_node_completion(
  p_execution_id UUID,
  p_node_id      TEXT,
  p_status       TEXT,          -- 'completed' | 'failed'
  p_result_type  TEXT,          -- NULL allowed for 'failed'
  p_result_data  JSONB,         -- NULL allowed for 'failed'
  p_error        TEXT,          -- NULL for 'completed'
  p_provider_id  TEXT,          -- serving provider (e.g. 'replicate')
  p_provider_job_id TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status TEXT;
BEGIN
  -- Lock the node's row. Only a row currently in a non-terminal state is a
  -- completion candidate. A missing row is created (an early poll/webhook that
  -- beat the dispatcher's 'running' write) so the result is never lost.
  SELECT status
    INTO v_status
  FROM public.node_results
  WHERE execution_id = p_execution_id
    AND node_id = p_node_id
  FOR UPDATE;

  IF FOUND AND v_status IN ('completed', 'failed') THEN
    -- Already finalized by another trigger — this caller loses the claim.
    RETURN FALSE;
  END IF;

  INSERT INTO public.node_results AS nr
    (execution_id, node_id, status, result_type, result_data, error,
     provider_id, provider_job_id, updated_at)
  VALUES
    (p_execution_id, p_node_id, p_status, p_result_type, p_result_data, p_error,
     p_provider_id, p_provider_job_id, NOW())
  ON CONFLICT (execution_id, node_id) DO UPDATE
    SET status          = EXCLUDED.status,
        result_type     = EXCLUDED.result_type,
        result_data     = EXCLUDED.result_data,
        error           = EXCLUDED.error,
        provider_id     = EXCLUDED.provider_id,
        provider_job_id = EXCLUDED.provider_job_id,
        updated_at      = NOW();

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_node_completion(UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_node_completion(UUID, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT)
  TO service_role;

COMMENT ON FUNCTION public.claim_node_completion IS
  'Atomically claims a single (non-fan-out) node''s running/pending->terminal transition and writes the result under a row lock. Returns true only for the caller that won; that caller dispatches children exactly once.';
```

> Note: the INSERT preserves existing columns (`session_id`, `user_id`) on conflict by not overwriting them — they keep whatever the dispatcher's `running` write set. If the row is created fresh by an early poll, `session_id`/`user_id` are NULL; that matches today's behavior when a webhook beats the dispatcher and is corrected by the realtime/hydrate path. Do not add them as params in Phase A.

- [ ] **Step 2: Apply the migration to the live database**

Apply as in Task 1, Step 2. Expected: function created, no errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260611_claim_node_completion.sql
git commit -m "feat(db): add claim_node_completion RPC for atomic single-node completion"
```

---

## Task 3: Verify schema changes against the live DB

**Files:**
- Create: `scripts/verify-phase-a-schema.js`

- [ ] **Step 1: Write the verification script**

```js
// scripts/verify-phase-a-schema.js
// Verifies Phase A schema changes are live: new columns + the claim RPC exist.
// Run: node scripts/verify-phase-a-schema.js
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  // 1. Columns exist: selecting them must not error.
  for (const table of ['node_results', 'node_predictions']) {
    const { error } = await supabase
      .from(table)
      .select('provider_id, provider_job_id, attempt, last_polled_at')
      .limit(1);
    if (error) {
      console.error(`❌ ${table} missing new columns:`, error.message);
      process.exit(1);
    }
    console.log(`✅ ${table} has provider columns`);
  }

  // 2. RPC exists: calling with a non-existent execution returns TRUE/FALSE, not a
  //    "function does not exist" error. Use a random uuid + a status of 'failed'
  //    so even if it inserts, it's a harmless orphan row we immediately delete.
  const fakeExec = '00000000-0000-0000-0000-0000000000aa';
  const { data, error } = await supabase.rpc('claim_node_completion', {
    p_execution_id: fakeExec,
    p_node_id: '__phase_a_probe__',
    p_status: 'failed',
    p_result_type: null,
    p_result_data: null,
    p_error: 'probe',
    p_provider_id: 'replicate',
    p_provider_job_id: 'probe',
  });
  if (error) {
    console.error('❌ claim_node_completion RPC error:', error.message);
    process.exit(1);
  }
  console.log('✅ claim_node_completion callable, returned:', data);

  // Clean up the probe row.
  await supabase.from('node_results').delete()
    .eq('execution_id', fakeExec).eq('node_id', '__phase_a_probe__');
  console.log('✅ probe row cleaned up');
  process.exit(0);
})();
```

- [ ] **Step 2: Run it**

Run: `node scripts/verify-phase-a-schema.js`
Expected: four ✅ lines, exit 0. If any ❌, the corresponding migration was not applied — fix before continuing.

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-phase-a-schema.js
git commit -m "test(db): add Phase A schema verification script"
```

---

## Task 4: Add the async adapter interface

**Files:**
- Modify: `lib/ai/providers/types.ts`

- [ ] **Step 1: Append the async interface (keep the existing sync one untouched)**

Add to the END of `lib/ai/providers/types.ts`:

```typescript
/**
 * Normalized failure classes the orchestrator acts on, independent of how each
 * provider spells its errors. `transient` = capacity/outage/timeout (failover or
 * retry); `validation` = bad input (terminal); `moderation` = content rejected
 * (terminal, no retry/failover).
 */
export type ErrorClass = 'transient' | 'validation' | 'moderation';

/** Normalized poll result from an async provider. `outputs` are RAW provider URLs
 *  (the completion pipeline mirrors them — adapters never mirror). */
export interface ProviderPollResult {
  status: 'pending' | 'completed' | 'failed';
  outputs?: any;            // raw provider output (URLs/strings/objects), pre-normalization
  error?: string | null;
}

/**
 * Async provider adapter. Separate from the sync `ProviderAdapter` so the sync
 * path (ElevenLabs) never carries dead submit/poll branches. `submit` creates the
 * job and returns its provider id; `poll` is the authoritative completion source;
 * `classifyError` is operation-aware (a 429 on a POLL is back-off, not failover).
 */
export interface AsyncProviderAdapter {
  key: string;                       // matches providers.adapter_key; 'replicate' for the default
  mode: 'async';
  submit(
    model: ProviderAdapterModel,
    inputs: Record<string, any>,
    ctx: ExecutionContext,
    opts?: { webhookUrl?: string }
  ): Promise<{ providerJobId: string; status: 'pending' | 'completed'; outputs?: any }>;
  poll(providerJobId: string): Promise<ProviderPollResult>;
  classifyError(op: 'submit' | 'poll', httpStatus: number | null, body: unknown): ErrorClass;
  fetchSchema?(modelSlug: string): Promise<any>;       // optional; Phase B
  parseWebhook?(req: Request): { providerJobId: string } | null;  // optional; Phase B
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no new errors). `ExecutionContext`, `ProviderAdapterModel` are already imported/defined in this file from Phase 0.

- [ ] **Step 3: Commit**

```bash
git add lib/ai/providers/types.ts
git commit -m "feat(providers): add AsyncProviderAdapter interface + ErrorClass"
```

---

## Task 5: Implement `ReplicateAsyncAdapter`

**Files:**
- Create: `lib/ai/providers/replicate.ts`

- [ ] **Step 1: Write the adapter**

```typescript
import { replicate, normalizeReplicateOutput } from '@/lib/ai/replicate-client';
import { AsyncProviderAdapter, ErrorClass, ProviderPollResult } from './types';

/**
 * Replicate as a first-class async adapter. `submit` creates a prediction with a
 * webhook (prod) — Phase A keeps the existing local-sync `replicate.run()` path in
 * the executor untouched, so `submit` here is used by the failover/sweep paths and
 * always uses predictions.create. `poll` reads the authoritative prediction status,
 * which is what makes the cron backstop work without trusting the webhook body.
 */
export const replicateAsyncAdapter: AsyncProviderAdapter = {
  key: 'replicate',
  mode: 'async',

  async submit(model, inputs, ctx, opts) {
    const modelRef = (model as any).replicate_model_id as string;
    if (!modelRef) throw new Error('replicate adapter: model has no replicate_model_id');
    const version = modelRef.includes(':') ? modelRef.split(':').pop() : undefined;
    const prediction = await replicate.predictions.create({
      ...(version ? { version } : { model: modelRef }),
      input: inputs,
      ...(opts?.webhookUrl
        ? { webhook: opts.webhookUrl, webhook_events_filter: ['completed'] }
        : {}),
    } as any);
    return { providerJobId: prediction.id, status: 'pending' };
  },

  async poll(providerJobId): Promise<ProviderPollResult> {
    const p = await replicate.predictions.get(providerJobId);
    if (p.status === 'succeeded') {
      return { status: 'completed', outputs: normalizeReplicateOutput(p.output), error: null };
    }
    if (p.status === 'failed' || p.status === 'canceled') {
      return { status: 'failed', error: (p.error as any) || `Prediction ${p.status}` };
    }
    // 'starting' | 'processing'
    return { status: 'pending' };
  },

  classifyError(op, httpStatus, body): ErrorClass {
    const msg = typeof body === 'string'
      ? body
      : ((body as any)?.detail || (body as any)?.error || '').toString().toLowerCase();
    // Content moderation (terminal, no failover).
    if (msg.includes('nsfw') || msg.includes('flagged') || msg.includes('content policy') ||
        msg.includes('safety') || msg.includes('sensitive')) {
      return 'moderation';
    }
    // Transient/capacity/outage (failover/retry). A 429/5xx on submit is capacity;
    // on poll it is back-off (the caller decides — see sweep/failover logic).
    if (httpStatus === 429 || (httpStatus !== null && httpStatus >= 500)) return 'transient';
    // Default for 4xx submit errors is bad input.
    return 'validation';
  },
};
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. (`replicate.predictions.get` and `.create` exist on the SDK; the `as any` on `create` mirrors the executor's existing usage to satisfy the version|model union.)

- [ ] **Step 3: Commit**

```bash
git add lib/ai/providers/replicate.ts
git commit -m "feat(providers): add ReplicateAsyncAdapter (submit/poll/classifyError)"
```

---

## Task 6: Async adapter registry

**Files:**
- Create: `lib/ai/providers/async-registry.ts`

- [ ] **Step 1: Write the registry**

```typescript
import { AsyncProviderAdapter } from './types';
import { replicateAsyncAdapter } from './replicate';

/**
 * Maps a provider key to its async adapter. The default provider (no/`'replicate'`
 * adapter_key) resolves to the Replicate adapter. New async providers (FAL,
 * WaveSpeed, KIE, Kinovi) are added here in Phase B/C.
 */
const asyncAdapters: Record<string, AsyncProviderAdapter> = {
  replicate: replicateAsyncAdapter,
};

export function getAsyncAdapter(key: string | null | undefined): AsyncProviderAdapter {
  const resolved = key && asyncAdapters[key] ? asyncAdapters[key] : asyncAdapters.replicate;
  return resolved;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/ai/providers/async-registry.ts
git commit -m "feat(providers): add async adapter registry (replicate default)"
```

---

## Task 7: The shared `completeJob` pipeline (single-node)

**Files:**
- Create: `lib/workflow/complete-job.ts`

This consolidates the single-prediction success/failure logic the webhook currently inlines (mirror → write → dispatch children), now gated by `claim_node_completion`. Fan-out keeps its own `finalize_fan_out` path.

- [ ] **Step 1: Write the module**

```typescript
import { createServiceClient } from '@/lib/supabase/service';
import { checkAndDispatchChildren } from '@/lib/workflow/orchestrator';
import {
  NodeResultType,
  isMediaResultType,
  toResultDataForType,
} from '@/lib/workflow/result-format';
import { resolveNodeOutputWireTypeFromGraph } from '@/lib/workflow/output-type';
import { mirrorMediaToStorage } from '@/lib/workflow/media-mirror';

function isReplicateHostedUrl(value: string): boolean {
  return value.includes('replicate.delivery') || value.includes('replicate.com');
}

/**
 * Provider-agnostic completion for a SINGLE (non-fan-out) node. Idempotent under
 * concurrent triggers (a late webhook + the cron sweep): media is mirrored, then
 * `claim_node_completion` atomically claims the running->terminal transition and
 * writes the result. Only the caller that WINS the claim dispatches children, so
 * children fire exactly once no matter how many triggers race.
 *
 * `outputs` is the RAW provider output (already normalized to {url}/{text} shape
 * by the adapter's poll/normalize); this function owns mirroring + persistence.
 */
export async function completeJob(args: {
  executionId: string;
  nodeId: string;
  providerId: string;
  providerJobId: string;
  outcome: { status: 'completed' | 'failed'; outputs?: any; error?: string | null };
  baseUrl: string;
}): Promise<void> {
  const { executionId, nodeId, providerId, providerJobId, outcome, baseUrl } = args;
  const supabase = createServiceClient();

  const { data: executionCtx } = await supabase
    .from('executions')
    .select('session_id, graph_json, sessions(user_id)')
    .eq('id', executionId)
    .single();

  const storageUserId = (executionCtx?.sessions as any)?.user_id || 'unknown_user';
  const storageSessionId = executionCtx?.session_id || 'unknown_session';

  // ── Failure ──────────────────────────────────────────────────────────────
  if (outcome.status === 'failed') {
    const won = await supabase.rpc('claim_node_completion', {
      p_execution_id: executionId,
      p_node_id: nodeId,
      p_status: 'failed',
      p_result_type: null,
      p_result_data: null,
      p_error: outcome.error || 'Generation failed',
      p_provider_id: providerId,
      p_provider_job_id: providerJobId,
    });
    if (won.data === true) {
      await checkAndDispatchChildren(executionId, nodeId, baseUrl);
    }
    return;
  }

  // ── Success ──────────────────────────────────────────────────────────────
  const outputType: NodeResultType = await resolveNodeOutputWireTypeFromGraph(
    supabase,
    executionCtx?.graph_json,
    nodeId
  );
  let resultData = toResultDataForType(outputType, outcome.outputs);

  let failError: string | null = null;
  try {
    if (isMediaResultType(outputType)) {
      resultData = await mirrorMediaToStorage(
        supabase,
        resultData.filter((item): item is string => typeof item === 'string'),
        outputType,
        storageUserId,
        storageSessionId,
        nodeId
      );
    }
  } catch (uploadErr) {
    failError = `Media upload to storage failed: ${
      uploadErr instanceof Error ? uploadErr.message : 'Unknown error'
    }`;
  }

  if (!failError && resultData.some((item) => typeof item === 'string' && isReplicateHostedUrl(item))) {
    failError = 'Media could not be permanently stored. Please re-run the node.';
  }

  const won = await supabase.rpc('claim_node_completion', {
    p_execution_id: executionId,
    p_node_id: nodeId,
    p_status: failError ? 'failed' : 'completed',
    p_result_type: failError ? null : outputType,
    p_result_data: failError ? null : resultData,
    p_error: failError,
    p_provider_id: providerId,
    p_provider_job_id: providerJobId,
  });

  if (won.data === true) {
    await checkAndDispatchChildren(executionId, nodeId, baseUrl);
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. All imports already exist (`mirrorMediaToStorage`, `resolveNodeOutputWireTypeFromGraph`, `toResultDataForType`, `isMediaResultType`, `checkAndDispatchChildren`).

- [ ] **Step 3: Commit**

```bash
git add lib/workflow/complete-job.ts
git commit -m "feat(workflow): add shared completeJob pipeline (claim-gated single-node)"
```

---

## Task 8: Route the single-prediction webhook through `completeJob`

**Files:**
- Modify: `app/api/webhooks/replicate-v2/route.ts`

Keep all fan-out branches exactly as-is. Replace the **single-run** (`!isFanOut`) success and failure blocks with a `completeJob` call, so the webhook and the sweep share one idempotent path.

- [ ] **Step 1: Import `completeJob`**

At the top of `app/api/webhooks/replicate-v2/route.ts`, add to the imports:

```typescript
import { completeJob } from '@/lib/workflow/complete-job';
```

- [ ] **Step 2: Replace the single-run success block**

In the `if (status === 'succeeded') { ... }` block, the code currently mirrors media, then has three single-run branches (upload-failure upsert, replicate-hosted-url upsert, and the final success upsert) interleaved with `isFanOut` branches. Replace the **entire** `if (status === 'succeeded')` block (lines from `if (status === 'succeeded') {` through its closing brace before `} else if (status === 'failed'`) with:

```typescript
    if (status === 'succeeded') {
      const normalizedOutput = normalizeReplicateOutput(output);

      if (isFanOut) {
        const outputType = await resolveNodeOutputWireTypeFromGraph(supabase, executionCtx?.graph_json, nodeId);
        let resultData = toResultDataForType(outputType, normalizedOutput);
        try {
          if (isMediaResultType(outputType)) {
            resultData = await mirrorMediaToStorage(
              supabase,
              resultData.filter((item): item is string => typeof item === 'string'),
              outputType,
              userId,
              storageSessionId,
              nodeId
            );
          }
        } catch (uploadJobError) {
          await upsertPredictionRow(supabase, executionId, nodeId, predictionIndex, {
            status: 'failed',
            error: `Media upload to storage failed: ${uploadJobError instanceof Error ? uploadJobError.message : 'Unknown error'}`,
          });
          await refundFailedIteration(supabase, executionId, nodeId, predictionIndex);
          const { origin } = new URL(request.url);
          await finalizeFanOut(supabase, executionId, nodeId, outputType, expectedCount, origin);
          return NextResponse.json({ success: true });
        }
        if (resultData.some((item) => typeof item === 'string' && isReplicateHostedUrl(item))) {
          await upsertPredictionRow(supabase, executionId, nodeId, predictionIndex, {
            status: 'failed',
            error: 'Media could not be permanently stored. Please re-run the node.',
          });
          await refundFailedIteration(supabase, executionId, nodeId, predictionIndex);
          const { origin } = new URL(request.url);
          await finalizeFanOut(supabase, executionId, nodeId, outputType, expectedCount, origin);
          return NextResponse.json({ success: true });
        }
        await upsertPredictionRow(supabase, executionId, nodeId, predictionIndex, {
          status: 'completed',
          resultData,
          error: null,
        });
        const { origin } = new URL(request.url);
        await finalizeFanOut(supabase, executionId, nodeId, outputType, expectedCount, origin);
        return NextResponse.json({ success: true });
      }

      // Single run: idempotent shared pipeline (claim-gated). Safe against a
      // concurrent cron-sweep poll of the same prediction.
      const { origin } = new URL(request.url);
      await completeJob({
        executionId,
        nodeId,
        providerId: 'replicate',
        providerJobId: predictionId,
        outcome: { status: 'completed', outputs: normalizedOutput },
        baseUrl: origin,
      });
      return NextResponse.json({ success: true });
    } else if (status === 'failed' || status === 'canceled') {
```

> The single-run branch no longer references `userUuid`/`sessionId` directly — `completeJob` resolves owner/session itself. The fan-out branch still uses `userId`/`storageSessionId`/`isReplicateHostedUrl` exactly as before, so those helpers/vars remain in use.

- [ ] **Step 3: Replace the single-run failure block**

In the `} else if (status === 'failed' || status === 'canceled') {` block, keep the `if (isFanOut) { ... }` branch verbatim, and replace the single-run upsert + `checkAndDispatchChildren` that follows it with:

```typescript
      // Single run: shared claim-gated failure path.
      const { origin } = new URL(request.url);
      await completeJob({
        executionId,
        nodeId,
        providerId: 'replicate',
        providerJobId: predictionId,
        outcome: { status: 'failed', error: predictionError || `Prediction ${status}` },
        baseUrl: origin,
      });
      return NextResponse.json({ success: true });
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. If TypeScript flags `userUuid` or `checkAndDispatchChildren` as unused, remove the now-dead single-run import/var ONLY if no fan-out branch uses it (`checkAndDispatchChildren` is still used by `finalizeFanOut` indirectly but not directly here — leave the import; if tsc reports it unused, delete just the import line).

- [ ] **Step 5: Manual smoke test (local, single image gen)**

Run the app (`npm run dev`), open a workflow with one `ai_generator` node (iterations = 1), run it. Locally this uses `replicate.run()` (sync) and does NOT hit the webhook — so this step only confirms no regression in the sync path. Expected: node completes and shows the image. (The webhook path is exercised in Task 13's probe + the Task 14 prod checklist.)

- [ ] **Step 6: Commit**

```bash
git add app/api/webhooks/replicate-v2/route.ts
git commit -m "refactor(webhook): route single-prediction completion through shared completeJob"
```

---

## Task 9: Record `provider_id`/`provider_job_id` on the single-node running write

**Files:**
- Modify: `lib/workflow/dispatch-v2.ts`

The cron sweep finds jobs by `provider_job_id`. The single-node async dispatch currently writes only `replicate_prediction_id` into `node_results.replicate_id`. Add the generalized columns so the sweep can poll it.

- [ ] **Step 1: Extend `NodeState` write in `updateNodeState`**

In `lib/workflow/dispatch-v2.ts`, the `updateNodeState` upsert object (the `.upsert({ ... })` near line 358) currently sets `replicate_id: state.replicate_prediction_id`. Change that upsert object to ALSO set the generalized columns:

```typescript
        .upsert({
          execution_id: executionId,
          node_id: nodeId,
          session_id: sessionId,
          status: state.status || 'running',
          result_type: resolvedResultType,
          result_data: resolvedResultData,
          error: state.error,
          replicate_id: state.replicate_prediction_id,
          provider_id: state.replicate_prediction_id ? 'replicate' : undefined,
          provider_job_id: state.replicate_prediction_id,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'execution_id,node_id'
        });
```

> `undefined` fields are omitted by supabase-js, so a non-async write (ephemeral completion) leaves `provider_id` NULL. Only the async `running` write (which carries `replicate_prediction_id`) sets `provider_id = 'replicate'`.

- [ ] **Step 2: Mirror it on the fan-out prediction insert**

In `dispatchReplicateNode`, the fan-out `rows` mapping (near line 283) sets `replicate_id`. Add the generalized columns there too:

```typescript
    const rows = results.map((r, i) => ({
        execution_id: executionId,
        node_id: nodeId,
        prediction_index: i,
        replicate_id: r.status === 'pending' ? ((r.data as any)?.id ?? null) : null,
        provider_id: 'replicate',
        provider_job_id: r.status === 'pending' ? ((r.data as any)?.id ?? null) : null,
        status: r.status === 'pending' ? 'pending' : 'failed',
        error: r.status === 'pending' ? null : (r.error || 'Prediction create failed'),
        updated_at: new Date().toISOString(),
    }));
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. If `NodeState` (in `types-v2.ts`) does not allow `provider_id`/`provider_job_id` as keys, that's fine — these are added to the plain upsert object literal, not typed through `NodeState`. If tsc complains about excess properties on the upsert object, it won't (supabase-js `.upsert` accepts `Record<string, any>`).

- [ ] **Step 4: Commit**

```bash
git add lib/workflow/dispatch-v2.ts
git commit -m "feat(dispatch): record provider_id/provider_job_id on running + fan-out writes"
```

---

## Task 10: The poll-backstop sweep logic (single-node + fan-out)

**Files:**
- Create: `lib/workflow/sweep-pending.ts`

- [ ] **Step 1: Write the sweep module**

```typescript
import { createServiceClient } from '@/lib/supabase/service';
import { getAsyncAdapter } from '@/lib/ai/providers/async-registry';
import { completeJob } from '@/lib/workflow/complete-job';
import { resolveNodeOutputWireTypeFromGraph } from '@/lib/workflow/output-type';
import { toResultDataForType, isMediaResultType, NodeResultType } from '@/lib/workflow/result-format';
import { mirrorMediaToStorage } from '@/lib/workflow/media-mirror';
import { refundFailedIteration } from '@/lib/workflow/refund';
import { checkAndDispatchChildren, handleNodeFailure } from '@/lib/workflow/orchestrator';
import { clampIterations } from '@/lib/billing/cost';

// Only poll a job that's been idle for at least this long — webhooks resolve most
// jobs first; the sweep is the backstop for the ones that didn't get a callback.
const STALE_MS = 90_000;
// A job that never reaches a terminal status is failed + refunded past this age,
// so a submitted-but-dropped job can't be swept forever or strand the execution.
const DEADLINE_MS = 15 * 60_000;
// Bound per-tick work so one invocation never exceeds the function timeout.
const MAX_PER_SWEEP = 50;

function isStale(lastPolledAt: string | null, dispatchedAt: string | null): boolean {
  const ref = lastPolledAt || dispatchedAt;
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
    try {
      const adapter = getAsyncAdapter(row.provider_id);
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
    try {
      const adapter = getAsyncAdapter(row.provider_id);
      const poll = await adapter.poll(row.provider_job_id as string);
      await supabase.from('node_predictions')
        .update({ last_polled_at: new Date().toISOString() })
        .eq('execution_id', row.execution_id).eq('node_id', row.node_id)
        .eq('prediction_index', row.prediction_index);

      if (poll.status === 'pending' && !pastDeadline(row.updated_at)) { report.stillPending++; continue; }

      const { data: execCtx } = await supabase
        .from('executions').select('graph_json').eq('id', row.execution_id).single();
      const outputType: NodeResultType = await resolveNodeOutputWireTypeFromGraph(
        supabase, execCtx?.graph_json, row.node_id
      );
      const graphNode = ((execCtx?.graph_json as any)?.nodes ?? [])
        .find((n: any) => n?.id === row.node_id);
      const expectedCount = clampIterations(graphNode?.data?.config?.iterations ?? graphNode?.config?.iterations);

      if (poll.status === 'completed') {
        let resultData = toResultDataForType(outputType, poll.outputs);
        if (isMediaResultType(outputType)) {
          const { data: ses } = await supabase
            .from('executions').select('session_id, sessions(user_id)').eq('id', row.execution_id).single();
          resultData = await mirrorMediaToStorage(
            supabase,
            resultData.filter((i): i is string => typeof i === 'string'),
            outputType,
            (ses?.sessions as any)?.user_id || 'unknown_user',
            (ses as any)?.session_id || 'unknown_session',
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
      if (claimed === true) await checkAndDispatchChildren(row.execution_id, row.node_id, baseUrl);
    } catch (err) {
      report.errors++;
      console.error(`[Sweep] fanout ${row.execution_id}/${row.node_id}#${row.prediction_index} poll failed:`, err);
    }
  }

  return report;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. (`handleNodeFailure` is imported for symmetry with the webhook surface but only `checkAndDispatchChildren`/`finalize_fan_out` are used here — if tsc flags `handleNodeFailure` as unused, remove it from the import.)

- [ ] **Step 3: Commit**

```bash
git add lib/workflow/sweep-pending.ts
git commit -m "feat(workflow): add poll-backstop sweep (single-node + fan-out)"
```

---

## Task 11: The cron route + schedule

**Files:**
- Create: `app/api/cron/sweep-pending/route.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Write the route (auth mirrors the existing reconcile cron)**

```typescript
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
```

- [ ] **Step 2: Add the cron schedule**

In `vercel.json`, add this entry to the `crons` array (after the existing entries):

```json
        {
            "path": "/api/cron/sweep-pending",
            "schedule": "* * * * *"
        }
```

> **Vercel plan gate:** `* * * * *` (every minute) requires **Vercel Pro**. On Hobby, change the schedule to the most frequent allowed (or omit it from `vercel.json`) and instead drive the route every minute from an external scheduler (e.g. a free cron-job.org or QStash schedule) issuing `GET https://<app>/api/cron/sweep-pending` with header `Authorization: Bearer <CRON_SECRET>`. The route is identical either way.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Local manual invocation**

With `npm run dev` running:
Run: `curl -s -H "Authorization: Bearer YOUR_CRON_SECRET" http://localhost:3000/api/cron/sweep-pending`
(Replace `YOUR_CRON_SECRET` with the value from `.env.local`.)
Expected: JSON like `{"success":true,"scanned":0,"completed":0,...}` when there are no in-flight jobs. A `401` means the secret didn't match.

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/sweep-pending/route.ts vercel.json
git commit -m "feat(cron): add every-minute sweep-pending poll backstop route + schedule"
```

---

## Task 12: Live-probe the Replicate poll path

**Files:**
- Create: `scripts/probe-replicate-poll.js`

This confirms `ReplicateAsyncAdapter.poll()` reads real prediction status — the load-bearing assumption of the backstop.

- [ ] **Step 1: Write the probe**

```js
// scripts/probe-replicate-poll.js
// Creates a tiny real Replicate prediction, polls it to completion via the same
// SDK calls the adapter uses, and prints the normalized status transitions.
// Run: node scripts/probe-replicate-poll.js
require('dotenv').config({ path: '.env.local' });
const Replicate = require('replicate');

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

// A small, cheap, fast public model. Adjust if this version is unavailable.
const MODEL = 'black-forest-labs/flux-schnell';

(async () => {
  if (!process.env.REPLICATE_API_TOKEN) { console.error('❌ REPLICATE_API_TOKEN missing'); process.exit(1); }
  console.log('Creating prediction…');
  const created = await replicate.predictions.create({
    model: MODEL,
    input: { prompt: 'a single red apple on a white background', num_outputs: 1 },
  });
  console.log('✅ created id:', created.id, 'status:', created.status);

  let status = created.status;
  for (let i = 0; i < 60 && (status === 'starting' || status === 'processing'); i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const p = await replicate.predictions.get(created.id);
    status = p.status;
    console.log(`  poll ${i}: ${status}`);
    if (status === 'succeeded') {
      console.log('✅ output:', Array.isArray(p.output) ? p.output[0] : p.output);
      process.exit(0);
    }
    if (status === 'failed' || status === 'canceled') {
      console.error('❌ terminal failure:', p.error);
      process.exit(1);
    }
  }
  console.error('❌ did not reach terminal status in time');
  process.exit(1);
})();
```

- [ ] **Step 2: Run it**

Run: `node scripts/probe-replicate-poll.js`
Expected: `created id …`, a few `poll N: processing` lines, then `✅ output: https://…`. Confirms `predictions.get` returns the status/output the adapter relies on. (If the model version is unavailable, swap `MODEL` for any current fast model and re-run.)

- [ ] **Step 3: Commit**

```bash
git add scripts/probe-replicate-poll.js
git commit -m "test(providers): add live Replicate poll probe script"
```

---

## Task 13: End-to-end backstop verification (the actual bug fix)

No new files — this is a manual verification that a missed webhook now self-heals. Run against a deployed preview (webhooks need a public URL) OR simulate locally per Step 2.

- [ ] **Step 1 (preview/prod): Confirm normal completion still works**

Deploy the branch to a Vercel preview (so `predictions.create` uses the webhook). Run a single-image `ai_generator` node. Expected: it completes via webhook as before (no regression). Check logs for `[Webhook/Replicate-v2]` and a `completeJob` claim.

- [ ] **Step 2 (simulate a missed webhook): Verify the sweep heals it**

Temporarily point `NEXT_PUBLIC_APP_URL` at a black-hole (or block the webhook route) so the webhook never lands, then dispatch a single-image node. The node sits `running`. Now invoke the sweep:
Run: `curl -s -H "Authorization: Bearer YOUR_CRON_SECRET" https://<preview-url>/api/cron/sweep-pending`
Wait until the job is older than `STALE_MS` (90s) and re-invoke if needed.
Expected: the response shows `"completed":1`, and the node flips to its result in the UI (via the realtime `node_results` UPDATE). **This is the missed-webhook hang fixed.** Restore `NEXT_PUBLIC_APP_URL` afterward.

- [ ] **Step 3 (idempotency): Verify webhook + sweep don't double-dispatch**

Run a node that has a downstream child. Immediately after it completes via webhook, invoke the sweep while the prediction is still `< STALE_MS` old (the sweep should skip it) — then invoke again after it's stale (the sweep polls, sees `completed`, calls `completeJob`, but `claim_node_completion` returns FALSE so no second child dispatch). Expected: the child runs exactly once (check `node_results` for the child — a single row, one `dispatched_at`). Confirms the claim gate.

- [ ] **Step 4: Commit (verification notes, if any tweaks were needed)**

If Steps 1–3 required adjusting `STALE_MS`/`MAX_PER_SWEEP`, commit those:

```bash
git add lib/workflow/sweep-pending.ts
git commit -m "chore(sweep): tune stale threshold / batch size after E2E verification"
```

---

## Task 14: Final typecheck + phase wrap

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (zero errors). This is the project's authoritative build check (per project memory, `npm run lint`/`next build` are unreliable here).

- [ ] **Step 2: Run the schema verifier once more**

Run: `node scripts/verify-phase-a-schema.js`
Expected: all ✅, exit 0.

- [ ] **Step 3: Confirm the spec's Phase A scope is met**

Check each Phase A item is done: ☑ `completeJob` extracted + claim-gated; ☑ Replicate webhook routes single-run through it; ☑ provider columns added + backfilled; ☑ `replicate_id` retained (drop deferred); ☑ 1/min sweep route + schedule; ☑ sync/async adapter split + `ReplicateAsyncAdapter`; ☑ live-probe harness. Note any deferred item explicitly in the PR description.

- [ ] **Step 4: Open the PR**

```bash
git push -u origin dev
gh pr create --base main --title "Phase A: generation engine generalization + poll backstop" --body "Implements docs/superpowers/specs/2026-06-11-multi-provider-generation-failover-design.md Phase A. Fixes missed-webhook hangs via a claim-gated shared completeJob + every-minute poll backstop, Replicate-only (regression-safe). Adds the AsyncProviderAdapter seam for Phase B providers.

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

---

## Self-Review (completed during authoring)

- **Spec coverage:** Phase A bullets in §7 all map to tasks — completeJob+claim (Tasks 2,7,8), provider columns + replicate_id retained (Task 1), 1/min sweep (Tasks 10–11), sync/async split + ReplicateAsyncAdapter (Tasks 4–6), live-probe (Task 12). The concurrency layer (§6) is Task 2 (`claim_node_completion`) + the sweep's reuse of `finalize_fan_out`. Pending-job deadline (§5.1) is in Task 10 (`DEADLINE_MS`).
- **Out-of-scope honored:** no new providers, no `ai_model_providers` table, no failover chain, no `replicate_id` drop — all correctly deferred to Phase B/C.
- **Type consistency:** `AsyncProviderAdapter`/`ProviderPollResult`/`ErrorClass` (Task 4) are the exact names used in Tasks 5/6/10; `completeJob` arg shape (Task 7) matches its call sites (Tasks 8, 10); `claim_node_completion` param list (Task 2) matches the `.rpc()` calls (Task 7).
- **No placeholders:** every code step shows complete code; verification steps use real commands (`npx tsc --noEmit`, `node scripts/…`, `curl …`) with expected output, adapted to the no-test-runner reality.
