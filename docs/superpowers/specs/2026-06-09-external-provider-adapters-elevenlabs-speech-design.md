# External Provider Adapters — ElevenLabs Speech (Design)

**Date:** 2026-06-09
**Status:** Approved design, pending implementation plan
**Author:** brainstormed with Claude Code

## Summary

Add infrastructure to run AI models from **external API providers** (starting with ElevenLabs)
the same way the app already runs Replicate models — they appear in the same categories, context
menu, node palette, and node Properties panel, with the same dynamic control system. The first
concrete vertical slice is **Generate Speech (text-to-speech) via the ElevenLabs API directly**,
replacing the current Replicate-routed ElevenLabs model.

The design introduces a small **provider-adapter seam** in code: each provider gets a server
module that knows the three things that genuinely differ per provider — how to **authenticate**,
how to **shape the request**, and how to **call the API**. Everything downstream of the API call
(mirror media → storage, write results, dispatch children, refund-on-failure) is unified into a
**single shared finalize path used by every provider**.

## Goals

- A reusable seam for external (non-Replicate) AI providers, exercised by one real adapter.
- Generate Speech runs against the ElevenLabs API directly (no Replicate hop).
- A synced, searchable **voice catalog** with audio previews, surfaced through a visual picker.
- No re-architecture required to add the next provider/node (music, sfx, etc.) — that becomes a
  new model row plus a thin adapter, not a structural change.

## Non-goals (deferred — YAGNI)

- Folding the existing Replicate path into the adapter abstraction (it stays as the default branch).
- A formal multi-provider plugin SDK / capability-declaration system.
- Per-character credit pricing for ElevenLabs (launch uses flat `credit_cost`).
- Chunking long text across multiple ElevenLabs calls.
- End-user "bring your own API key" — credentials are global, admin-level env vars.
- Mirroring voice **preview** audio into our storage (we store ElevenLabs' preview URL directly;
  only **final generations** are mirrored).

## Background / current architecture (verified)

- `ai_models` already has `provider_id` (FK `providers`), `category_id`, `node_type_id`,
  `archetype_id`, `inputs_schema`/`outputs_schema` JSONB, `credit_cost`, `is_per_second`,
  `is_active`. Defined in `supabase/migrations/20260312_add_dynamic_node_registry.sql`.
- `ai_generator` is a single static node whose handles/controls are derived at runtime from the
  selected model's `inputs_schema` (`lib/nodes/plugins/ai_generator/`). Controls map to API fields
  by `api_mapping_key`. Properties UI: `properties.tsx` (`ControlRenderer`). Admin authoring:
  `components/admin/ModelForm.tsx`.
- Execution: `/api/executions/start` → cost pre-flight + debit → `dispatch-v2.ts` →
  `aiGeneratorExecutor` (`executor.server.ts`), which **hardcodes** `replicate.predictions.create()`.
- Results: Replicate calls back `app/api/webhooks/replicate-v2/route.ts`, which verifies the
  signature, normalizes output, `mirrorMediaToStorage()` → `chat-assets` bucket, upserts
  `node_results` (single) or `node_predictions` (fan-out, `iterations>1`), then `finalizeFanOut`
  + `checkAndDispatchChildren` (`lib/workflow/orchestrator.ts`).
- Categories / node_types / providers / context menu already drive the palette dynamically from the
  DB (`components/editor/NodePalette.tsx`, `NodeLibraryPanel.tsx`, store slices). **No code change
  is needed for ElevenLabs to appear in the UI** — it is data once the model row exists.
- Credentials today: single global `REPLICATE_API_TOKEN` env var; no per-user/per-model keys.

**Key insight:** the system is ~80% provider-agnostic already. The only hardcoded seam is the
executor's Replicate dispatch and the Replicate-specific webhook. ElevenLabs TTS is **synchronous**
(returns audio bytes directly, no webhook) — the principal new behavior.

## Architecture

### 1. Provider adapter seam (code)

```
interface ProviderAdapter {
  key: string;                 // e.g. 'elevenlabs' — matches providers.adapter_key
  mode: 'sync' | 'async-webhook';
  execute(args: {
    model: AiModelRow;         // includes provider_model_id, inputs_schema, etc.
    inputs: Record<string, any>; // resolved from controls + input handles by api_mapping_key
    iterationIndex: number;
    ctx: ExecutorContext;      // executionId, sessionId, nodeId, userId, predictionIndex
  }): Promise<ProviderResult>; // sync: { bytes|url, outputType } ; async: prediction handle
}
```

- An adapter **registry** (server-only) maps `providers.adapter_key` → adapter module.
- `aiGeneratorExecutor` forks at the top:
  - Model's provider has an `adapter_key` with a registered adapter → **adapter path**.
  - Otherwise → **existing Replicate path, unchanged** (default/legacy branch).
- The ElevenLabs adapter (`mode: 'sync'`) builds `POST /v1/text-to-speech/{voice_id}` with
  `model_id` (e.g. `eleven_v3`), `voice_settings` (stability, similarity_boost, style,
  use_speaker_boost), and `output_format`; returns the audio buffer with `outputType: 'audio'`.

### 2. Unified result finalize path

- Extract the result-finalization logic currently inside `replicate-v2/route.ts` into a shared
  helper, e.g. `lib/workflow/finalize-node-result.ts` → `finalizeNodeResult(...)`. It:
  1. mirrors media bytes/URL → `chat-assets` storage,
  2. upserts `node_predictions` (fan-out) or `node_results` (single),
  3. runs `finalizeFanOut` and `checkAndDispatchChildren`.
- The Replicate webhook route is refactored to call this same helper (behavior-preserving).
- The ElevenLabs sync adapter path calls the same helper inline after each generation.
- Result handling is therefore identical across providers.

### 3. Execution flow (ElevenLabs sync)

1. `/api/executions/start` runs its normal **provider-agnostic** cost pre-flight + debit.
2. `aiGeneratorExecutor` detects an adapter provider and runs the adapter **inline**, N times
   **concurrently** for `iterations>1` (aligning with the existing concurrent-streaming-iterations
   fan-out + per-iteration refund + realtime streaming to chat).
3. Each iteration's bytes → `finalizeNodeResult()` → storage + `node_predictions` + dispatch.
4. Per-iteration failures route through the orchestrator failure path and **refund** the iteration's
   credits (consistent with current behavior).

**Risk:** a sync call holds the serverless function open for the generation duration. ElevenLabs TTS
is normally seconds; very long text could approach function timeout. Launch mitigation: a sane
max-character guard on the text control; chunking deferred.

### 4. Data-model changes (migrations)

- `providers`: add `adapter_key TEXT NULL` (null = Replicate/legacy).
- `ai_models`: add `provider_model_id TEXT NULL` (e.g. `eleven_v3`; `replicate_model_id` becomes
  optional for adapter providers).
- New table `voices`:
  - `id` (pk), `external_voice_id`, `provider_id` (FK `providers`, consistent with `ai_models`),
    `name`, `description`,
    `gender`, `age`, `accent`, `language`, `use_case`, `category`
    (premade | professional | shared | cloned), `preview_url`, `labels` JSONB, `is_active`,
    `created_at`, `updated_at`.
  - Indexes to support search + filter; RLS = public read for active rows, writes via service role.

### 5. Voice catalog sync

- Re-runnable script `scripts/sync-elevenlabs-voices.js` (matches existing `scripts/` pattern):
  pulls premade voices (`GET /v1/voices`) + a slice of the shared library (`GET /v1/shared-voices`,
  paginated) and upserts into `voices`. Seed once; re-run to refresh. (Optional cron route later.)
- No live ElevenLabs dependency when the picker opens.

### 6. Voice-picker control + modal (UI)

- New control `component: 'voice_picker'`, `api_mapping_key: 'voice_id'`.
- In the node Properties panel (`ControlRenderer` in `ai_generator/properties.tsx`) it renders as a
  button showing the selected voice's name; clicking opens a **VoicePicker modal**:
  - Top: search box + filter chips (gender, language/accent, use-case, category).
  - Body: grid of voice cards — name, tags, ▶ play button streaming `preview_url` through a single
    shared `<audio>` element (one at a time).
  - Selecting a card writes `voice_id` into `control_values`; modal closes.
  - Data via new `/api/voices/list` route (query + filters, paginated) reading the `voices` table.
- The same picker renders in `ModelForm`'s live preview so the admin can set a default voice.

### 7. Admin model authoring

- In `ModelForm`, when the chosen provider has an `adapter_key` (external): hide the Replicate
  "Fetch Schema" button; offer a **provider preset** that seeds ElevenLabs TTS controls (text
  textarea, voice_picker, stability/similarity/style sliders, `output_format` select) and exposes a
  `provider_model_id` field. All controls remain editable afterward.

### 8. Chat brain

- The direct speech model is just another `ai_generator` model to the brain. The raw voice catalog
  is **not** exposed to the brain (same principle as character image URLs being hydrated
  server-side). The model carries a default `voice_id`; the brain does not fabricate voice ids.

### 9. Migration of the existing Replicate speech model

- Create the ElevenLabs provider + direct speech model; **deactivate** the old Replicate-routed
  speech model in the same change. Saved workflows referencing the old `model_id` must degrade
  gracefully (surface "model unavailable" rather than hard-crash) rather than silently mis-run.

## Operator steps (user-side)

1. **ElevenLabs account & key** — create account, generate API key; note plan tier (caps monthly
   characters and shared-library access; both sync and generation consume quota).
2. **Env vars** — add `ELEVENLABS_API_KEY` to `.env.local` and to prod hosting env, then redeploy.
   Add it to the documented required-env list in `CLAUDE.md`.
3. **Migrations** — apply the new migrations (providers/ai_models columns + `voices` table) to local
   and live Supabase.
4. **Seed voices** — run `node scripts/sync-elevenlabs-voices.js` against live env once; re-run to
   refresh.
5. **Admin setup** — create the ElevenLabs provider (`adapter_key='elevenlabs'`); create the direct
   speech model (preset → default voice, `provider_model_id='eleven_v3'`, flat credit cost);
   deactivate the old Replicate speech model.
6. **Credit-cost mapping** — launch uses a flat `credit_cost` you set on the model row; per-character
   pricing via `cost_per_unit` is deferred.

## Components & boundaries

| Unit | Responsibility | Depends on |
|------|----------------|-----------|
| `lib/ai/providers/registry.ts` | map `adapter_key` → adapter | adapter modules |
| `lib/ai/providers/elevenlabs.ts` | auth + request shape + call ElevenLabs TTS (sync) | `ELEVENLABS_API_KEY` |
| `lib/workflow/finalize-node-result.ts` | mirror media + write results + dispatch children | storage, orchestrator |
| `aiGeneratorExecutor` (modified) | fork by provider; run adapter inline (fan-out) or Replicate | registry, finalize helper |
| `replicate-v2/route.ts` (refactored) | verify webhook, then call finalize helper | finalize helper |
| `voices` table + sync script | catalog of voices w/ previews | ElevenLabs voices API |
| `/api/voices/list` | query/filter/paginate voices | `voices` table |
| `VoicePicker` modal + `voice_picker` control | choose a voice visually w/ audio preview | `/api/voices/list` |
| `ModelForm` preset (modified) | author external-provider models | providers, controls |

## Error handling

- Missing `ELEVENLABS_API_KEY` → executor fails the node through the orchestrator failure path
  (never a silent success); credits refunded.
- ElevenLabs API error / non-2xx → per-iteration failure + refund; surfaced like a Replicate failure.
- Voice sync failures are isolated to the script run; the app keeps serving the last-synced catalog.
- Deactivated/old model referenced by a saved workflow → graceful "model unavailable".

## Testing / verification

- No test runner in repo; verify with `npx tsc --noEmit` (per project memory: lint/build unreliable).
- Manual E2E: seed voices → create provider+model in admin → add Generate Speech node → pick a voice
  (preview plays) → run single + `iterations>1` → audio mirrored to storage, result tiles render in
  chat, children dispatch, credits debited/refunded correctly.
- Confirm Replicate models still run unchanged (regression check on the shared finalize path).

## Open decisions intentionally settled

- Build altitude: **adapter layer with one implementation** (ElevenLabs), Replicate untouched.
- Voice source: **sync a broad catalog** (premade + shared-library slice) with filter/search.
- Preview audio: **store ElevenLabs preview URL directly**, do not mirror.
- Node shape: **reuse `ai_generator`**, no new node type.
- Existing model: **replace immediately** (deactivate Replicate speech model), graceful degradation.
- Credentials: **global env var**, admin-level.
