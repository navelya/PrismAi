# Multi-Provider Generation with Failover — Design

**Date:** 2026-06-11
**Branch:** dev
**Status:** Design approved, pending implementation plan

## 1. Problem & Goal

Today all AI generation runs through Replicate (plus a single sync adapter for ElevenLabs speech). We want to add four more "Replicate-like" generation providers — **FAL, KIE, Kinovi, WaveSpeed** — so that:

1. A model can be served by a **primary provider** with an **ordered list of fallbacks**.
2. **Fallback fires only when needed** — on a transient/capacity error or a provider outage — moving the job to the next provider automatically.
3. Adding/configuring models in the admin works across providers, with **schema auto-fill from any provider that exposes one** and **full manual editing** when none does.
4. The whole result/live-update pipeline stays **server-authoritative** (it already is) and **self-healing** against missed completion events.

**OpenRouter** was investigated and is **explicitly out of scope for v1** (see §8) — it is an LLM-first router with no per-model input schema, base64 image output, sync-except-video delivery, and its own built-in routing; it does not fit the dynamic-schema media node.

## 2. Current Architecture (verified)

- **Dispatch:** `lib/nodes/plugins/ai_generator/executor.server.ts` builds an input payload (`replicateInputs`, keyed by `api_mapping_key`) from the model's `inputs_schema` (controls + handles), then either calls `replicate.run()` (local sync) or `replicate.predictions.create()` with a webhook URL (prod async). Fan-out (iterations > 1) dispatches N predictions concurrently via `Promise.allSettled` in `lib/workflow/dispatch-v2.ts`.
- **Completion:** `app/api/webhooks/replicate-v2/route.ts` verifies a Standard-Webhooks signature, reads Replicate's status enum (`succeeded`/`failed`/`canceled`), normalizes output, mirrors media to Supabase storage via `lib/workflow/media-mirror.ts` (rejecting any leftover `replicate.delivery` URL), writes `node_results` (or per-iteration `node_predictions` + `finalize_fan_out` RPC), and dispatches children.
- **Live updates:** Client subscribes to Supabase Realtime on `node_results` / `node_predictions` (`lib/hooks/use-execution-channel.ts`), with hydrate-on-subscribe and a focus/`reconcileExecutionFromDb` fallback. **This path is already provider-agnostic — Replicate is never in it.**
- **Provider adapters:** `lib/ai/providers/` defines a `ProviderAdapter` interface (`key`, `mode: 'sync' | 'async-webhook'`, `execute()`) selected by `providers.adapter_key`. Only the **sync** path is truly implemented (ElevenLabs); the async path is the hardcoded Replicate path, not behind the adapter.
- **Billing:** `/api/executions/start` runs a cost pre-flight (`computeExecutionCost`) and debits via `debit_tokens` (idempotent on `exec:{id}`); terminal failures refund via `refund_tokens`; per-iteration fan-out failures refund via `refundFailedIteration`.
- **Model config:** Admin `components/admin/ModelForm.tsx` fetches a Replicate model's schema from `GET /api/replicate/schema`, parses it (`lib/utils/schema-parser.ts`) into `inputs_schema`/`outputs_schema`, and lets the admin edit controls/handles manually. Stored in `ai_models` (one row = one model). `providers` table holds `id, name, logo_url, adapter_key`.

### What's Replicate-coupled (the work)
Hardcoded status strings (`succeeded`/`failed`/`canceled`), the `replicate.delivery` domain check, the Standard-Webhooks signature scheme, `replicate.predictions.create`/`replicate.run`, `node_results.replicate_id` / `node_predictions.replicate_id`, and the Replicate-only schema-fetch route.

## 3. Provider Research Summary (current as of 2026-06)

| Provider | Delivery | Auth | Webhook sig | Schema auto-fetch | Media | Moderation signal |
|---|---|---|---|---|---|---|
| **Replicate** (today) | webhook (+ local sync) | `Token` | Standard Webhooks HMAC | ✅ `openapi_schema` | ephemeral → mirror | n/a |
| **FAL** | queue: webhook **or** poll | `Key <k>` | ED25519 / JWKS | ✅ `?expand=openapi-3.0` | ephemeral → mirror | 422 `content_policy_violation` |
| **WaveSpeed** | webhook **or** poll | `Bearer` | Svix HMAC | ✅ `api_schema` | ephemeral → mirror | code `1200` |
| **KIE** | callback **or** poll | `Bearer` | HMAC-SHA256 | ❌ hand-author | ephemeral (~10 min!) → mirror | 400 "flagged" |
| **Kinovi** | callback **or** poll | `Bearer` | ❌ none | ❌ hand-author | mirror (TTL unknown) | undocumented (inspect `error.code`) |

**Common shape:** all four async providers are `submit → get task id → (webhook or poll) → ephemeral media URLs that must be mirrored`. This is structurally identical to Replicate's async path.

**Transient/capacity signals** (→ failover): FAL 429/503/504 (+ `X-Fal-Retryable`); WaveSpeed HTTP 429 / app `5xxx`; KIE 429/455/500/501; Kinovi 429/5xx. **Validation** (→ terminal): 422/400 param errors. **Moderation** (→ terminal, no retry/fallover): per the table above.

**Flagged "verify against live API" items** (Phase A includes a per-provider live probe before trusting these): FAL `X-Fal-Retryable` exact value; WaveSpeed webhook-attachment method (query vs body) and exact poll path (use returned `urls.get`); KIE per-family callback payload shapes and whether a model-list/schema endpoint exists behind the gated market UI; Kinovi result-URL TTL and the moderation-vs-failure `error.code` taxonomy. **Kinovi spelling** ("KNOVI") is assumed to mean kinovi.ai (~85% confidence) — confirm before building that adapter; Novita AI is the secondary candidate.

## 4. Key Decisions (locked)

1. **Data model:** one `ai_models` row keeps **one shared `inputs_schema`**; provider bindings live in a new ordered child table. (§5.2)
2. **Completion model:** **polling is the source of truth**; provider webhooks are an **optional, unverified "nudge"** that just triggers an authoritative re-poll; **cron is the reliable backstop**. (§5.1)
3. **Moderation blocks are terminal** — no retry, no fallover; surface "content rejected" + refund.
4. **Load-balancing is failover-only in v1** — no proactive weighted spreading.
5. **Credit price is fixed per model** — failover is transparent to billing; provider cost differences are margin only.
6. **Packaged as one architecture spec, built in phases A → B → C**, each independently shippable.

## 5. Target Architecture

### 5.1 Completion model: poll-as-truth + webhook-nudge + cron backstop

The crux of the async design. We do **not** choose between webhooks and polling.

- **`adapter.poll(providerJobId)` is the only thing that writes a result.** One uniform completion pipeline for all providers: `normalize outputs → mirrorMediaToStorage → write node_results/node_predictions → dispatch children`. This reuses the existing completion code, just triggered from a provider-agnostic place instead of the Replicate webhook route.
- **Webhook = unverified doorbell.** Providers that support webhooks (FAL/WaveSpeed/KIE) POST a single generic route (e.g. `/api/providers/nudge`) that carries enough to identify the job (`provider_job_id`). The route does **not** verify the signature and does **not** trust the body — it simply enqueues/triggers `adapter.poll()` for that job, which re-fetches the authoritative status with **our** API key. A forged nudge can only cause an early harmless poll. This eliminates the need to implement 4 different signature-verification schemes.
- **Cron sweep = backstop.** A cron job (using existing `CRON_SECRET` infra) periodically polls all jobs still in `pending` past a small delay. This makes the system **self-healing**: any job stranded by a missed webhook, a cold start, a poisoned realtime channel, or a provider without webhooks (Kinovi) is reconciled on the next sweep. Directly addresses the missed-`completed` / channel-poisoning bug class noted in project history.
- **Latency:** the nudge gives near-webhook latency where available; cron (≈1/min) only catches stragglers. Because media jobs take ~10s–2min, worst-case (nudge missed, cron catches) relative latency is small. **The system is fully correct on cron + poll alone**; webhook nudges are a pure latency optimization that can land per-provider after v1.

### 5.2 Data model

- **`ai_models`** — unchanged single shared `inputs_schema` / `outputs_schema`. `replicate_model_id` retained for back-compat but superseded by the binding table below. Single fixed `credit_cost` (decision §4.5).
- **New `ai_model_providers`** child table:
  - `id` (PK)
  - `model_id` (FK → ai_models)
  - `provider_id` (FK → providers)
  - `provider_model_id` TEXT — the per-provider model slug/key (e.g. Replicate `owner/name:version`, FAL `fal-ai/flux/dev`, WaveSpeed `wavespeed-ai/flux-dev`, KIE `<family>/<task>`, Kinovi `seedance-20`)
  - `priority` INT — `0` = main, ascending = fallback order
  - `is_active` BOOL
  - constraints: unique `(model_id, provider_id)`; ordered by `priority`
- **Migration backfill:** every existing `ai_models` row with a `replicate_model_id` gets one `ai_model_providers` row `(provider = replicate, provider_model_id = replicate_model_id, priority = 0, is_active = true)`. Everything keeps working on day one.
- **`node_results` / `node_predictions`:** rename/generalize `replicate_id` → add `provider_id` + `provider_job_id`. Store the **final serving provider** on `node_results` for observability. (Keep `replicate_id` as a back-compat alias during migration, then drop.)
- The shared `inputs_schema` means `api_mapping_key` names **must line up across a model's providers** — this is the admin's manual curation responsibility; the admin UI shows bindings side-by-side to surface mismatches (§5.4).

### 5.3 Provider adapter interface (generalized)

Extend `lib/ai/providers/` so **every** provider — including Replicate — is an adapter implementing one contract:

```
interface ProviderAdapter {
  key: string                       // matches providers.adapter_key
  mode: 'sync' | 'async'
  submit(model, inputs, ctx): Promise<{ providerJobId: string, status }>
  poll(providerJobId): Promise<{ status: 'pending'|'completed'|'failed', outputs?, error? }>
  classifyError(httpStatus: number, body: unknown): ErrorClass
  fetchSchema?(modelSlug: string): Promise<InputsSchema>   // optional auto-fill
  parseNudge?(req): { providerJobId: string } | null       // optional, identify-only
}

type ErrorClass = 'transient' | 'validation' | 'moderation'
```

- **Replicate** is refactored into a `ReplicateAdapter` (the hardcoded paths in `executor.server.ts` and `replicate-v2/route.ts` move behind it). For Replicate, `poll()` wraps `replicate.predictions.get()`; the existing webhook route is retained but reduced to a nudge (or kept verifying, since it already works) — either way it routes into the same poll-driven completion pipeline.
- **ElevenLabs** stays `mode: 'sync'` (returns bytes in-request; no job id, no poll).
- **FAL / WaveSpeed / KIE / Kinovi** are new `mode: 'async'` adapters. Per-provider base URL, auth header, status-string mapping, output-shape normalization, and `classifyError` live inside each adapter. The orchestrator only ever sees normalized `status` + `ErrorClass`.
- The input payload built in `executor.server.ts` (`api_mapping_key`-keyed) is provider-agnostic and passed unchanged to `adapter.submit()`.

### 5.4 Admin model config (Phase B)

- **New "Providers" section in `ModelForm.tsx`:** choose the main provider + add ordered fallbacks. Each binding row = provider dropdown + `provider_model_id` field + drag-reorder + active toggle. All bindings shown side-by-side so `api_mapping_key` mismatches are visible.
- **Multi-source schema fetch:** a "Fetch schema from [provider ▾]" control calls a generic `GET /api/providers/[key]/schema?model=<slug>` that dispatches to `adapter.fetchSchema()`. Works for Replicate/FAL/WaveSpeed; disabled (with a "manual entry" hint) for KIE/Kinovi. Result fills the single shared `inputs_schema`/`outputs_schema`.
- **Manual editing** of inputs/outputs/properties is unchanged and always available (for KIE/Kinovi or any unsupported model).
- **Admin write routes** touching the new table must use the RLS-scoped session client and add `public.is_admin()` policies (per project convention), not the service client.

### 5.5 Fallback orchestration (Phase C)

- **Per-attempt chain.** Dispatching an `ai_generator` node (and each fan-out iteration independently) resolves the model's ordered active providers and attempts `provider[0]`. The job row carries `provider_id` + `attempt`.
- **On a failure event** (from `poll()`/nudge), `adapter.classifyError` yields:
  - **`transient`** → re-dispatch to the **next active provider** (new `provider_job_id`, node stays `running`). If providers exhausted → retry the main provider up to **N = 1** extra time, then terminal.
  - **`validation`** → terminal: refund, surface the error.
  - **`moderation`** → terminal: refund, surface "content rejected" (no retry, no fallover).
- **Failover is transparent to billing.** Credit cost is fixed and debited upfront; only a *terminal* failure refunds (existing `refund_tokens` / `refundFailedIteration` paths, unchanged). The final serving provider is recorded on `node_results`.
- **Fan-out:** each iteration runs its own independent attempt chain; `node_predictions` rows gain `provider_id` + `attempt`. `finalize_fan_out` is unchanged (it aggregates on terminal status regardless of which provider served each iteration).

## 6. Data Flow (target, async provider)

```
Run node
  → executor builds api_mapping_key-keyed inputs
  → resolve ordered providers for model
  → adapter[0].submit() → { provider_job_id }
  → write node_results/predictions { provider_id, provider_job_id, attempt, status: pending }
  → node shows 'running'

Completion (whichever fires first):
  (nudge)  provider webhook → /api/providers/nudge → trigger poll(job)
  (cron)   sweep pending jobs → poll(job)
  → adapter.poll() authoritative status (our API key)
     ├─ completed → normalize → mirrorMediaToStorage → write result → dispatch children → realtime → UI
     └─ failed → classifyError →
          ├─ transient  → next provider (or retry main ≤N) → submit() again
          ├─ validation → terminal: refund + surface
          └─ moderation → terminal: refund + "content rejected"
```

## 7. Phasing

- **Phase A — Generalize the engine.** Adapter interface (`submit`/`poll`/`classifyError`); refactor Replicate behind it; build the poll-driven completion pipeline + cron backstop + generic nudge route; generalize `provider_id`/`provider_job_id` on result tables. Ship with Replicate-only still working through the new path (regression-safe). Includes a per-provider live-probe harness for the flagged-unconfirmed facts (§3).
- **Phase B — Multi-provider model config.** `ai_model_providers` table + backfill migration; ModelForm "Providers" section; generic multi-source schema-fetch route; FAL/WaveSpeed/KIE/Kinovi adapters' `submit`/`poll`/`classifyError`/`fetchSchema`. Models become runnable on a single chosen provider.
- **Phase C — Fallback orchestration.** Per-attempt chain, error-class-driven failover, terminal handling, observability of serving provider. Fan-out attempt chains.

Each phase is independently shippable and leaves the app working.

## 8. Out of Scope (v1) / Future

- **OpenRouter** — LLM-first router; no rich per-model input schema; base64 image output; sync-except-video; its own built-in provider routing. Revisit as a separate **text/LLM lane**, not a media-gen node.
- **Proactive load-balancing** (weighted spreading before failure) — needs per-provider capacity telemetry; deferred.
- **Per-provider credit pricing** — credit price is fixed per model in v1.
- **Strict webhook signature verification** — not required given the poll-as-truth + nudge model; may be added per-provider later as defense-in-depth.

## 9. Risks & Mitigations

- **Poll latency on serverless** → webhook-nudge gives fast path; cron is only the backstop; media jobs are long enough that worst-case relative latency is small.
- **`api_mapping_key` drift across a model's providers** → admin shows bindings side-by-side; the engine sends the same payload to each, so curation is the control point.
- **Unconfirmed provider facts** (§3) → Phase A live-probe harness verifies each before the adapter is trusted in production.
- **Kinovi identity/spelling** → confirm kinovi.ai vs Novita before building that adapter.
- **Cron cost / volume** → sweep only targets jobs `pending` past a short threshold; nudges keep most jobs from ever needing a sweep.

## 10. Open Items to Confirm During Implementation
- Exact cron frequency / max in-flight poll batch size.
- Whether Replicate's existing verified webhook is kept as-is (it works) or downgraded to a nudge for uniformity.
- Kinovi platform confirmation (kinovi.ai vs Novita AI).
- Final disposition of `replicate_id` columns (alias-then-drop timeline).
