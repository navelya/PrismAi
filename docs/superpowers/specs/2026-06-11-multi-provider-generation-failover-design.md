# Multi-Provider Generation with Failover — Design

**Date:** 2026-06-11
**Branch:** dev
**Status:** Design approved (revised after 3-agent design-panel review), pending implementation plan

## 1. Problem & Goal

Today all AI generation runs through Replicate (plus a single sync adapter for ElevenLabs speech). We want to add four more "Replicate-like" generation providers — **FAL, KIE, Kinovi, WaveSpeed** — so that:

1. A model can be served by a **primary provider** with an **ordered list of fallbacks**.
2. **Fallback fires only when needed** — on a transient/capacity error or a provider outage — moving the job to the next provider automatically.
3. Adding/configuring models in the admin works across providers, with **schema auto-fill from any provider that exposes one** and **full manual editing** when none does.
4. The whole result/live-update pipeline stays **server-authoritative** (it already is) and becomes **self-healing** against missed completion events (which currently strand jobs on "loading").

**OpenRouter** was investigated and is **explicitly out of scope for v1** (see §9) — it is an LLM-first router with no per-model input schema, base64 image output, sync-except-video delivery, and its own built-in routing; it does not fit the dynamic-schema media node.

## 2. Current Architecture (verified from code)

- **Dispatch:** `lib/nodes/plugins/ai_generator/executor.server.ts` builds an input payload (`replicateInputs`, keyed by `api_mapping_key`) from the model's `inputs_schema`, then either calls `replicate.run()` (local sync) or `replicate.predictions.create({ webhook })` (prod async). Fan-out (iterations > 1) dispatches N predictions concurrently via `Promise.allSettled` in `lib/workflow/dispatch-v2.ts`.
- **Completion (prod is webhook-only):** `app/api/webhooks/replicate-v2/route.ts` verifies a Standard-Webhooks signature, reads Replicate's status enum (`succeeded`/`failed`/`canceled`), normalizes output, mirrors media to Supabase storage via `lib/workflow/media-mirror.ts` (rejecting any leftover `replicate.delivery` URL), writes `node_results` (single) or per-iteration `node_predictions` + the `finalize_fan_out` RPC (fan-out), and dispatches children.
- **No server-side completion polling exists today.** The only cron, `app/api/cron/reconcile`, is a **nightly credits** reconciler (refund stuck failed executions + balance-drift audit) — it does not poll providers. **A missed webhook strands a job on "loading" until manual refresh** — this has happened in prod (see project memory: realtime channel poisoning, missed `completed`).
- **Live updates (already provider-agnostic):** client subscribes to Supabase Realtime on `node_results`/`node_predictions` (`lib/hooks/use-execution-channel.ts`), with hydrate-on-subscribe + a focus `reconcileExecutionFromDb`. Replicate is never in this path.
- **Provider adapters:** `lib/ai/providers/` has a `ProviderAdapter` interface (`key`, `mode`, `execute()`) selected by `providers.adapter_key`. Only the **sync** path (ElevenLabs) is implemented; the async path is the hardcoded Replicate path, not behind the adapter.
- **Billing:** `/api/executions/start` debits via `debit_tokens` (idempotent on `exec:{id}`); terminal failures refund via `refund_tokens` (idempotent on execution id); per-iteration fan-out failures refund via `refundFailedIteration`.

### Concurrency invariant the current code silently relies on
The **single-node** completion path does a plain `upsert` then an **unconditional** `checkAndDispatchChildren` — it has **no atomic "claim the running→completed transition" guard.** It is correct today only because there is exactly **one** completion trigger per job (one webhook). The **fan-out** path is different: `finalize_fan_out` (migration `20260608`) does `SELECT ... FOR UPDATE`, bails if status is no longer `running`, and only the winning caller dispatches children. **This design adds multiple concurrent triggers (webhook + cron), which breaks the single-node assumption — see §5.1/§6.**

### What's Replicate-coupled (the work)
Hardcoded status strings, the `replicate.delivery` domain check, `replicate.predictions.create`/`run`, `node_results.replicate_id` / `node_predictions.replicate_id`, the Replicate-only schema-fetch route, and the completion logic welded inside the webhook handler.

## 3. Provider Research Summary (current as of 2026-06)

| Provider | Delivery | Auth | Webhook sig | Schema auto-fetch | Media | Moderation signal |
|---|---|---|---|---|---|---|
| **Replicate** (today) | webhook (+ local sync) | `Token` | Standard Webhooks HMAC | ✅ `openapi_schema` | ephemeral → mirror | n/a |
| **FAL** | queue: webhook **or** poll | `Key <k>` | ED25519 / JWKS | ✅ `?expand=openapi-3.0` | ephemeral → mirror | 422 `content_policy_violation` |
| **WaveSpeed** | webhook **or** poll | `Bearer` | Svix HMAC (= `standardwebhooks`) | ✅ `api_schema` | ephemeral → mirror | code `1200` |
| **KIE** | callback **or** poll | `Bearer` | HMAC-SHA256 | ❌ hand-author | ephemeral **~10 min TTL** → mirror fast | 400 "flagged" |
| **Kinovi** | callback **or** poll | `Bearer` | ❌ none | ❌ hand-author | mirror (TTL unknown) | undocumented (inspect `error.code`) |

**Common shape:** all four async providers are `submit → get task id → (webhook or poll) → ephemeral media URLs that must be mirrored`. Structurally identical to Replicate's async path. **All four expose a poll/status GET**, which is the precondition that makes the completion model in §5.1 viable.

**Error signals** (feed `classifyError`): transient/capacity (→ failover): FAL 429/503/504 (+ `X-Fal-Retryable`); WaveSpeed HTTP 429 / app `5xxx`; KIE 429/455/500/501; Kinovi 429/5xx. Validation (→ terminal): 422/400 param errors. Moderation (→ terminal): per table above.

**Flagged "verify against live API"** (Phase A gating live-probe per provider): FAL `X-Fal-Retryable` value; WaveSpeed webhook-attachment (query vs body) + exact poll path (use returned `urls.get`); KIE per-family callback payloads + whether a model-list/schema endpoint exists; Kinovi result-URL TTL + the moderation-vs-failure `error.code` taxonomy. **"KNOVI" is confirmed = kinovi.ai** (base `https://kinovi.ai/api/v1`, Bearer auth, `createTask`/`recordInfo` poll, optional unsigned callback, schema via the `x-kinovi-public-models` block in `openapi.json`).

## 4. Key Decisions (locked, incl. panel revisions)

1. **Data model:** one `ai_models` row with **one shared `inputs_schema`**; provider bindings in an ordered child table `ai_model_providers`, with an optional per-binding `input_overrides` for key drift. (§5.2)
2. **Completion model:** **one idempotent completion function**, triggered by a **verified** provider webhook, an **every-minute cron sweep**, or the existing focus-reconcile. `poll()` (or a verified webhook body) supplies authoritative status. **No unauthenticated "nudge" endpoint.** (§5.1) — *revised from the original "unverified nudge" after panel review: verifiers are cheap and verification removes an attack surface rather than adding one.*
3. **Exactly-once is enforced by an atomic claim**, not assumed. A `claim_node_completion` RPC mirroring `finalize_fan_out` gates the single-node result write + child dispatch. (§5.1/§6) — *the panel's #1 must-fix.*
4. **Polling driver = Vercel cron (1/min) backstop.** No external workflow/queue vendor (Inngest/QStash/Trigger.dev) in v1. (§5.1)
5. **Moderation blocks retry the SAME provider once** (2 attempts total), then surface the error — **NEVER cross-provider fallback** (a moderation block follows the prompt, not the provider; hopping providers just re-burns capacity). *Revised from "immediately terminal" — this restores the user's original ask.* The same-provider retry lands with Phase C's retry engine; until then, terminal-on-first-moderation is the interim behavior. Terminal moderation = refund + "content rejected."
6. **Load-balancing is failover-only in v1.** But Phase C records the telemetry (`attempt`, `error_class`, `latency_ms`, serving `provider_id`) that future proactive LB needs. (§5.2/§9)
7. **Credit price is fixed per model** — failover is transparent to billing.
8. **Packaged as one architecture spec, built A → B → C**, with Phase A front-loaded to fix the prod missed-webhook bug on Replicate before any new provider. (§7)
9. **Sync and async adapters are separate interfaces** — no dead `poll()` on the sync (ElevenLabs) path. (§5.3)

## 5. Target Architecture

### 5.1 Completion model: one idempotent writer, three triggers, cron backstop

The crux of the async design.

- **One completion function — `completeJob(executionId, nodeId, providerId, providerJobId[, predictionIndex])`** — is the single place that normalizes output → mirrors media → writes the result → dispatches children. The existing ~300 lines of completion logic inside `replicate-v2/route.ts` are extracted into this provider-agnostic function and reused.
- **Authoritative status comes from `adapter.poll(providerJobId)`** (an authenticated GET with our key) — or, where cheap and verified, the webhook body. Defaulting to poll keeps one testable code path (`poll` is a pure function of job id → status; no signature fixtures in tests).
- **Three triggers, all funnelling into `completeJob`:**
  1. **Verified provider webhook** → a per-provider route (or one route that dispatches by `adapter.parseWebhook`) verifies the signature (cheap: WaveSpeed = `standardwebhooks`; KIE = HMAC-SHA256; FAL = ED25519/JWKS; Kinovi = none, so poll-only) and calls `completeJob`. Fast path.
  2. **Every-minute cron sweep** (`/api/cron/sweep-pending`, `* * * * *`) → reliable backstop. Self-heals any job stranded by a missed webhook, cold start, or a provider with no webhook (Kinovi).
  3. **Existing client focus-reconcile** (unchanged) → reads DB; benefits automatically once the backstop keeps the DB fresh.
- **Idempotency is enforced, not assumed (§6).** `completeJob` first calls a `claim_node_completion` RPC (`SELECT ... FOR UPDATE`, bail unless status is still `running`/`pending`, transition to terminal, return whether this caller won). **Only the winner mirrors media and dispatches children.** This mirrors `finalize_fan_out` and closes the single-node double-dispatch gap that multiple triggers would otherwise open. Insert-only/`ignoreDuplicates` discipline (a fast completion landing before the dispatch row write) is preserved for the single-node path too.
- **Cron sweep is itself concurrency-safe:** selects `status IN ('pending','running') AND last_polled_at < now() - Δ` ordered oldest-first, claims rows with `FOR UPDATE SKIP LOCKED` (or a `last_polled_at` watermark), caps batch size (launch blocker, not an open item), and polls with bounded concurrency. **Per-job backoff** — a 5-second-old job is not polled every minute; poll on an increasing schedule so most jobs complete via webhook before the sweep touches them.
- **Pending-job deadline:** a job `pending` past a max age (e.g. 15 min) with no terminal poll → marked terminal-failed, refunded, optionally failed over. Prevents a submitted-but-never-terminating job from being swept forever and never refunding.
- **Latency:** verified webhooks give the fast path; cron only catches stragglers. For 10s–2min media jobs the worst case (missed webhook → cron catches within ~1 min) is fine — **except KIE's ~10-min media TTL**, so KIE uses webhook-primary + a short (~60–90s) stale threshold so the URL doesn't expire before mirroring. **The system is fully correct on cron + poll alone**; webhooks are a latency optimization — but not an optional one for FAL: sweep-only completion costs ~2–3.5 min of latency on fast models in prod, so **wire FAL's `parseWebhook` early in the adapters phase**, not "later if needed." KIE remains webhook-primary regardless (10-min result TTL).

### 5.2 Data model

- **`ai_models`** — unchanged single shared `inputs_schema`/`outputs_schema`. `replicate_model_id` retained transitionally (see migration note). Single fixed `credit_cost`.
- **New `ai_model_providers`** child table:
  - `id` (PK), `model_id` (FK → ai_models), `provider_id` (FK → providers)
  - `provider_model_id` TEXT — per-provider model slug (Replicate `owner/name:version`, FAL `fal-ai/flux/dev`, WaveSpeed `wavespeed-ai/flux-dev`, KIE `<family>/<task>`, Kinovi `seedance-20`)
  - `priority` INT — `0` = main, ascending = fallback order
  - `is_active` BOOL
  - **`input_overrides` JSONB (nullable)** — optional per-provider `api_mapping_key` remap/defaults. Unused for curated v1 models (whose keys are made to align), but the column exists so a provider whose input contract differs (e.g. FAL `image_url` vs WaveSpeed `image`) never forces a schema fork. Without it, a key mismatch surfaces as a 422 **at failover time** — exactly when the fallback must work. **v1 interpreter is `{rename, defaults}` only**; a `valueMap` op (enum/value-shape translation, e.g. `aspect_ratio: "16:9"` vs `image_size: "landscape_16_9"`) is planned for Phase C when the first KIE/WaveSpeed binding needs it — until then curators align values across v1 bindings.
  - constraints: unique `(model_id, provider_id)`; ordered by `priority`. **Deliberate v1 choice:** one binding per provider per model — matches the admin's per-provider dropdown UX. Relax only if same-provider-different-slug fallback (e.g. two FAL slugs for one model) is ever wanted.
- **Migration backfill:** every existing `ai_models` row with `replicate_model_id` → one `ai_model_providers` row `(provider = replicate, provider_model_id = replicate_model_id, priority = 0, is_active = true)`. Everything works on day one.
- **`node_results` / `node_predictions`:** add `provider_id`, `provider_job_id`, `attempt`, `last_polled_at`. Record the **final serving `provider_id`**, plus (Phase C) `error_class` and `latency_ms`. `replicate_id` is aliased then dropped on a **hard-scheduled** Phase A migration (not left as a fossil column every new provider awkwardly writes its job id into).
- **Failover snapshot:** at first dispatch, the resolved ordered active-provider list is frozen onto the job row (matching the codebase's "immutable snapshot per execution" invariant — like `character` snapshots and immutable `graph_json`). Failover walks the snapshot, not live config (§5.5).

### 5.3 Provider adapters (two interfaces, not one)

Keep the existing `mode: 'sync'` adapter (ElevenLabs) as-is and add a separate async interface — branch on `mode` once in the dispatcher. This avoids dead `poll()`/`submit()` branches on the sync path.

```
// unchanged
interface SyncProviderAdapter {
  key; mode: 'sync';
  execute(args): Promise<NodeExecutionResult>   // returns hosted { url } in-request
}

// new
interface AsyncProviderAdapter {
  key; mode: 'async';
  submit(model, inputs, ctx, { webhookUrl? }): Promise<{ providerJobId, status }>
  poll(providerJobId): Promise<{ status: 'pending'|'completed'|'failed', outputs?, error? }>
  classifyError(op: 'submit'|'poll', httpStatus, body): ErrorClass
  fetchSchema?(modelSlug): Promise<InputsSchema>      // FAL/WaveSpeed/Replicate
  parseWebhook?(req): { providerJobId } | null        // identify the job from a verified webhook
}

type ErrorClass = 'transient' | 'validation' | 'moderation'
```

- **`classifyError` takes the operation** (`submit` vs `poll`). A `429` on *our poll* is **not** a generation failure — it means "back off and re-poll." Treating poll-429 as `transient → failover` would let a poll storm cascade everyone onto the fallback provider (self-inflicted outage). Only `submit`/generation errors drive failover.
- **Mirroring is owned by the completion pipeline, not adapters.** `poll()` returns **raw provider output URLs**; `completeJob` does `resolveNodeOutputWireType → mirrorMediaToStorage → write`. The sync ElevenLabs path (which uploads bytes itself) is the one documented exception. `media-mirror.ts` gets **one entry point that accepts bytes-or-URL** to avoid a third divergent mirror path.
- **Replicate** is refactored into a `ReplicateAsyncAdapter` (its `poll()` wraps `replicate.predictions.get()`); its existing **verified** webhook stays and simply calls `completeJob` — not re-plumbed "for uniformity."
- **Precondition:** an `async` adapter MUST implement `poll()`. A hypothetical future provider that only pushes results in an unverifiable webhook body with no status GET cannot use this pipeline unchanged — documented as a hard precondition. All v1 providers satisfy it.

### 5.4 Admin model config (Phase B)

- **New "Providers" section in `ModelForm.tsx`:** choose the main provider + ordered fallbacks; each binding row = provider dropdown + `provider_model_id` field + drag-reorder + active toggle + (advanced) `input_overrides`. Bindings shown side-by-side so `api_mapping_key` mismatches are visible.
- **Multi-source schema fetch:** "Fetch schema from [provider ▾]" → generic `GET /api/providers/[key]/schema?model=<slug>` dispatching to `adapter.fetchSchema()`. Works for Replicate/FAL/WaveSpeed; disabled (manual-entry hint) for KIE/Kinovi. Fills the single shared schema.
- **Manual editing** of inputs/outputs/properties unchanged and always available.
- **Admin write routes** touching the new table use the RLS-scoped session client + `public.is_admin()` policies (project convention), not the service client.

### 5.5 Fallback orchestration (Phase C)

- **Per-attempt chain over the frozen snapshot.** Dispatch attempts `snapshot[0]`; the job row carries `provider_id` + `attempt`. Each fan-out iteration runs its own independent chain (`node_predictions` rows carry `provider_id` + `attempt`).
- **Failover advancement is an atomic CAS** ("advance `attempt` N→N+1 only if still N, return whether I won"); only the winner submits to the next provider. Prevents two concurrent failure observations from double-dispatching the next provider.
- **On a failure event, `adapter.classifyError('poll'|'submit', …)` yields:**
  - **`transient`** (from submit/generation, not poll) → CAS-advance to the **next snapshot provider**; node stays `running`. If the snapshot is exhausted → terminal. *(No "retry the main provider N extra times" — cut as gold-plating; revisit only if telemetry shows value.)*
  - **`validation`** → terminal: refund, surface.
  - **`moderation`** → retry the **same** provider once (2 attempts total); if blocked again → terminal: refund, surface "content rejected." Never advances the snapshot (Decision 5). Interim (pre-Phase C): terminal on first block.
- **Billing transparent to failover:** fixed credit, debited upfront; only *terminal* failure refunds via the existing idempotent `refund_tokens` / `refundFailedIteration`. Verify `refundFailedIteration` is idempotent per `(execution, prediction_index)` so a terminal event observed twice can't double-refund.
- **submit() partial failure** (provider enqueued the job but the call timed out before returning a `providerJobId`): treat as `transient → failover`; the §6 completion claim guarantees only one attempt's result is ever written, and the fixed-price model keeps billing correct. Documented, not silently undefined.
- **Telemetry:** record serving `provider_id`, `attempt`, `error_class`, `latency_ms` on the result row — this is the exact signal future proactive load-balancing needs, captured for free.

## 6. Concurrency control & idempotency (the load-bearing layer)

This is what makes "multiple triggers into one writer" safe. Modeled on the existing `finalize_fan_out` claim.

- **`claim_node_completion(execution_id, node_id[, prediction_index])`** — `SELECT status FOR UPDATE`; if already terminal, return `won=false`; else transition `running/pending → completed|failed` and return `won=true`. `completeJob` mirrors media + writes result + dispatches children **only when `won`**.
- **Child dispatch is itself guarded:** `dispatchNode` no-ops if a non-`pending` row already exists for the child, so a double `checkAndDispatchChildren` can't double-run a child.
- **Failover CAS** (§5.5) guards attempt advancement.
- **Cron sweep claims rows** (`FOR UPDATE SKIP LOCKED` / `last_polled_at` watermark) so overlapping sweeps don't poll the same job.
- **Insert-only discipline** preserved for single-node (as fan-out already does with `ignoreDuplicates`): a fast completion landing before the dispatch row write must not be clobbered back to `running`.

## 7. Phasing

- **Phase A — Engine + backstop (fixes the prod bug first, zero new providers).**
  1. Extract completion logic into provider-agnostic `completeJob`; add `claim_node_completion` (close the single-node double-dispatch gap).
  2. Replicate's verified webhook calls `completeJob` (behavior-preserving).
  3. Add `provider_id`/`provider_job_id`/`attempt`/`last_polled_at`; alias + **hard-schedule drop** of `replicate_id`.
  4. Add the **1/min `/api/cron/sweep-pending`** polling Replicate for stale-pending jobs. **This alone fixes the missed-webhook hang for the existing Replicate path — ship it before any new vendor.**
  5. Split `ProviderAdapter` into sync/async; refactor Replicate into `ReplicateAsyncAdapter`. Includes the gating per-provider live-probe harness.
- **Phase B — Multi-provider config + one provider end-to-end.** `ai_model_providers` table (with `input_overrides`) + backfill; ModelForm "Providers" section; generic multi-source schema-fetch route; **one** new provider fully wired (FAL or WaveSpeed — both have schema-fetch + an easy/Svix verifier) to prove the whole shape before cloning. Models runnable on a single chosen provider.
- **Phase C — Failover + remaining providers.** **Pre-task:** extract the duplicated fan-out completion sequence (webhook route + sweep both repeat the mirror → prediction write → refund-on-fail → finalize steps) into a shared `completePredictionJob()` before building the failover chain — the chain must have one completion path to hook into, not two. Then: per-attempt CAS chain, `classifyError`-driven failover, same-provider moderation retry (Decision 5) + terminal moderation/validation handling, refund-on-terminal, telemetry columns; then the remaining three providers (KIE, Kinovi, + the other of FAL/WaveSpeed), each = one adapter file + verifier + live-probe.

Each phase is independently shippable and leaves the app working.

## 8. Data Flow (target, async provider)

```
Run node → executor builds api_mapping_key inputs (+ per-binding input_overrides)
  → resolve ordered active providers → FREEZE snapshot on job row
  → adapter[snapshot[0]].submit(..., { webhookUrl }) → { provider_job_id }
  → insert node_results/predictions { provider_id, provider_job_id, attempt:0, status: pending }  (insert-only)
  → node shows 'running'

Completion — whichever trigger fires (verified webhook | 1/min cron sweep | focus-reconcile):
  → completeJob(execution, node, provider, job)
     → claim_node_completion()  ── won? ──┐
                                          │ no  → stop (someone else handled it)
                                          │ yes ↓
     → adapter.poll() authoritative status
        ├─ completed → normalize raw URLs → mirrorMediaToStorage → write result → dispatch children → realtime → UI
        └─ failed → classifyError(op, status, body)
             ├─ transient(submit/gen) → CAS attempt N→N+1 → submit() next snapshot provider (or terminal if exhausted)
             ├─ transient(poll: 429)  → back off, re-poll (NOT a failover)
             ├─ validation            → terminal: refund + surface
             └─ moderation            → retry SAME provider once, then terminal: refund + "content rejected" (never failover)

Safety nets: pending > max-age → terminal-fail + refund;  nightly credits reconcile (existing) unchanged.
```

## 9. Out of Scope (v1) / Future

- **OpenRouter** — LLM-first; no rich per-model input schema; base64 image output; sync-except-video; own built-in routing. Revisit as a separate **text/LLM lane**, not a media-gen node.
- **Proactive load-balancing** (weighted/adaptive spreading before failure) — needs live capacity signals. v1 ships the **telemetry** (serving provider, attempt, error_class, latency) and the binding table is one `weight` column away from static weighted spreading; adaptive LB later adds a `provider_health` table fed by the same telemetry.
- **Per-provider credit pricing** — fixed per model in v1.
- **Trusting webhook bodies to skip the re-poll** — optional latency optimization, per-provider, after v1.

## 10. Risks & Mitigations

- **Re-plumbing the race-hardened completion code** is the concentrated risk. Mitigation: Phase A runs Replicate-only through the new path (regression-safe), and the `claim_node_completion` claim is built before any concurrent trigger (cron) is enabled.
- **Poll ↔ 429 ↔ failover cascade** → `classifyError` is operation-aware (poll-429 ≠ failover) + per-job poll backoff + sweep batch caps.
- **Cron sweep self-races** → claim rows with `SKIP LOCKED`/watermark.
- **Stranded/never-terminating jobs** → pending-age deadline → terminal-fail + refund.
- **`api_mapping_key` drift across providers** → optional `input_overrides` column; admin shows bindings side-by-side.
- **KIE ~10-min media TTL** → webhook-primary + short stale threshold for KIE.
- **Unconfirmed provider facts (§3)** → Phase A gating live-probe per provider before it's trusted in prod.
- **`replicate_id` fossilization** → hard-scheduled alias-then-drop in Phase A.

## 11. Open Items to Confirm During Implementation
- Exact sweep stale-threshold (Δ), per-job backoff schedule, and max batch size.
- Whether any provider's verified webhook body is trusted directly vs always re-polled (per-provider latency call).
- Pending-job deadline value (e.g. 15 min) per provider.
