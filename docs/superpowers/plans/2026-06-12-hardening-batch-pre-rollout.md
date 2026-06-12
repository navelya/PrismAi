# Hardening Batch (Pre-Rollout) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 12 correctness/security/money issues a 3-reviewer panel found in the Phase A engine + Phase B backend, before the migrations are applied and the sweep cron is scheduled.

**Architecture:** No design change. Targeted fixes: enforce webhook signatures, harden the (still-unapplied, editable in place) `claim_node_completion` migration, net partial refunds out of `refund_tokens` (new migration), make the sweep starvation-proof and race-proof, make the FAL adapter fail-safe, guard the dispatcher's non-terminal writes, and make provider resolution loud + admin-edit-proof.

**Tech Stack:** Next.js route handlers, Supabase JS + plpgsql migrations, TypeScript.

**Verification reality:** No test runner. Every task verifies with `npx tsc --noEmit` (must be clean) and targeted reasoning/script checks. Commit after every task with a focused, file-scoped commit.

**Context for all tasks:** This repo runs AI generation jobs (Replicate today, FAL newly added) through a server-authoritative completion pipeline: `lib/workflow/complete-job.ts` mirrors media then calls the `claim_node_completion` RPC (atomic claim, winner dispatches children). A cron sweep (`lib/workflow/sweep-pending.ts`, route `app/api/cron/sweep-pending/route.ts`) polls stale jobs via `getAsyncAdapter(provider_id)` (`lib/ai/providers/async-registry.ts`). Credits are debited before dispatch; failures refund via the `refund_tokens` RPC; fan-out iterations additionally refund per-iteration via `refundFailedIteration` (`lib/workflow/refund.ts`). The three migrations `supabase/migrations/20260611_add_provider_job_columns.sql`, `20260611_claim_node_completion.sql`, `20260612_ai_model_providers.sql` are **NOT yet applied to the live DB** — the two 20260611/20260612 files may be edited in place; anything touching the already-applied `refund_tokens` (from `20260523_topup_balance_and_free_expiry.sql`) needs a NEW migration.

---

### Task 1: Enforce webhook signature + cron secret

**Files:**
- Modify: `app/api/webhooks/replicate-v2/route.ts` (~lines 119-125)
- Modify: `app/api/cron/sweep-pending/route.ts` (~line 9)

- [ ] **Step 1:** In `replicate-v2/route.ts`, find the signature-verification failure branch that logs `"Bypassing signature block for debugging purposes"` (or similar) and continues. Replace the bypass with a hard rejection: `return NextResponse.json({ error: 'Invalid webhook signature' }, { status: 400 });`. Keep the existing log line (as an error log). Do NOT touch the verification logic itself, only the failure handling. If `REPLICATE_WEBHOOK_SIGNING_SECRET` is unset, also reject with 500 + a clear log (a webhook pipeline without a secret must not accept payloads).
- [ ] **Step 2:** In `app/api/cron/sweep-pending/route.ts`, before comparing the Authorization header, add: `if (!process.env.CRON_SECRET) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });` so `Bearer undefined` can never authenticate.
- [ ] **Step 3:** `npx tsc --noEmit` → clean.
- [ ] **Step 4:** Commit: `fix(security): enforce replicate webhook signature + require CRON_SECRET`

### Task 2: Harden `claim_node_completion` (edit unapplied migration in place)

**Files:**
- Modify: `supabase/migrations/20260611_claim_node_completion.sql`

The current function has two holes: (a) a missing row means `FOR UPDATE` locks nothing → two concurrent callers can both INSERT..ON CONFLICT and both return TRUE; (b) it never compares `p_provider_job_id` to the row's current `provider_job_id`, so in Phase C a late trigger from a superseded attempt could terminal-fail a node whose newer attempt succeeds.

- [ ] **Step 1:** Replace the function body with this exact logic (keep signature, grants, comment; update the comment to mention the job-id guard):

```sql
DECLARE
  v_status TEXT;
  v_job_id TEXT;
BEGIN
  -- Ensure the row exists FIRST so FOR UPDATE serializes ALL callers, including
  -- an early webhook/poll that beat the dispatcher's 'running' write.
  INSERT INTO public.node_results (execution_id, node_id, status, session_id, user_id)
  VALUES (p_execution_id, p_node_id, 'running', p_session_id, p_user_id)
  ON CONFLICT (execution_id, node_id) DO NOTHING;

  SELECT status, provider_job_id
    INTO v_status, v_job_id
  FROM public.node_results
  WHERE execution_id = p_execution_id AND node_id = p_node_id
  FOR UPDATE;

  IF v_status IN ('completed', 'failed') THEN
    RETURN FALSE;  -- already finalized; this caller loses
  END IF;

  -- Attempt-stale guard: if the row is bound to a DIFFERENT provider job (a
  -- failover advanced the attempt), a late trigger for the old job loses.
  IF v_job_id IS NOT NULL AND p_provider_job_id IS NOT NULL
     AND v_job_id <> p_provider_job_id THEN
    RETURN FALSE;
  END IF;

  UPDATE public.node_results SET
    status          = p_status,
    result_type     = p_result_type,
    result_data     = p_result_data,
    error           = p_error,
    provider_id     = p_provider_id,
    provider_job_id = p_provider_job_id,
    session_id      = COALESCE(p_session_id, session_id),
    user_id         = COALESCE(p_user_id, user_id),
    updated_at      = NOW()
  WHERE execution_id = p_execution_id AND node_id = p_node_id;

  RETURN TRUE;
END;
```

- [ ] **Step 2:** Sanity-check `node_results` has no NOT NULL columns the bare INSERT misses (read `supabase/migrations` for the table definition; `status` + the two keys + defaults must suffice — if other NOT NULLs exist, include them with sensible values).
- [ ] **Step 3:** Update `scripts/audit-migrations.js`'s claim-RPC probe if its cleanup assumptions still hold (it deletes the probe row — the new INSERT path still creates one; verify the probe still passes conceptually).
- [ ] **Step 4:** `npx tsc --noEmit` → clean. Commit: `fix(engine): claim RPC — serialize missing-row race + reject stale provider_job_id`

### Task 3: Net partial refunds out of `refund_tokens` (NEW migration)

**Files:**
- Create: `supabase/migrations/20260612_refund_tokens_net_partial.sql`

Today `refund_tokens` refunds the **full** `ABS(execution_debit)` while `refundFailedIteration` has already credited `execution_partial_refund` rows per failed iteration → all-iterations-failed fan-outs refund ~2× (now deterministically reachable via the sweep deadline).

- [ ] **Step 1:** Read the existing `refund_tokens` definition in `supabase/migrations/20260523_topup_balance_and_free_expiry.sql` and the `execution_partial_refund` transaction shape written by `lib/workflow/refund.ts` (note the transaction table name, type/reason column, and how the execution id is stored — likely in the idempotency key or a column).
- [ ] **Step 2:** Write a `CREATE OR REPLACE FUNCTION public.refund_tokens(...)` migration with the SAME signature that subtracts the sum of prior `execution_partial_refund` credits for that execution from the refund amount, flooring at 0 (`GREATEST(0, full_debit - partial_sum)`). Keep the existing idempotency behavior (`refund:{executionId}` key) untouched. Header comment: why (double-refund), and that it must be applied together with the 20260611 migrations.
- [ ] **Step 3:** Add a check line for it to `scripts/audit-migrations.js` RECENT (a `functionExists`-style probe won't distinguish versions — mark it `MANUAL` with a one-line SQL hint comment instead).
- [ ] **Step 4:** `npx tsc --noEmit` → clean. Commit: `fix(billing): refund_tokens nets out prior partial iteration refunds`

### Task 4: `getAsyncAdapter` returns undefined for unknown keys

**Files:**
- Modify: `lib/ai/providers/async-registry.ts`
- Modify: `lib/nodes/plugins/ai_generator/executor.server.ts` (~line 221 guard)
- Modify: `app/api/providers/[key]/schema/route.ts`

- [ ] **Step 1:** Change `getAsyncAdapter(key)` to return `AsyncProviderAdapter | undefined` — NO silent replicate fallback. Keep a separate explicit `getAsyncAdapter('replicate')` working.
- [ ] **Step 2:** Fix all call sites: executor (throw a clear error if undefined — it already guards key mismatch, simplify to the undefined check), schema route (undefined → existing 501 path), sweep (handled properly in Task 5 — for THIS task just make it compile with an inline undefined check that counts `errors++` and `continue`s).
- [ ] **Step 3:** `npx tsc --noEmit` → clean. Commit: `fix(providers): unknown adapter key resolves to undefined, never replicate`

### Task 5: Sweep hardening

**Files:**
- Modify: `lib/workflow/sweep-pending.ts`

Four fixes, both loops where applicable:

- [ ] **Step 1 — age floor:** Add `const MAX_AGE_MS = 48 * 3600_000;` and `.gte('updated_at', new Date(Date.now() - MAX_AGE_MS).toISOString())` to BOTH queries. Rationale comment: the column backfill marked historic stranded rows pollable; sweeping them would mass-refund old executions and re-dispatch children into dead sessions. Rows older than 48h are left untouched (pre-clean manually if desired).
- [ ] **Step 2 — poll-throw starvation:** Restructure both loop bodies so that:
  - `last_polled_at` is bumped in a `finally` (or equivalently in BOTH success and catch paths) — a throwing poll must not keep the row at the head of every sweep.
  - The catch path ALSO deadline-checks: `if (pastDeadline(row.updated_at))` → call `completeJob` (single) / the fan-out failed-write + `refundFailedIteration` + `finalize_fan_out` (fan-out) with error `'Generation unresolvable (poll failing past deadline)'`, wrapped in its own try/catch so a failing fail-path still just logs.
  - Unknown adapter (`getAsyncAdapter` undefined): same treatment as a throwing poll — bump `last_polled_at`, deadline-fail when past deadline, else `errors++` and continue.
- [ ] **Step 3 — fan-out completed/failed race:** The fan-out failure UPDATE (~line 153) must add `.eq('status', 'pending')` and `.select('prediction_index')`; only call `refundFailedIteration` if the update affected a row. (Prevents flipping a concurrently-completed iteration to failed and refunding a success.) Same guard on the fan-out completed UPDATE (~line 148): add `.eq('status','pending')` — if it affected nothing, skip to finalize.
- [ ] **Step 4 — mirror failure on fan-out success:** Wrap the `mirrorMediaToStorage` call in try/catch: on throw, if `pastDeadline(row.updated_at)` treat as iteration failure (guarded failed-write + refund as above), else log + `errors++` + `continue` (retry next tick). This mirrors the single-node path's behavior of not persisting un-mirrored provider URLs.
- [ ] **Step 5:** `npx tsc --noEmit` → clean. Commit: `fix(sweep): age floor, poll-throw deadline path, status-guarded fan-out writes, mirror retry`

### Task 6: FAL adapter fail-safe

**Files:**
- Modify: `lib/ai/providers/fal.ts`

- [ ] **Step 1 — empty outputs are a failure, not an empty success:** In `poll()`, after `extractFalUrls(out)`, if the array is empty return `{ status: 'failed', error: 'FAL returned no recognizable media outputs: ' + JSON.stringify(out).slice(0, 500) }`.
- [ ] **Step 2 — transient response-fetch errors are not terminal:** The response GET's `!respRes.ok` branch must mirror the status endpoint's rule: `respRes.status >= 500 || respRes.status === 429` → `{ status: 'pending' }` (the sweep retries; the job genuinely completed and will still be there); other codes → failed.
- [ ] **Step 3 — fetch timeouts:** Add `signal: AbortSignal.timeout(30_000)` to the submit fetch and `AbortSignal.timeout(15_000)` to the three poll/response/schema fetches. In `poll()`, catch abort errors and return `{ status: 'pending' }` (transient); in `submit()`, let the abort throw but set `(err as any).errorClass = 'transient'`.
- [ ] **Step 4:** `npx tsc --noEmit` → clean. Commit: `fix(fal): empty-output = failure, transient result-fetch = pending, fetch timeouts`

### Task 7: Dispatcher write guards + job-id hygiene

**Files:**
- Modify: `lib/workflow/dispatch-v2.ts` (the `updateNodeState`-style upsert ~lines 361-380; running writes ~lines 200-207; fan-out rows ~lines 289-293)

- [ ] **Step 1 — non-terminal writes never overwrite terminal:** Find the shared upsert that writes node state. For writes where the NEW status is `pending` or `running`, replace blind upsert with: `UPDATE ... WHERE execution_id/node_id match AND status NOT IN ('completed','failed')` (PostgREST: `.update(...).eq(...).eq(...).not('status', 'in', '("completed","failed")').select('node_id')`); if 0 rows affected, attempt an insert with `ignoreDuplicates: true` upsert (`onConflict: 'execution_id,node_id'`) so a missing row is created but an existing (terminal) row is never clobbered. Terminal-status writes keep current behavior. Add a comment: an early webhook/sweep claim can land before the dispatcher's running write; regressing a terminal row re-opens it for the sweep → double child dispatch.
- [ ] **Step 2 — stop polluting `replicate_id`:** Where `replicate_prediction_id` / `replicate_id` is set from the submit result (~line 203 single, ~line 289 fan-out), only set it when the resolved provider is `'replicate'`; for other providers leave it null (the generic `provider_job_id` columns carry it).
- [ ] **Step 3:** `npx tsc --noEmit` → clean. Commit: `fix(dispatch): guard non-terminal writes against claimed rows; replicate_id only for replicate`

### Task 8: Loud provider resolution + admin slug-edit mirroring

**Files:**
- Modify: `lib/workflow/resolve-provider.ts`
- Modify: `app/api/admin/models/[id]/route.ts` (and the create route `app/api/admin/models/route.ts` if it sets slugs)

- [ ] **Step 1 — resolve errors are loud:** In `resolvePrimaryProvider`, destructure `{ data, error }`. If `error` and the message matches the missing-table signature (`/does not exist|could not find|schema cache/i`) → keep the silent legacy fallback (pre-migration grace, with a one-time `console.warn`). ANY other error → `throw` (a transient DB blip must fail the run retryably, not silently switch providers mid-fan-out). Add `.order('id', { ascending: true })` after the priority order as a deterministic tiebreaker.
- [ ] **Step 2 — admin edits reach the binding table:** In the admin model update route, after a successful `ai_models` update that changed `replicate_model_id` (or `provider_model_id` for adapter-keyed providers), upsert the matching `ai_model_providers` row: `onConflict: 'model_id,provider_id'`, setting only `provider_model_id` (do NOT touch priority/is_active of an existing row; new rows get priority 0, is_active true). Determine the provider key the same way the 20260612 backfill does (replicate slug → `'replicate'`; else the model's provider's `adapter_key`). Swallow ONLY the missing-table error (pre-migration grace). Use the route's existing session client (the table has an `is_admin()` RLS policy). Do the equivalent insert in the model-create route.
- [ ] **Step 3:** `npx tsc --noEmit` → clean. Commit: `fix(providers): loud resolve errors + admin slug edits mirror into ai_model_providers`

### Task 9: Docs + policy decisions on record

**Files:**
- Modify: `docs/superpowers/specs/2026-06-11-multi-provider-generation-failover-design.md`
- Modify: `CLAUDE.md` (env list)

- [ ] **Step 1:** Spec edits (concise, in the relevant sections): (a) **Moderation policy (Decision 5)**: replace "immediately terminal" with — moderation errors retry the SAME provider once more (2 attempts total), then surface the error to the user; NEVER cross-provider fallback (lands with Phase C's retry engine; until then terminal-on-first is the interim behavior). (b) **`input_overrides`**: note `{rename, defaults}` is the v1 interpreter; a `valueMap` op (enum/value-shape translation) is planned for Phase C when the first KIE/WaveSpeed binding needs it. (c) **`UNIQUE(model_id, provider_id)`**: record it as a deliberate v1 choice (one binding per provider per model — matches the admin dropdown UX); relax only if same-provider-different-slug fallback is ever wanted. (d) **FAL webhook**: promote from "optional" to "wire `parseWebhook` early in the adapters phase" (sweep-only completion costs ~2-3.5 min latency on fast models); KIE remains webhook-primary (10-min TTL). (e) **Phase C pre-task**: extract the duplicated fan-out completion sequence (webhook + sweep) into a shared `completePredictionJob()` before building the failover chain.
- [ ] **Step 2:** `CLAUDE.md` required-env paragraph: add `FAL_KEY` (server-only; required for FAL-bound models; auth header `Authorization: Key <key>`).
- [ ] **Step 3:** Commit: `docs: moderation retry policy, override/unique decisions, FAL webhook promotion, FAL_KEY env`
