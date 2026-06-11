# Phase B (backend) — Multi-Provider Bindings + FAL Adapter + Executor Routing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a model **runnable on a non-Replicate provider** (FAL, proven end-to-end) by adding an ordered `ai_model_providers` binding table and routing the executor through the resolved primary provider's async adapter — Replicate's existing path stays byte-for-byte unchanged.

**Architecture:** A new `ai_model_providers` table binds one `ai_models` row to N providers (ordered by `priority`, shared `inputs_schema`, optional per-binding `input_overrides`). The executor resolves a model's primary active binding; if it's Replicate it uses the **existing untouched path**, if it's a new async provider (FAL) it goes through `getAsyncAdapter(key).submit()` and completes via the Phase A poll-backstop (sweep) in prod or an inline poll loop in local dev. The admin UI for editing bindings is a SEPARATE follow-on plan — Phase B backend is tested via a seed script.

**Tech stack:** Next.js (route handlers, `nodejs` runtime), Supabase (Postgres migrations + service client), the `@fal-ai/*`-style HTTP API via `fetch` (no SDK dependency added), TypeScript.

**Verification:** No unit-test runner in this repo. Verify with `npx tsc --noEmit` (gate: no error referencing a file this plan creates/modifies — the repo has unrelated pre-existing errors that fluctuate; the Phase B file set is disjoint from them) and ad-hoc `node scripts/*.js` against live Supabase + a real FAL key. Scripts use the repo's inline `.env.local` loader, NOT dotenv.

**🔑 API KEY — required before Tasks 4 and 10 (the FAL adapter + E2E):**
Add to `.env.local` AND your deploy env (server-only, NOT `NEXT_PUBLIC`):
```
FAL_KEY=...   # from https://fal.ai/dashboard/keys ; auth header is "Authorization: Key <FAL_KEY>"
```
Nothing reads it until Task 4; the E2E in Task 10 cannot pass without it.

**Builds on Phase A** (committed on `dev`): `AsyncProviderAdapter` interface + `getAsyncAdapter` (`lib/ai/providers/async-registry.ts`), `provider_id`/`provider_job_id` columns, `sweep-pending` poll backstop, `completeJob`. This plan assumes the Phase A migrations are applied (run `node scripts/audit-migrations.js` to confirm).

**Spec:** `docs/superpowers/specs/2026-06-11-multi-provider-generation-failover-design.md` (Phase B = §5.2 data model, §5.3 adapters, §5.4 admin [UI deferred to a separate plan], §7 Phase B). Failover (multiple providers actually failing over) is **Phase C — NOT in this plan**; Phase B only runs the single primary binding.

---

## File Structure

**Create:**
- `supabase/migrations/20260612_ai_model_providers.sql` — binding table + backfill.
- `lib/ai/providers/fal.ts` — `falAsyncAdapter` (submit/poll/classifyError/fetchSchema).
- `lib/workflow/resolve-provider.ts` — resolve a model's primary active binding → `{ providerKey, providerModelId, inputOverrides }`.
- `app/api/providers/[key]/schema/route.ts` — generic schema-fetch dispatching to `adapter.fetchSchema`.
- `scripts/seed-fal-model.js` — create a FAL-backed `ai_models` row + binding for testing.
- `scripts/verify-phase-b-schema.js` — assert the binding table + backfill exist.

**Modify:**
- `lib/nodes/types.ts` — add optional `providerId`/`providerJobId` to `NodeExecutionResult`.
- `lib/ai/providers/async-registry.ts` — register FAL.
- `lib/ai/providers/replicate.ts` — `submit`/`poll` prefer `provider_model_id` over `replicate_model_id`.
- `lib/nodes/plugins/ai_generator/executor.server.ts` — resolve primary binding; route new async providers through submit+poll; Replicate path unchanged.
- `lib/workflow/dispatch-v2.ts` — running write + fan-out rows carry `result.providerId`/`providerJobId` instead of hardcoding `'replicate'`.

**NOT changed:** the Replicate webhook route, `completeJob`, `sweep-pending` (all already provider-agnostic from Phase A and work for FAL as-is once rows carry `provider_id='fal'`).

---

## Task 1: Migration — `ai_model_providers` binding table + backfill

**Files:** Create `supabase/migrations/20260612_ai_model_providers.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Migration: Multi-provider bindings for ai_models (Phase B)
-- Date: 2026-06-12
-- Description:
--   One ai_models row (one shared inputs_schema) can be served by N providers in
--   priority order. priority 0 = primary; ascending = fallback order (failover is
--   Phase C; Phase B uses only the primary). provider_model_id is the per-provider
--   model slug (Replicate "owner/name:ver", FAL "fal-ai/flux/dev", etc).
--   input_overrides optionally remaps/defaults api_mapping_keys for a provider
--   whose input contract differs (unused for curated v1 models; the column exists
--   so a mismatch never forces a schema fork).

CREATE TABLE IF NOT EXISTS public.ai_model_providers (
  id                SERIAL PRIMARY KEY,
  model_id          INTEGER NOT NULL REFERENCES public.ai_models(id) ON DELETE CASCADE,
  provider_id       TEXT NOT NULL,            -- providers.adapter_key, or 'replicate' for the default
  provider_model_id TEXT NOT NULL,            -- per-provider model slug
  priority          INTEGER NOT NULL DEFAULT 0,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  input_overrides   JSONB,                    -- nullable; per-binding api_mapping_key remap/defaults
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (model_id, provider_id)
);

CREATE INDEX IF NOT EXISTS ai_model_providers_model_priority_idx
  ON public.ai_model_providers (model_id, priority);

-- Backfill: every existing model that has a replicate_model_id gets a primary
-- Replicate binding. Models that use a provider adapter (provider_id set, e.g.
-- ElevenLabs) get a primary binding under that provider's adapter_key with the
-- provider_model_id slug. Idempotent via the UNIQUE(model_id, provider_id) +
-- ON CONFLICT DO NOTHING.
INSERT INTO public.ai_model_providers (model_id, provider_id, provider_model_id, priority, is_active)
SELECT m.id, 'replicate', m.replicate_model_id, 0, true
  FROM public.ai_models m
  WHERE m.replicate_model_id IS NOT NULL AND m.replicate_model_id <> ''
ON CONFLICT (model_id, provider_id) DO NOTHING;

INSERT INTO public.ai_model_providers (model_id, provider_id, provider_model_id, priority, is_active)
SELECT m.id, p.adapter_key, COALESCE(m.provider_model_id, ''), 0, true
  FROM public.ai_models m
  JOIN public.providers p ON p.id = m.provider_id
  WHERE p.adapter_key IS NOT NULL AND p.adapter_key <> ''
ON CONFLICT (model_id, provider_id) DO NOTHING;

-- RLS: admin-managed table. Service role bypasses RLS; admin reads via the
-- session client need an is_admin() policy (project convention for /api/admin/*).
ALTER TABLE public.ai_model_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_model_providers admin all"
  ON public.ai_model_providers FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
```

- [ ] **Step 2: Apply to the live DB** via your usual SQL-editor flow. Expected: table created, backfill inserts one row per existing model, no errors (idempotent).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260612_ai_model_providers.sql
git commit -m "feat(db): add ai_model_providers binding table + backfill existing models"
```

---

## Task 2: Verify the binding table

**Files:** Create `scripts/verify-phase-b-schema.js`

- [ ] **Step 1: Write the verifier**

```js
// scripts/verify-phase-b-schema.js
// Verifies the Phase B binding table exists and was backfilled.
// Run: node scripts/verify-phase-b-schema.js
const fs = require('fs');
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const { data, error } = await supabase
    .from('ai_model_providers')
    .select('id, model_id, provider_id, provider_model_id, priority, is_active')
    .limit(5);
  if (error) { console.error('❌ ai_model_providers not found / not selectable:', error.message); process.exit(1); }
  console.log(`✅ ai_model_providers exists; sample rows: ${data.length}`);

  const { count } = await supabase
    .from('ai_model_providers')
    .select('*', { count: 'exact', head: true })
    .eq('provider_id', 'replicate');
  console.log(`✅ replicate bindings backfilled: ${count ?? 0}`);
  process.exit(0);
})();
```

- [ ] **Step 2: Run** `node scripts/verify-phase-b-schema.js` (after Task 1 applied) — expect two ✅ lines.

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-phase-b-schema.js
git commit -m "test(db): add Phase B binding-table verification script"
```

---

## Task 3: Extend `NodeExecutionResult` with provider identity

**Files:** Modify `lib/nodes/types.ts`

- [ ] **Step 1: Add the optional fields**

In `lib/nodes/types.ts`, the `NodeExecutionResult` interface currently ends with the `result_type?` field. Add two optional fields to it:

```typescript
export interface NodeExecutionResult {
    success: boolean;
    data: any;
    error?: string;
    status?: 'success' | 'pending' | 'error';
    result_type?: 'image' | 'video' | 'audio' | '3d' | 'text' | 'json';
    /**
     * Async provider identity for a 'pending' result. Lets the dispatcher record
     * which provider owns the job (provider_id) and its job id (provider_job_id)
     * so the Phase A poll-backstop can complete it. Omitted for Replicate (the
     * dispatcher defaults to 'replicate' + the prediction id) and sync results.
     */
    providerId?: string;
    providerJobId?: string;
}
```

- [ ] **Step 2: Typecheck** `npx tsc --noEmit` — no error referencing `lib/nodes/types.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/nodes/types.ts
git commit -m "feat(types): add providerId/providerJobId to NodeExecutionResult"
```

---

## Task 4: FAL async adapter

**🔑 Requires `FAL_KEY` in `.env.local` to TEST, but the code compiles without it.**

**Files:** Create `lib/ai/providers/fal.ts`; Modify `lib/ai/providers/async-registry.ts`

- [ ] **Step 1: Write the FAL adapter**

```typescript
import { AsyncProviderAdapter, ErrorClass, ProviderPollResult } from './types';

const FAL_QUEUE = 'https://queue.fal.run';
const FAL_REST = 'https://api.fal.ai/v1';

function falHeaders(): Record<string, string> {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error('FAL adapter: FAL_KEY env var is not set');
  return { Authorization: `Key ${key}`, 'Content-Type': 'application/json' };
}

/**
 * FAL (fal.ai) async adapter. Queue model: POST to queue.fal.run/{slug} returns a
 * request_id + status_url + response_url; poll status_url until COMPLETED then GET
 * response_url for the output. No webhook is wired in Phase B — completion is via
 * the Phase A poll-backstop (sweep) in prod / an inline poll in local dev. Output
 * media URLs (v3.fal.media) are ephemeral and mirrored by the completion pipeline.
 */
export const falAsyncAdapter: AsyncProviderAdapter = {
  key: 'fal',
  mode: 'async',

  async submit(model, inputs, _ctx, _opts) {
    const slug = (model as any).provider_model_id as string;
    if (!slug) throw new Error('FAL adapter: model has no provider_model_id (slug)');
    const res = await fetch(`${FAL_QUEUE}/${slug}`, {
      method: 'POST',
      headers: falHeaders(),
      body: JSON.stringify(inputs ?? {}),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const cls = this.classifyError('submit', res.status, body);
      const msg = (body && (body.detail || body.error)) || `FAL submit failed (${res.status})`;
      const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
      (err as any).errorClass = cls;
      throw err;
    }
    // Persist the slug alongside the request id: poll/response URLs are derived
    // from queue.fal.run/{slug}/requests/{id}. We encode both as our job id so
    // poll() can reconstruct them without extra storage.
    const requestId = body.request_id;
    if (!requestId) throw new Error('FAL submit: no request_id in response');
    return { providerJobId: `${slug}::${requestId}`, status: 'pending' };
  },

  async poll(providerJobId): Promise<ProviderPollResult> {
    const sep = providerJobId.indexOf('::');
    const slug = providerJobId.slice(0, sep);
    const requestId = providerJobId.slice(sep + 2);
    const base = `${FAL_QUEUE}/${slug}/requests/${requestId}`;
    const statusRes = await fetch(`${base}/status`, { headers: falHeaders() });
    const statusBody = await statusRes.json().catch(() => ({}));
    if (!statusRes.ok) {
      // A 4xx here is terminal-ish; a 5xx/429 is transient. Surface as failed so
      // the sweep's classifyError path can decide; for Phase B we just report it.
      return { status: statusRes.status >= 500 || statusRes.status === 429 ? 'pending' : 'failed',
               error: (statusBody && (statusBody.detail || statusBody.error)) || `FAL status ${statusRes.status}` };
    }
    const s = statusBody.status; // IN_QUEUE | IN_PROGRESS | COMPLETED
    if (s !== 'COMPLETED') return { status: 'pending' };
    const respRes = await fetch(`${base}`, { headers: falHeaders() }); // response_url == base
    const out = await respRes.json().catch(() => ({}));
    if (!respRes.ok) return { status: 'failed', error: (out && (out.detail || out.error)) || 'FAL response fetch failed' };
    return { status: 'completed', outputs: extractFalUrls(out), error: null };
  },

  classifyError(_op, httpStatus, body): ErrorClass {
    // FAL content moderation: 422 with type content_policy_violation in detail[].
    const detail = (body as any)?.detail;
    const text = JSON.stringify(detail ?? body ?? '').toLowerCase();
    if (text.includes('content_policy') || text.includes('nsfw') || text.includes('safety')) return 'moderation';
    if (httpStatus === 429 || (httpStatus !== null && httpStatus >= 500) || httpStatus === 503 || httpStatus === 504) return 'transient';
    if (httpStatus === 422 || httpStatus === 400) return 'validation';
    return 'validation';
  },

  async fetchSchema(modelSlug) {
    const res = await fetch(`${FAL_REST}/models?endpoint_id=${encodeURIComponent(modelSlug)}&expand=openapi-3.0`, {
      headers: falHeaders(),
    });
    if (!res.ok) throw new Error(`FAL fetchSchema failed (${res.status})`);
    const body = await res.json();
    // Platform API returns a list; take the matching entry's openapi spec.
    const entry = Array.isArray(body?.models) ? body.models[0] : (body?.[0] ?? body);
    const openapi = entry?.openapi ?? entry?.openapi_schema;
    if (!openapi) throw new Error('FAL fetchSchema: no openapi spec in response');
    return openapi;
  },
};

/**
 * FAL output is model-specific JSON. Pull every hosted media URL out of the common
 * shapes ({images:[{url}]}, {image:{url}}, {video:{url}}, {audio:{url}}, {url}).
 * Returns an array of url strings — the completion pipeline normalizes + mirrors.
 */
function extractFalUrls(out: any): { url: string }[] {
  const urls: { url: string }[] = [];
  const pushUrl = (u: any) => { if (typeof u === 'string') urls.push({ url: u }); else if (u && typeof u.url === 'string') urls.push({ url: u.url }); };
  if (!out || typeof out !== 'object') return urls;
  for (const key of ['images', 'image', 'video', 'audio', 'files', 'output']) {
    const v = out[key];
    if (Array.isArray(v)) v.forEach(pushUrl);
    else if (v) pushUrl(v);
  }
  if (urls.length === 0 && typeof out.url === 'string') pushUrl(out.url);
  return urls;
}
```

- [ ] **Step 2: Register FAL in the async registry**

In `lib/ai/providers/async-registry.ts`, import and add FAL:

```typescript
import { AsyncProviderAdapter } from './types';
import { replicateAsyncAdapter } from './replicate';
import { falAsyncAdapter } from './fal';

/**
 * Maps a provider key to its async adapter. The default provider (no/`'replicate'`
 * adapter_key) resolves to the Replicate adapter. New async providers are added here.
 */
const asyncAdapters: Record<string, AsyncProviderAdapter> = {
  replicate: replicateAsyncAdapter,
  fal: falAsyncAdapter,
};

export function getAsyncAdapter(key: string | null | undefined): AsyncProviderAdapter {
  const resolved = key && asyncAdapters[key] ? asyncAdapters[key] : asyncAdapters.replicate;
  return resolved;
}
```

- [ ] **Step 3: Typecheck** `npx tsc --noEmit` — no error referencing `lib/ai/providers/fal.ts` or `async-registry.ts`. (`this.classifyError` inside `submit`/methods typechecks because they're methods on the object literal typed as `AsyncProviderAdapter`; if tsc complains about `this` typing, change `this.classifyError(...)` to `falAsyncAdapter.classifyError(...)`.)

- [ ] **Step 4: Commit**

```bash
git add lib/ai/providers/fal.ts lib/ai/providers/async-registry.ts
git commit -m "feat(providers): add FAL async adapter (queue submit/poll/classifyError/fetchSchema)"
```

---

## Task 5: Replicate adapter — prefer `provider_model_id`

**Files:** Modify `lib/ai/providers/replicate.ts`

The executor will pass the binding slug as `provider_model_id`. Make the Replicate adapter read it (falling back to `replicate_model_id` for any caller that doesn't set it).

- [ ] **Step 1: Update `submit`**

In `lib/ai/providers/replicate.ts`, change the first line of `submit` from:
```typescript
    const modelRef = (model as any).replicate_model_id as string;
```
to:
```typescript
    const modelRef = ((model as any).provider_model_id || (model as any).replicate_model_id) as string;
```

- [ ] **Step 2: Typecheck** `npx tsc --noEmit` — no error referencing `lib/ai/providers/replicate.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/ai/providers/replicate.ts
git commit -m "feat(providers): ReplicateAsyncAdapter.submit prefers provider_model_id"
```

---

## Task 6: Provider resolution helper

**Files:** Create `lib/workflow/resolve-provider.ts`

- [ ] **Step 1: Write the resolver**

```typescript
import { createServiceClient } from '@/lib/supabase/service';

export interface ResolvedProvider {
  providerKey: string;          // 'replicate' | 'fal' | adapter_key | ...
  providerModelId: string;      // per-provider slug
  inputOverrides: Record<string, any> | null;
}

/**
 * Resolve a model's PRIMARY active provider binding (lowest priority). Falls back
 * to the legacy single-provider columns on ai_models if no binding rows exist yet
 * (pre-backfill safety). Phase B uses only the primary; failover over the rest is
 * Phase C.
 */
export async function resolvePrimaryProvider(modelId: number | string): Promise<ResolvedProvider> {
  const supabase = createServiceClient();

  const { data: bindings } = await supabase
    .from('ai_model_providers')
    .select('provider_id, provider_model_id, input_overrides, priority, is_active')
    .eq('model_id', modelId)
    .eq('is_active', true)
    .order('priority', { ascending: true })
    .limit(1);

  if (bindings && bindings.length > 0) {
    const b = bindings[0];
    return {
      providerKey: b.provider_id,
      providerModelId: b.provider_model_id,
      inputOverrides: (b.input_overrides as any) ?? null,
    };
  }

  // Fallback: legacy columns. A provider_id FK -> providers.adapter_key, else replicate.
  const { data: model } = await supabase
    .from('ai_models')
    .select('replicate_model_id, provider_model_id, providers(adapter_key)')
    .eq('id', modelId)
    .single();

  const adapterKey = (model as any)?.providers?.adapter_key as string | undefined;
  if (adapterKey) {
    return { providerKey: adapterKey, providerModelId: (model as any)?.provider_model_id || '', inputOverrides: null };
  }
  return { providerKey: 'replicate', providerModelId: (model as any)?.replicate_model_id || '', inputOverrides: null };
}

/**
 * Apply a binding's input_overrides to the api_mapping_key-keyed payload. Shape:
 *   { rename: { fromKey: toKey }, defaults: { key: value } }
 * rename moves a value to the provider's key; defaults fill a key only if absent.
 * No-op when overrides is null. Curated v1 models pass null.
 */
export function applyInputOverrides(inputs: Record<string, any>, overrides: Record<string, any> | null): Record<string, any> {
  if (!overrides) return inputs;
  const out = { ...inputs };
  const rename = overrides.rename as Record<string, string> | undefined;
  if (rename) {
    for (const [from, to] of Object.entries(rename)) {
      if (from in out) { out[to] = out[from]; delete out[from]; }
    }
  }
  const defaults = overrides.defaults as Record<string, any> | undefined;
  if (defaults) {
    for (const [k, v] of Object.entries(defaults)) {
      if (out[k] === undefined || out[k] === null || out[k] === '') out[k] = v;
    }
  }
  return out;
}
```

- [ ] **Step 2: Typecheck** `npx tsc --noEmit` — no error referencing `lib/workflow/resolve-provider.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/workflow/resolve-provider.ts
git commit -m "feat(workflow): add primary-provider resolver + input_overrides applier"
```

---

## Task 7: Route the executor through the resolved provider

**Files:** Modify `lib/nodes/plugins/ai_generator/executor.server.ts`

Replicate's behavior must stay identical; only NEW async providers take the generic path. Read the whole file first.

- [ ] **Step 1: Add imports**

At the top of `lib/nodes/plugins/ai_generator/executor.server.ts`, add:

```typescript
import { getAsyncAdapter } from '@/lib/ai/providers/async-registry';
import { resolvePrimaryProvider, applyInputOverrides } from '@/lib/workflow/resolve-provider';
```

- [ ] **Step 2: Replace the adapter-fork block with provider resolution**

Find the existing block that starts at the comment `// ── External provider adapter fork ──` and ends just before `if (!model.replicate_model_id) {`. It currently reads `model.providers.adapter_key`, calls `getProviderAdapter` (sync registry), and returns the sync adapter result. REPLACE that whole block (from the `// ── External provider adapter fork ──` comment through the `// ── End adapter fork; below is the unchanged Replicate path ──` comment) with:

```typescript
        // ── Resolve the model's primary provider binding (Phase B) ───────────
        // One ai_models row can be bound to several providers; the primary
        // (priority 0, active) decides who runs it and with which slug. Failover
        // over the rest is Phase C.
        const primary = await resolvePrimaryProvider(model_id);
        const providerInputs = applyInputOverrides(replicateInputs, primary.inputOverrides);

        // Sync adapter (e.g. ElevenLabs): unchanged behavior — returns hosted bytes
        // in-request. Keyed off the resolved provider, not the legacy column.
        const syncAdapter = getProviderAdapter(primary.providerKey);
        if (syncAdapter) {
            return await syncAdapter.execute({
                model: { ...(model as any), provider_model_id: primary.providerModelId },
                inputs: providerInputs,
                iterationIndex: typeof context.predictionIndex === 'number' ? context.predictionIndex : 0,
                ctx: context,
            });
        }

        // New async providers (FAL, …) go through the generic submit+poll path.
        // Replicate is NOT handled here — it falls through to its existing path
        // below (webhook fast-path in prod, replicate.run in local dev), unchanged.
        if (primary.providerKey !== 'replicate') {
            const asyncAdapter = getAsyncAdapter(primary.providerKey);
            const modelForAdapter = { ...(model as any), provider_model_id: primary.providerModelId };
            const isLocalEnv = (() => {
                const u = process.env.NEXT_PUBLIC_APP_URL || '';
                return u.startsWith('http://localhost') || u.startsWith('http://127.0.0.1') || !u;
            })();
            const { providerJobId } = await asyncAdapter.submit(modelForAdapter, providerInputs, context);
            if (isLocalEnv) {
                // Local dev has no public webhook + no cron sweep — poll inline to
                // completion, mirroring replicate.run()'s synchronous local behavior.
                let poll = await asyncAdapter.poll(providerJobId);
                for (let i = 0; i < 150 && poll.status === 'pending'; i++) {
                    await new Promise((r) => setTimeout(r, 2000));
                    poll = await asyncAdapter.poll(providerJobId);
                }
                if (poll.status !== 'completed') {
                    throw new Error(poll.error || `${primary.providerKey} generation did not complete`);
                }
                return { success: true, status: 'success', data: poll.outputs };
            }
            // Prod: node goes 'running'; the Phase A sweep polls provider_job_id to
            // completion (and mirrors). Carry provider identity to the dispatcher.
            return {
                success: true,
                status: 'pending',
                data: { id: providerJobId },
                providerId: primary.providerKey,
                providerJobId,
            };
        }
        // ── Below: the unchanged Replicate path ──────────────────────────────
```

- [ ] **Step 3: Make the Replicate path use the resolved slug**

The existing Replicate path reads `model.replicate_model_id` in several places. To honor a Replicate binding's slug (and stay backward-compatible), add ONE line right after the `// ── Below: the unchanged Replicate path ──` comment, before `if (!model.replicate_model_id) {`:

```typescript
        // Prefer the resolved binding slug; fall back to the legacy column.
        const replicateSlug = primary.providerModelId || model.replicate_model_id;
```

Then, in the Replicate path ONLY, replace the three reads of `model.replicate_model_id` used for dispatch with `replicateSlug`:
- the `if (!model.replicate_model_id)` guard → `if (!replicateSlug)`
- `model.replicate_model_id.split(/[:\/]/)` → `replicateSlug.split(/[:\/]/)`
- `model.replicate_model_id.includes(':')` → `replicateSlug.includes(':')`
- `replicate.run(model.replicate_model_id as any, …)` → `replicate.run(replicateSlug as any, …)`
- `{ model: model.replicate_model_id }` in `predictions.create` → `{ model: replicateSlug }`
- the two `console.log` references to `model.replicate_model_id` → `replicateSlug` (cosmetic, keep logs accurate)

Do NOT change any other logic in the Replicate path (webhook URL building, fan-out, local vs prod branching all stay).

- [ ] **Step 4: Typecheck** `npx tsc --noEmit` — no error referencing `executor.server.ts`. (`getProviderAdapter` is already imported in this file from Phase 0; keep that import.)

- [ ] **Step 5: Commit**

```bash
git add lib/nodes/plugins/ai_generator/executor.server.ts
git commit -m "feat(executor): route ai_generator through resolved primary provider (Replicate unchanged)"
```

---

## Task 8: Dispatcher records the result's provider identity

**Files:** Modify `lib/workflow/dispatch-v2.ts`

The single-node 'running' write and the fan-out rows currently hardcode `'replicate'`. Make them use the executor result's `providerId`/`providerJobId` when present (Replicate results omit them → defaults preserve today's behavior).

- [ ] **Step 1: Single-node running write**

In `dispatchReplicateNode`, the `iterations <= 1` branch has an `else` that calls `updateNodeState(..., { status: 'running', replicate_prediction_id: (result.data as any)?.id, ... })`. Change that `updateNodeState` call to also pass provider identity:

```typescript
        } else {
            await updateNodeState(executionId, nodeId, {
                status: 'running',
                replicate_prediction_id: (result.data as any)?.id,
                provider_id: (result as any).providerId || 'replicate',
                provider_job_id: (result as any).providerJobId || (result.data as any)?.id,
                dispatched_at: new Date().toISOString(),
            } as any, sessionId, baseUrl);
        }
```

- [ ] **Step 2: `updateNodeState` honors explicit provider fields**

In `updateNodeState`, the upsert object currently sets `provider_id: state.replicate_prediction_id ? 'replicate' : undefined` and `provider_job_id: state.replicate_prediction_id` (added in Phase A). Change those two lines to prefer explicit values from `state`:

```typescript
          provider_id: (state as any).provider_id ?? (state.replicate_prediction_id ? 'replicate' : undefined),
          provider_job_id: (state as any).provider_job_id ?? state.replicate_prediction_id,
```

- [ ] **Step 3: Fan-out rows**

In `dispatchReplicateNode`, the fan-out `rows = results.map((r, i) => ({ ... }))` sets `provider_id: 'replicate'` and `provider_job_id` from `r.data?.id` (added in Phase A). Change those two fields to honor a generic provider result:

```typescript
        provider_id: (r as any).providerId || 'replicate',
        provider_job_id: r.status === 'pending'
            ? ((r as any).providerJobId ?? (r.data as any)?.id ?? null)
            : null,
```
(Keep `replicate_id` exactly as it is for back-compat.)

- [ ] **Step 4: Typecheck** `npx tsc --noEmit` — no error referencing `dispatch-v2.ts`. (The `as any` on the `updateNodeState` state arg covers the non-typed `provider_id`/`provider_job_id` keys, which `NodeState` may not declare.)

- [ ] **Step 5: Commit**

```bash
git add lib/workflow/dispatch-v2.ts
git commit -m "feat(dispatch): record executor-reported provider identity (generic providers)"
```

---

## Task 9: Generic schema-fetch route

**Files:** Create `app/api/providers/[key]/schema/route.ts`

- [ ] **Step 1: Write the route**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';
import { getAsyncAdapter } from '@/lib/ai/providers/async-registry';

/**
 * Generic per-provider schema fetch for the admin model form. Dispatches to the
 * resolved async adapter's optional fetchSchema(). Providers without a schema API
 * (KIE, Kinovi) return 501 so the UI falls back to manual entry. Admin-only.
 *   GET /api/providers/<key>/schema?model=<slug>
 */
export async function GET(request: NextRequest, { params }: { params: { key: string } }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const slug = new URL(request.url).searchParams.get('model');
  if (!slug) return NextResponse.json({ error: 'Missing model slug (?model=)' }, { status: 400 });

  const adapter = getAsyncAdapter(params.key);
  if (typeof adapter.fetchSchema !== 'function') {
    return NextResponse.json({ error: `Provider '${params.key}' has no schema API; enter inputs manually.` }, { status: 501 });
  }
  try {
    const openapi_schema = await adapter.fetchSchema(slug);
    return NextResponse.json({ openapi_schema });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Schema fetch failed' }, { status: 502 });
  }
}
```

> Note: this returns `{ openapi_schema }` to match the shape the existing admin `parseReplicateSchema(data.openapi_schema)` already consumes — FAL's `expand=openapi-3.0` returns an OpenAPI 3.0 doc, the same parser handles it. Replicate models continue to use the existing `/api/replicate/schema` route; this generic route covers FAL (and future schema-capable providers).

- [ ] **Step 2: Typecheck** `npx tsc --noEmit` — no error referencing the new route. (`requireAdmin` is the same helper used by `app/api/admin/models/route.ts`.)

- [ ] **Step 3: Commit**

```bash
git add app/api/providers/[key]/schema/route.ts
git commit -m "feat(admin): add generic per-provider schema-fetch route"
```

---

## Task 10: Seed a FAL model + end-to-end run

**🔑 Requires `FAL_KEY` set. This is the proof that a FAL model runs end-to-end.**

**Files:** Create `scripts/seed-fal-model.js`

- [ ] **Step 1: Write the seed script**

```js
// scripts/seed-fal-model.js
// Creates a minimal FAL-backed ai_models row + a primary 'fal' binding so a FAL
// model can run without the admin UI. Idempotent on display_name.
// Run: node scripts/seed-fal-model.js
const fs = require('fs');
for (const line of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const DISPLAY = 'FAL FLUX schnell (Phase B test)';
const SLUG = 'fal-ai/flux/schnell';

(async () => {
  // Need a category + archetype that exist; pick the first of each.
  const { data: cat } = await supabase.from('categories').select('id').limit(1).single();
  const { data: arch } = await supabase.from('node_archetypes').select('id').limit(1).single();
  if (!cat || !arch) { console.error('❌ need at least one category + archetype'); process.exit(1); }

  const inputs_schema = {
    description: 'FAL FLUX schnell text-to-image (Phase B smoke test)',
    handles: [],
    controls: [
      { api_mapping_key: 'prompt', type: 'string', component: 'prompt_textarea', default_value: 'a red apple on white', is_visible: true, label: 'Prompt' },
    ],
  };
  const outputs_schema = { handles: [{ name: 'image', api_mapping_key: 'image', type: 'image', is_array: true, is_visible: true }] };

  // Upsert the model by display_name.
  let { data: existing } = await supabase.from('ai_models').select('id').eq('display_name', DISPLAY).maybeSingle();
  let modelId = existing?.id;
  if (!modelId) {
    const { data, error } = await supabase.from('ai_models').insert({
      display_name: DISPLAY, category_id: cat.id, archetype_id: arch.id,
      credit_cost: 1, is_active: true, inputs_schema, outputs_schema,
    }).select('id').single();
    if (error) { console.error('❌ insert model:', error.message); process.exit(1); }
    modelId = data.id;
  }
  console.log('✅ ai_models id:', modelId);

  const { error: bErr } = await supabase.from('ai_model_providers').upsert({
    model_id: modelId, provider_id: 'fal', provider_model_id: SLUG, priority: 0, is_active: true,
  }, { onConflict: 'model_id,provider_id' });
  if (bErr) { console.error('❌ insert binding:', bErr.message); process.exit(1); }
  console.log(`✅ fal binding -> ${SLUG}`);
  console.log('Now add a node with this model in the app and run it (needs FAL_KEY + a deploy, or local dev which polls inline).');
  process.exit(0);
})();
```

- [ ] **Step 2: Run the seed** (after Tasks 1–8 done + migrations applied + `FAL_KEY` set):

Run: `node scripts/seed-fal-model.js`
Expected: `✅ ai_models id: …`, `✅ fal binding -> fal-ai/flux/schnell`.

- [ ] **Step 3: End-to-end run (LOCAL is easiest — it polls inline, no deploy/cron needed)**

With `FAL_KEY` in `.env.local` and `npm run dev` running, open the app, add an `ai_generator` node, select **"FAL FLUX schnell (Phase B test)"**, type a prompt, run it. Expected: the node completes with a generated image. Locally the executor submits to FAL's queue and polls inline to completion (mirroring Replicate's local-sync behavior).

For a PROD/preview run: deploy, ensure `FAL_KEY` is in the deploy env, run the node — it goes `running`, and the pg_cron sweep (Phase A) polls `provider_job_id` to completion within ~2 min (mirroring the media). Confirm the node flips to its image.

- [ ] **Step 4: Commit the seed script**

```bash
git add scripts/seed-fal-model.js
git commit -m "test(providers): add FAL model seed script for Phase B E2E"
```

---

## Self-Review (completed during authoring)

- **Spec coverage:** §5.2 binding table + `input_overrides` + backfill (Task 1); §5.3 async adapter for a new provider (Task 4 FAL) + Replicate slug parity (Task 5); executor routing to the resolved provider keeping Replicate unchanged (Tasks 6–7); dispatcher provider identity (Task 8); generic schema fetch (Task 9); end-to-end proof on one provider (Task 10). Admin "Providers" UI (§5.4) is intentionally a SEPARATE follow-on plan (noted in header) — Phase B backend is testable via the seed script.
- **Out of scope honored:** no failover chain (Phase C), no admin UI, no webhook for FAL (poll-backstop covers it), no change to `completeJob`/`sweep-pending`/webhook route (already generic).
- **Type consistency:** `providerId`/`providerJobId` added in Task 3 are produced by the executor in Task 7 and consumed by the dispatcher in Task 8; `resolvePrimaryProvider`/`applyInputOverrides` (Task 6) are imported in Task 7; `getAsyncAdapter`/`falAsyncAdapter` (Task 4) used in Tasks 7 & 9; the schema route returns `{ openapi_schema }` matching the admin parser.
- **No placeholders:** every code step is complete; verification uses `npx tsc --noEmit` + `node scripts/*.js` + a manual app run, adapted to the no-test-runner reality.

## Operator checklist (live-infra, yours to run)
1. Apply `supabase/migrations/20260612_ai_model_providers.sql` (+ confirm Phase A migrations applied via `node scripts/audit-migrations.js`).
2. `node scripts/verify-phase-b-schema.js` → two ✅.
3. **Set `FAL_KEY`** in `.env.local` (+ deploy env).
4. `node scripts/seed-fal-model.js`.
5. Run the seeded FAL model in the app (local = inline poll; prod = sweep completes within ~2 min).
