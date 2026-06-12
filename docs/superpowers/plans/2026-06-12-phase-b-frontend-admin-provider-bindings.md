# Phase B Frontend: Admin Provider-Bindings UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admins manage a model's providers from the model form: add providers from a dropdown, set each provider's slug, mark one as default — everything else (priorities, binding rows, legacy columns, schema fetch) handled behind the scenes.

**Architecture:** The form gains a `provider_bindings` array (default first = priority 0; the rest are fallbacks in list order). The admin model POST/PATCH routes accept that array and reconcile `ai_model_providers` (replacing the legacy-mirror when present) while keeping the legacy `ai_models.replicate_model_id` / `provider_id` / `provider_model_id` columns in sync for old readers. Schema fetch generalizes: it fetches from the DEFAULT binding's provider (Replicate via the existing route, others via `/api/providers/[key]/schema`).

**Tech Stack:** Next.js route handlers, Supabase JS, React (existing ModelForm patterns: `components/ui/Select`, `Input`, `Switch`).

**Verification reality:** No test runner — `npx tsc --noEmit` must be clean before every commit. Manual E2E happens later against the live DB.

**Context:**
- Binding table: `ai_model_providers (model_id, provider_id TEXT adapter-key like 'replicate'|'fal'|'elevenlabs', provider_model_id TEXT slug, priority INT 0=primary, is_active BOOL, input_overrides JSONB, UNIQUE(model_id, provider_id))` — migration `supabase/migrations/20260612_ai_model_providers.sql` (NOT yet applied live; code must tolerate the missing table like `lib/admin/model-provider-binding.ts` does).
- `lib/admin/model-provider-binding.ts` has `mirrorModelProviderBinding` (legacy columns → binding) with the missing-table-swallow pattern + the provider-key resolution rules (non-empty `replicate_model_id` → `'replicate'`; else providers.adapter_key).
- Form: `components/admin/ModelForm.tsx` (~1326 lines; state at ~136-148; replicate schema fetch at ~261-320; submit at ~433-477; provider Select at ~554-562). Admin page: `app/admin/page.tsx`. Providers list comes from `modelsAdminApi.listProviders` (`lib/api/admin.ts`).
- Routes: `app/api/admin/models/route.ts` (POST, validation: display_name+category_id+archetype_id and EITHER replicate_model_id OR provider_id), `app/api/admin/models/[id]/route.ts` (PATCH/DELETE). Both call `mirrorModelProviderBinding` then `invalidateRegistryCache`.
- Generic schema route exists: `app/api/providers/[key]/schema/route.ts` (admin-gated, `?model=<slug>`, returns `{ openapi_schema }`, 501 when adapter has no fetchSchema).
- Replicate schema parse: `parseReplicateSchema(openapi_schema)` used by the form; FAL's fetchSchema also returns an OpenAPI doc with an Input component — try the same parser, fail gracefully.

---

### Task 1: Backend — `provider_bindings` reconcile in admin model routes

**Files:**
- Modify: `lib/admin/model-provider-binding.ts`
- Modify: `app/api/admin/models/route.ts`
- Modify: `app/api/admin/models/[id]/route.ts`
- Modify: `lib/api/admin.ts` (models list select)

- [ ] **Step 1:** In `lib/admin/model-provider-binding.ts`, add and export:

```typescript
export interface ProviderBindingInput {
  provider_id: string;        // adapter key: 'replicate' | 'fal' | 'elevenlabs' | ...
  provider_model_id: string;  // per-provider slug
  is_active?: boolean;        // default true
}

/**
 * Replace a model's provider bindings with the given ordered list (index 0 =
 * default/primary → priority 0; the rest are fallbacks in order). Deletes
 * bindings not in the list. Also syncs the legacy ai_models columns so old
 * readers stay consistent:
 *   - replicate_model_id := the replicate binding's slug (or null if none)
 *   - provider_model_id  := the default binding's slug when it is adapter-keyed
 *   - provider_id (FK to providers) is NOT touched here — the form still sets it.
 * Swallows ONLY the missing-table error (pre-migration grace), like
 * mirrorModelProviderBinding.
 */
export async function reconcileModelProviderBindings(
  supabase: SupabaseClient,
  modelId: string,
  bindings: ProviderBindingInput[],
): Promise<void>
```

Implementation: validate each entry has a non-empty `provider_id` and `provider_model_id` (skip empties); de-dupe by `provider_id` (first occurrence wins — UNIQUE constraint). Then, per binding at index i: UPDATE `(provider_model_id, priority: i, is_active)` matching `(model_id, provider_id)`; on 0 rows, INSERT `{model_id, provider_id, provider_model_id, priority: i, is_active}`. Then DELETE rows for this model whose `provider_id` is not in the list. Then the legacy sync UPDATE on `ai_models`: `replicate_model_id` = slug of the `'replicate'` binding or null; if the default (index 0) binding is NOT replicate, also set `provider_model_id` = its slug. Wrap the whole body in the same missing-table try/swallow used by `mirrorModelProviderBinding` (reuse/extract its regex helper).

- [ ] **Step 2:** In BOTH admin model routes: accept an optional `provider_bindings: ProviderBindingInput[]` field in the JSON body. After the successful `ai_models` write: if `Array.isArray(provider_bindings)` call `reconcileModelProviderBindings(...)` INSTEAD of `mirrorModelProviderBinding(...)`; otherwise keep the existing mirror call (backwards compatibility for clients not sending bindings). Strip `provider_bindings` from the object written to `ai_models` (it is not a column). POST validation: accept `provider_bindings` with ≥1 valid entry as satisfying the "EITHER replicate_model_id OR provider_id" requirement.
- [ ] **Step 3:** In `lib/api/admin.ts`, extend the models list select from `'*, providers(name, logo_url)'` to also include `ai_model_providers(provider_id, provider_model_id, priority, is_active)` so the edit form can hydrate bindings. IMPORTANT: this read uses the admin session client and the table's RLS is `is_admin()` — fine for the admin page. Guard the consumer code for the relation being absent (pre-migration the embed errors — if the embed makes the WHOLE query fail pre-migration, instead fetch bindings in a separate query that swallows the missing-table error, so the admin page keeps working before the migration is applied; choose the separate-query approach if in doubt).
- [ ] **Step 4:** `npx tsc --noEmit` → clean. Commit: `feat(admin): provider_bindings reconcile in model routes + bindings in admin model list`

### Task 2: Frontend — Providers section in ModelForm

**Files:**
- Modify: `components/admin/ModelForm.tsx`
- Modify (if the model prop type lives elsewhere): wherever the admin model row type is declared

UX (keep it minimal — the user's words: "choose the providers for each model easily by a dropdown, say which is the default, everything handled behind the scenes"):

- A new `FormSection` titled **Providers** replacing the current single "AI Provider" select + `provider_model_id` input cluster (keep the underlying `form.provider_id` state — see Step 3).
- State: `bindings: { provider_id: string; provider_model_id: string; is_active: boolean }[]` + `defaultIndex` implicit = index 0 (keep the default at index 0; "Make default" moves a row to the front).
- Each row: provider logo+name (from the providers list where `adapter_key`/`'replicate'` matches), an `Input` for the slug (placeholder per provider: replicate `owner/name:version`, fal `fal-ai/flux/schnell`), a "Default" pill on row 0 / a "Make default" ghost button on others, an active `Switch` (size sm), a remove ✕.
- Below the rows: an "Add provider" `Select` whose options are the available adapter keys NOT already bound: always `'replicate'`, plus every distinct non-empty `providers[].adapter_key`. Selecting one appends a row with an empty slug.
- Hydration: when editing an existing model, seed rows from the model's `ai_model_providers` (sorted by priority) — fall back to synthesizing one row from legacy columns (`replicate_model_id` → replicate row; else adapter_key + `provider_model_id`) when no bindings exist.
- Submit: include `provider_bindings: bindings.filter(b => b.provider_id && b.provider_model_id.trim())` in the POST/PATCH payload (default first — the array is already in priority order).

- [ ] **Step 1:** Read the whole current form region (provider select ~554-562, state ~136-148, hydration of an editing model, submit ~433-477) before editing; follow the file's existing subcomponent + styling patterns exactly (labels `text-[10px] font-bold text-content-tertiary uppercase tracking-[0.1em]`, cards `bg-white/5 border border-white/10 rounded-2xl`).
- [ ] **Step 2:** Implement the section + state + hydration + submit changes.
- [ ] **Step 3:** Keep legacy state consistent behind the scenes (no extra UI): on submit, derive `replicate_model_id` from the replicate row's slug (or `''`), `provider_model_id` from the default row's slug when the default is adapter-keyed, and `provider_id` (the providers-table UUID/slug id used for the display chip) from the providers row whose `adapter_key` matches the default binding (or the Replicate provider row if the default is replicate — find it by `adapter_key` null + name match 'replicate', else leave as-is). The old standalone "AI Provider" select and `provider_model_id` input are removed from the UI.
- [ ] **Step 4:** `npx tsc --noEmit` → clean. Commit: `feat(admin): Providers section — per-model bindings with default + dropdown add`

### Task 3: Schema fetch from the default provider

**Files:**
- Modify: `components/admin/ModelForm.tsx` (fetch-schema handler ~261-320)

- [ ] **Step 1:** Generalize the "Fetch Schema" button: it now reads the DEFAULT binding (row 0). If `provider_id === 'replicate'` → existing `/api/replicate/schema?model_id=<slug>` flow unchanged (including the owner→provider auto-match + display-name autofill). Otherwise → `GET /api/providers/<provider_id>/schema?model=<encodeURIComponent(slug)>`; on 200, run the SAME `parseReplicateSchema(openapi_schema)` (FAL returns an OpenAPI doc with an Input component too); on parse failure or 501/502, surface the route's error in the form's existing error UI ("This provider doesn't support schema fetch — define inputs manually") and leave the form intact.
- [ ] **Step 2:** Button enablement: disabled until the default binding has a non-empty slug. Keep the button label/styling as-is.
- [ ] **Step 3:** `npx tsc --noEmit` → clean. Commit: `feat(admin): schema fetch follows the default provider binding`
