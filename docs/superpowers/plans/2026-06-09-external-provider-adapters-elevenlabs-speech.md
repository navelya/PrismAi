# External Provider Adapters — ElevenLabs Speech Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run AI models from external (non-Replicate) API providers through the existing `ai_generator` node, starting with ElevenLabs text-to-speech via a synced, searchable voice catalog and a visual voice picker.

**Architecture:** A thin server-side **provider-adapter** seam. Each provider gets a code module that knows how to authenticate, shape its request, and call its API. The ElevenLabs adapter (synchronous) uploads its returned audio bytes to Supabase storage and returns a permanent `{ url }`, which flows through the **existing** `dispatchReplicateNode` sync-success completion path (no webhook/dispatch changes). Replicate's path is untouched and remains the default. A `voices` table (synced from ElevenLabs) backs a `voice_picker` control rendered in the node Properties panel.

**Tech Stack:** Next.js (App Router, `nodejs` runtime), TypeScript, Supabase (Postgres + Storage + RLS), Zustand store, ElevenLabs HTTP API, React.

**Verification note:** This repo has **no test runner**. Per project convention, type-correctness is verified with `npx tsc --noEmit`; behavior is verified with runnable `node scripts/*.js` against a live env and manual in-app E2E. Plan steps reflect that — "tests" are tsc + runnable scripts + explicit manual checks, not a unit-test framework.

**Conventions used below:**
- All paths are repo-relative to `c:\Projects\Prisfol\PrismAi`.
- `@/*` is the path alias for the repo root.
- Migrations live in `supabase/migrations/` and are applied by the operator to local + live Supabase (there is no automated migration runner in this repo).
- Commit after each task. Branch: work on `dev` (current branch) or a feature branch; do not commit to `main`.

---

## File Structure

**New files:**
- `supabase/migrations/20260609_add_provider_adapters.sql` — `providers.adapter_key`, `ai_models.provider_model_id`.
- `supabase/migrations/20260609_add_voices_table.sql` — `voices` table + indexes + RLS.
- `lib/workflow/media-mirror.ts` — shared media-to-storage helpers (extracted from the webhook) + new `uploadResultBuffer` for raw bytes.
- `lib/ai/elevenlabs-client.ts` — ElevenLabs HTTP client (`generateSpeech`).
- `lib/ai/providers/types.ts` — `ProviderAdapter` interface.
- `lib/ai/providers/registry.ts` — `adapter_key` → adapter lookup.
- `lib/ai/providers/elevenlabs.ts` — ElevenLabs TTS adapter.
- `app/api/voices/list/route.ts` — query/filter/paginate the voice catalog.
- `scripts/sync-elevenlabs-voices.js` — seed/refresh the `voices` table.
- `components/editor/VoicePickerModal.tsx` — the visual voice picker (grid + search + filters + audio preview).
- `lib/nodes/plugins/ai_generator/VoicePickerControl.tsx` — the control button that opens the modal and shows the selected voice.

**Modified files:**
- `app/api/webhooks/replicate-v2/route.ts` — import media helpers from `media-mirror.ts` (behavior-preserving).
- `lib/nodes/plugins/ai_generator/executor.server.ts` — fork to the adapter path when the model's provider has an `adapter_key`.
- `lib/nodes/types.ts` — add `'voice_picker'` to the `Control['component']` union.
- `lib/nodes/plugins/ai_generator/properties.tsx` — render the `voice_picker` control.
- `components/admin/ModelForm.tsx` — `provider_model_id` field, `voice_picker` in `COMPONENT_DICTIONARY`, external-provider preset, hide "Fetch Schema" for adapter providers.
- `app/api/admin/models/route.ts` + `app/api/admin/models/[id]/route.ts` — pass through `provider_model_id`; make `replicate_model_id` optional.
- `app/api/admin/providers/route.ts` + `app/api/admin/providers/[id]/route.ts` — accept/store `adapter_key`.
- `app/api/models/list/route.ts` — include `providers(name, logo_url, adapter_key)`.
- `CLAUDE.md` — document `ELEVENLABS_API_KEY` and the adapter seam.

---

## Phase 0 — Data model

### Task 1: Migration — provider adapters + provider model id

**Files:**
- Create: `supabase/migrations/20260609_add_provider_adapters.sql`

- [ ] **Step 1: Write the migration**

```sql
-- External provider adapters.
-- providers.adapter_key links a provider row to a server-side code adapter
-- (lib/ai/providers/registry.ts). NULL = Replicate/legacy (no code adapter).
ALTER TABLE public.providers
  ADD COLUMN IF NOT EXISTS adapter_key TEXT;

COMMENT ON COLUMN public.providers.adapter_key IS
  'Server adapter key (e.g. ''elevenlabs''). NULL means Replicate/legacy dispatch.';

-- ai_models.provider_model_id holds the provider-native model identifier for
-- adapter providers (e.g. ElevenLabs ''eleven_v3''). replicate_model_id stays for
-- Replicate models and becomes optional for adapter providers.
ALTER TABLE public.ai_models
  ADD COLUMN IF NOT EXISTS provider_model_id TEXT;

COMMENT ON COLUMN public.ai_models.provider_model_id IS
  'Provider-native model id for adapter providers (e.g. ElevenLabs eleven_v3).';

-- replicate_model_id was NOT NULL; adapter models do not have one. Relax it.
ALTER TABLE public.ai_models
  ALTER COLUMN replicate_model_id DROP NOT NULL;
```

- [ ] **Step 2: Apply locally and verify columns exist**

Apply this SQL to your local Supabase (SQL editor or `psql`). Then verify:

Run (against local DB):
```sql
SELECT column_name, is_nullable FROM information_schema.columns
WHERE table_name = 'ai_models' AND column_name IN ('replicate_model_id','provider_model_id');
SELECT column_name FROM information_schema.columns
WHERE table_name = 'providers' AND column_name = 'adapter_key';
```
Expected: `provider_model_id` present; `replicate_model_id` `is_nullable = YES`; `adapter_key` present.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260609_add_provider_adapters.sql
git commit -m "feat(db): provider adapter_key + ai_models.provider_model_id"
```

---

### Task 2: Migration — voices catalog table

**Files:**
- Create: `supabase/migrations/20260609_add_voices_table.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Voice catalog synced from ElevenLabs (premade + shared library + owned).
-- preview_url is the ElevenLabs CDN URL stored directly (not mirrored).
CREATE TABLE IF NOT EXISTS public.voices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id TEXT REFERENCES public.providers(id) ON DELETE CASCADE,
  external_voice_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  gender TEXT,
  age TEXT,
  accent TEXT,
  language TEXT,
  use_case TEXT,
  category TEXT,                 -- premade | professional | shared | cloned | famous | generated
  preview_url TEXT,
  labels JSONB DEFAULT '{}'::jsonb,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (provider_id, external_voice_id)
);

CREATE INDEX IF NOT EXISTS voices_provider_active_idx
  ON public.voices (provider_id, is_active);

CREATE INDEX IF NOT EXISTS voices_external_id_idx
  ON public.voices (external_voice_id);

CREATE INDEX IF NOT EXISTS voices_search_idx
  ON public.voices USING gin (
    to_tsvector('simple',
      coalesce(name,'') || ' ' || coalesce(description,'') || ' ' ||
      coalesce(accent,'') || ' ' || coalesce(use_case,'') || ' ' ||
      coalesce(language,''))
  );

-- RLS: anyone signed in can read active voices; writes only via service role
-- (the sync script uses the service client, which bypasses RLS).
ALTER TABLE public.voices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "voices_select_active" ON public.voices;
CREATE POLICY "voices_select_active" ON public.voices
  FOR SELECT
  USING (is_active = true);
```

- [ ] **Step 2: Apply locally and verify**

Apply to local Supabase, then:
```sql
SELECT count(*) FROM public.voices;            -- expect 0
SELECT relrowsecurity FROM pg_class WHERE relname = 'voices';  -- expect t
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260609_add_voices_table.sql
git commit -m "feat(db): voices catalog table + search index + RLS"
```

---

## Phase 1 — Adapter seam (backend)

### Task 3: Extract shared media-mirror helpers

Goal: move `mirrorMediaToStorage` (and its maps + `fetchWithRetry` + `MIRROR_CONCURRENCY`) out of the webhook into a shared module, and add `uploadResultBuffer` for raw bytes. Behavior of the webhook must not change.

**Files:**
- Create: `lib/workflow/media-mirror.ts`
- Modify: `app/api/webhooks/replicate-v2/route.ts`

- [ ] **Step 1: Create `lib/workflow/media-mirror.ts`**

```typescript
import { createServiceClient } from '@/lib/supabase/service';
import { NodeResultType } from '@/lib/workflow/result-format';

export const WEBHOOK_MEDIA_EXTENSIONS: Record<NodeResultType, string> = {
  image: 'png',
  video: 'mp4',
  audio: 'mp3',
  '3d': 'glb',
  text: 'txt',
  json: 'json',
};

export const WEBHOOK_MEDIA_CONTENT_TYPES: Record<NodeResultType, string> = {
  image: 'image/png',
  video: 'video/mp4',
  audio: 'audio/mpeg',
  '3d': 'model/gltf-binary',
  text: 'text/plain',
  json: 'application/json',
};

export async function fetchWithRetry(url: string, maxAttempts = 3, delayMs = 1500): Promise<Response> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res;
    console.warn(
      `[media-mirror] Fetch attempt ${attempt}/${maxAttempts} failed (${res.status}). ${
        attempt < maxAttempts ? `Retrying in ${delayMs}ms...` : 'No more retries.'
      }`
    );
    if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`Failed to fetch media after ${maxAttempts} attempts`);
}

// Cap on simultaneous fetch+upload pairs. Each in-flight item holds the full
// media payload in memory as a Buffer, so unbounded Promise.all would OOM the
// function on large batches of video.
const MIRROR_CONCURRENCY = 5;

/**
 * Upload one in-memory result buffer to the permanent results path and return
 * its public URL. Used by sync provider adapters (e.g. ElevenLabs) that receive
 * raw bytes instead of a hosted URL. Mirrors the storage-path convention used by
 * mirrorMediaToStorage so node deletion never wipes a node's only output copy.
 */
export async function uploadResultBuffer(
  supabase: ReturnType<typeof createServiceClient>,
  buffer: Buffer,
  resultType: NodeResultType,
  ext: string,
  userId: string,
  sessionId: string,
  nodeId: string,
  index = 0
): Promise<string> {
  const now = Date.now();
  const storagePath = `${userId}/${sessionId}/results/${nodeId}/result_${now}_${index}.${ext}`;
  const { error: uploadError } = await supabase.storage.from('chat-assets').upload(storagePath, buffer, {
    contentType: WEBHOOK_MEDIA_CONTENT_TYPES[resultType],
    cacheControl: '3600',
    upsert: true,
  });
  if (uploadError) {
    throw new Error(`Supabase Storage upload failed: ${uploadError.message}`);
  }
  const { data: urlData } = supabase.storage.from('chat-assets').getPublicUrl(storagePath);
  return urlData.publicUrl;
}

export async function mirrorMediaToStorage(
  supabase: ReturnType<typeof createServiceClient>,
  urls: string[],
  resultType: NodeResultType,
  userId: string,
  sessionId: string,
  nodeId: string
): Promise<string[]> {
  const now = Date.now();
  const mirroredUrls: string[] = new Array(urls.length);

  const processOne = async (i: number): Promise<void> => {
    const sourceUrl = urls[i];

    if (!sourceUrl.startsWith('http')) {
      mirroredUrls[i] = sourceUrl;
      return;
    }

    const response = await fetchWithRetry(sourceUrl);
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const extMatch = sourceUrl.match(/\.(png|jpe?g|webp|gif|mp4|webm|mov|avi|mkv|mp3|wav|ogg|m4a|aac|flac|glb|gltf|obj|fbx|stl|usd|usdz)(\?|$)/i);
    const ext = extMatch?.[1]?.toLowerCase() || WEBHOOK_MEDIA_EXTENSIONS[resultType];
    const storagePath = `${userId}/${sessionId}/results/${nodeId}/result_${now}_${i}.${ext}`;

    const { error: uploadError } = await supabase.storage.from('chat-assets').upload(storagePath, buffer, {
      contentType: WEBHOOK_MEDIA_CONTENT_TYPES[resultType],
      cacheControl: '3600',
      upsert: true,
    });

    if (uploadError) {
      throw new Error(`Supabase Storage upload failed: ${uploadError.message}`);
    }

    const { data: urlData } = supabase.storage.from('chat-assets').getPublicUrl(storagePath);
    mirroredUrls[i] = urlData.publicUrl;
  };

  let cursor = 0;
  const workerCount = Math.min(MIRROR_CONCURRENCY, urls.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= urls.length) return;
      await processOne(i);
    }
  });
  await Promise.all(workers);

  return mirroredUrls;
}
```

- [ ] **Step 2: Update the webhook to import the shared helpers**

In `app/api/webhooks/replicate-v2/route.ts`:

Delete the now-duplicated definitions: the `WEBHOOK_MEDIA_EXTENSIONS` const (lines ~19-26), `WEBHOOK_MEDIA_CONTENT_TYPES` const (lines ~28-35), `fetchWithRetry` function (lines ~37-49), the `MIRROR_CONCURRENCY` const (line ~92), and the entire `mirrorMediaToStorage` function (lines ~94-159). Leave `isReplicateHostedUrl`, `finalizeFanOut`, `refundFailedIteration`, and `upsertPredictionRow` in place.

Add to the import block at the top (after the existing `import { clampIterations } ...` line):

```typescript
import { mirrorMediaToStorage } from '@/lib/workflow/media-mirror';
```

The `NodeResultType` import already exists in this file; keep it. The webhook's calls to `mirrorMediaToStorage(...)` are unchanged — they now resolve to the imported function.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (no errors). If it reports an unused `NodeResultType` import in the webhook, leave it — it is still used by `finalizeFanOut`'s `outputType: NodeResultType` parameter.

- [ ] **Step 4: Commit**

```bash
git add lib/workflow/media-mirror.ts app/api/webhooks/replicate-v2/route.ts
git commit -m "refactor(workflow): extract media-mirror helpers; add uploadResultBuffer"
```

---

### Task 4: ElevenLabs HTTP client

**Files:**
- Create: `lib/ai/elevenlabs-client.ts`

- [ ] **Step 1: Create the client**

```typescript
/**
 * ElevenLabs API client. Server-only — reads ELEVENLABS_API_KEY from env.
 * Text-to-speech is synchronous: it returns audio bytes directly (no webhook).
 */
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY || '';
const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';

if (!process.env.ELEVENLABS_API_KEY) {
  console.warn('[ElevenLabs] Warning: ELEVENLABS_API_KEY is not set in environment.');
}

export interface ElevenLabsVoiceSettings {
  stability?: number;
  similarity_boost?: number;
  style?: number;
  use_speaker_boost?: boolean;
}

export interface GenerateSpeechArgs {
  voiceId: string;
  text: string;
  modelId: string;
  voiceSettings?: ElevenLabsVoiceSettings;
  outputFormat?: string; // e.g. mp3_44100_128
}

export interface GeneratedSpeech {
  buffer: Buffer;
  ext: string;
  contentType: string;
}

function outputFormatToFile(outputFormat: string): { ext: string; contentType: string } {
  // ElevenLabs output_format values look like "mp3_44100_128", "pcm_16000",
  // "ulaw_8000". We only persist mp3 as a browser-playable file here; other
  // formats fall back to a .bin container (still downloadable). mp3 is the
  // default and the only format the preset offers.
  if (outputFormat.startsWith('mp3')) return { ext: 'mp3', contentType: 'audio/mpeg' };
  if (outputFormat.startsWith('wav')) return { ext: 'wav', contentType: 'audio/wav' };
  return { ext: 'mp3', contentType: 'audio/mpeg' };
}

/**
 * Synthesize speech. Returns the audio bytes; the caller uploads them to storage.
 * Throws with the ElevenLabs error body on a non-2xx response.
 */
export async function generateSpeech(args: GenerateSpeechArgs): Promise<GeneratedSpeech> {
  if (!ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY is not set');
  if (!args.voiceId) throw new Error('ElevenLabs: voiceId is required');
  if (!args.text || !args.text.trim()) throw new Error('ElevenLabs: text is required');

  const outputFormat = args.outputFormat || 'mp3_44100_128';
  const url = `${ELEVENLABS_BASE_URL}/text-to-speech/${encodeURIComponent(args.voiceId)}?output_format=${encodeURIComponent(outputFormat)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({
      text: args.text,
      model_id: args.modelId,
      ...(args.voiceSettings ? { voice_settings: args.voiceSettings } : {}),
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`ElevenLabs TTS failed (${res.status}): ${errText.slice(0, 300)}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const { ext, contentType } = outputFormatToFile(outputFormat);
  return { buffer, ext, contentType };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/ai/elevenlabs-client.ts
git commit -m "feat(ai): ElevenLabs HTTP client (generateSpeech)"
```

---

### Task 5: Provider adapter interface + registry + ElevenLabs adapter

**Files:**
- Create: `lib/ai/providers/types.ts`
- Create: `lib/ai/providers/elevenlabs.ts`
- Create: `lib/ai/providers/registry.ts`

- [ ] **Step 1: Create `lib/ai/providers/types.ts`**

```typescript
import { ExecutionContext, NodeExecutionResult } from '@/lib/nodes/types';

export interface ProviderAdapterModel {
  provider_model_id?: string | null;
  replicate_model_id?: string | null;
  inputs_schema?: any;
  outputs_schema?: any;
  [key: string]: any;
}

export interface ProviderAdapterArgs {
  /** The ai_models row (provider_model_id, schemas, etc.). */
  model: ProviderAdapterModel;
  /** API inputs already resolved by api_mapping_key (controls + input handles). */
  inputs: Record<string, any>;
  /** Fan-out index (0 for single runs); used to disambiguate storage paths. */
  iterationIndex: number;
  /** Execution context (executionId, sessionId, nodeId, ...). */
  ctx: ExecutionContext;
}

/**
 * A provider adapter knows the three things that differ per external provider:
 * how to authenticate, how to shape the request, and how to call the API. Sync
 * adapters upload their result bytes to storage and return a permanent { url }
 * in `data`, with status 'success' — which the dispatcher completes through the
 * same path as Replicate's local-sync results.
 */
export interface ProviderAdapter {
  key: string;                       // matches providers.adapter_key
  mode: 'sync' | 'async-webhook';
  execute(args: ProviderAdapterArgs): Promise<NodeExecutionResult>;
}
```

- [ ] **Step 2: Create `lib/ai/providers/elevenlabs.ts`**

```typescript
import { ProviderAdapter, ProviderAdapterArgs } from './types';
import { generateSpeech, ElevenLabsVoiceSettings } from '@/lib/ai/elevenlabs-client';
import { createServiceClient } from '@/lib/supabase/service';
import { uploadResultBuffer } from '@/lib/workflow/media-mirror';

/** Build voice_settings from the resolved control inputs, omitting undefined. */
function pickVoiceSettings(inputs: Record<string, any>): ElevenLabsVoiceSettings | undefined {
  const settings: ElevenLabsVoiceSettings = {};
  if (typeof inputs.stability === 'number') settings.stability = inputs.stability;
  if (typeof inputs.similarity_boost === 'number') settings.similarity_boost = inputs.similarity_boost;
  if (typeof inputs.style === 'number') settings.style = inputs.style;
  if (typeof inputs.use_speaker_boost === 'boolean') settings.use_speaker_boost = inputs.use_speaker_boost;
  return Object.keys(settings).length > 0 ? settings : undefined;
}

export const elevenlabsAdapter: ProviderAdapter = {
  key: 'elevenlabs',
  mode: 'sync',
  async execute({ model, inputs, iterationIndex, ctx }: ProviderAdapterArgs) {
    const voiceId = inputs['voice_id'];
    const text = inputs['text'];
    if (!voiceId) throw new Error('ElevenLabs: no voice selected (voice_id is empty)');
    if (!text || typeof text !== 'string' || !text.trim()) {
      throw new Error('ElevenLabs: text is required');
    }
    if (!ctx.nodeId) throw new Error('ElevenLabs adapter: missing nodeId in context');

    const modelId = model.provider_model_id || 'eleven_multilingual_v2';
    const outputFormat = typeof inputs['output_format'] === 'string' ? inputs['output_format'] : 'mp3_44100_128';
    const voiceSettings = pickVoiceSettings(inputs);

    const { buffer, ext } = await generateSpeech({ voiceId, text, modelId, voiceSettings, outputFormat });

    // Resolve the owning user + session for the permanent storage path.
    const supabase = createServiceClient();
    const { data: execCtx } = await supabase
      .from('executions')
      .select('session_id, sessions(user_id)')
      .eq('id', ctx.executionId)
      .single();
    const userId = (execCtx?.sessions as any)?.user_id || 'unknown_user';
    const sessionId = ctx.sessionId || execCtx?.session_id || 'unknown_session';

    const url = await uploadResultBuffer(supabase, buffer, 'audio', ext, userId, sessionId, ctx.nodeId, iterationIndex);

    // Return a hosted { url } with .mp3 extension. The dispatcher infers 'audio'
    // from the extension (detectMediaTypeFromUrl) and completes the node.
    return { success: true, status: 'success', data: { url } };
  },
};
```

- [ ] **Step 3: Create `lib/ai/providers/registry.ts`**

```typescript
import { ProviderAdapter } from './types';
import { elevenlabsAdapter } from './elevenlabs';

/**
 * Maps providers.adapter_key → server adapter. Add new external providers here.
 * A model whose provider has no entry falls through to the Replicate path.
 */
const adapters: Record<string, ProviderAdapter> = {
  [elevenlabsAdapter.key]: elevenlabsAdapter,
};

export function getProviderAdapter(key: string | null | undefined): ProviderAdapter | undefined {
  if (!key) return undefined;
  return adapters[key];
}
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/providers/types.ts lib/ai/providers/elevenlabs.ts lib/ai/providers/registry.ts
git commit -m "feat(ai): provider adapter seam + ElevenLabs TTS adapter"
```

---

### Task 6: Fork the AI generator executor to the adapter path

**Files:**
- Modify: `lib/nodes/plugins/ai_generator/executor.server.ts`

- [ ] **Step 1: Add the adapter import**

At the top of `lib/nodes/plugins/ai_generator/executor.server.ts`, after the existing imports (after the `createServiceClient` import line), add:

```typescript
import { getProviderAdapter } from '@/lib/ai/providers/registry';
```

- [ ] **Step 2: Select the new columns + provider adapter_key**

Replace the DB fetch (currently `.select('replicate_model_id, inputs_schema, outputs_schema')`) with:

```typescript
        const { data: model, error: dbError } = await adminSupabase
            .from('ai_models')
            .select('replicate_model_id, provider_model_id, inputs_schema, outputs_schema, providers(adapter_key)')
            .eq('id', model_id)
            .single();
```

- [ ] **Step 3: Insert the adapter fork after input validation, before the Replicate token check**

Find the line:
```typescript
        if (!process.env.REPLICATE_API_TOKEN) throw new Error('Replicate API token missing');
```
Immediately **before** that line, insert:

```typescript
        // ── External provider adapter fork ──────────────────────────────────
        // If this model's provider has a registered code adapter (ElevenLabs,
        // etc.), run it instead of the Replicate path. The inputs map built above
        // (`replicateInputs`, keyed by api_mapping_key) is the provider-agnostic
        // payload. Sync adapters upload their bytes and return a hosted { url };
        // the dispatcher completes the node via its sync-success path.
        const adapterKey = (model as any)?.providers?.adapter_key as string | undefined;
        const adapter = getProviderAdapter(adapterKey);
        if (adapter) {
            return await adapter.execute({
                model: model as any,
                inputs: replicateInputs,
                iterationIndex: typeof context.predictionIndex === 'number' ? context.predictionIndex : 0,
                ctx: context,
            });
        }
        // ── End adapter fork; below is the unchanged Replicate path ──────────
```

(Everything below — the Replicate token check, webhook URL build, model-id parse, `replicate.run` / `predictions.create` — is unchanged and only runs for non-adapter models.)

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS. (Note: `model.replicate_model_id` is used later by the Replicate path and may now be `null` in the type; it is only reached for non-adapter models. If tsc complains about `model.replicate_model_id` being possibly null at `.split(...)`, add a guard right after the adapter fork: `if (!model.replicate_model_id) throw new Error('Model has no replicate_model_id and no provider adapter');`.)

- [ ] **Step 5: Add the safety guard from Step 4's note (always include it)**

Immediately after the adapter fork block you inserted, add:

```typescript
        if (!model.replicate_model_id) {
            throw new Error(`Model ${model_id} has no replicate_model_id and no provider adapter`);
        }
```

- [ ] **Step 6: Type-check again**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/nodes/plugins/ai_generator/executor.server.ts
git commit -m "feat(executor): fork ai_generator to provider adapter by adapter_key"
```

---

### Task 6B: Refund failed iterations on the synchronous fan-out path

**Why:** ElevenLabs runs synchronously, so a fan-out (`iterations > 1`) resolves entirely inside `dispatchReplicateNode`'s `!anyPending` branch. That branch currently aggregates the *successful* iterations and silently drops failures — fine when it was Replicate-dev-only, but ElevenLabs makes it the **production** path. The upfront debit charged for all N iterations, so dropped failures must be refunded or balances drift (see CLAUDE.md: "Don't add a generative dispatch path that skips the debit/refund accounting"). We extract the existing, already-correct `refundFailedIteration` into a shared module and call it for each failed iteration.

**Files:**
- Create: `lib/workflow/refund.ts`
- Modify: `app/api/webhooks/replicate-v2/route.ts`
- Modify: `lib/workflow/dispatch-v2.ts`

- [ ] **Step 1: Create `lib/workflow/refund.ts` (moved verbatim from the webhook)**

```typescript
import { createServiceClient } from '@/lib/supabase/service';
import { clampIterations } from '@/lib/billing/cost';

/**
 * Refund a single failed fan-out iteration. The upfront debit charged
 * cost_by_node[nodeId] (which already includes the iteration multiplier), so one
 * iteration's share is that value / iterations. Sourced from the persisted
 * execution_debit ledger metadata so it can't drift from what was charged.
 * Idempotent per (execution, node, prediction_index) via the credit_tokens key.
 */
export async function refundFailedIteration(
  supabase: ReturnType<typeof createServiceClient>,
  executionId: string,
  nodeId: string,
  predictionIndex: number
): Promise<void> {
  const { data: debitRow } = await supabase
    .from('token_ledger')
    .select('user_id, metadata')
    .eq('execution_id', executionId)
    .eq('reason', 'execution_debit')
    .maybeSingle();
  if (!debitRow?.user_id) return; // nothing was charged (cost 0) → nothing to refund

  const costByNode = (debitRow.metadata as any)?.cost_by_node ?? {};
  const nodeTotal = Number(costByNode[nodeId]);
  if (!Number.isFinite(nodeTotal) || nodeTotal <= 0) return;

  const { data: exec } = await supabase
    .from('executions')
    .select('graph_json')
    .eq('id', executionId)
    .single();
  const graphNodes = (exec?.graph_json as any)?.nodes ?? [];
  const node = graphNodes.find((n: any) => n.id === nodeId);
  const iterations = clampIterations(node?.data?.config?.iterations ?? node?.config?.iterations);
  const perIteration = nodeTotal / iterations;
  if (!(perIteration > 0)) return;

  const { error } = await supabase.rpc('credit_tokens', {
    p_user_id: debitRow.user_id,
    p_amount: perIteration,
    p_reason: 'execution_partial_refund',
    p_idempotency_key: `refund:${executionId}:${nodeId}:${predictionIndex}`,
    p_execution_id: executionId,
    p_stripe_event_id: null,
    p_metadata: { node_id: nodeId, prediction_index: predictionIndex, reason: 'iteration_failed' },
  });
  if (error) {
    console.error(`[refund] Partial refund failed for ${nodeId}#${predictionIndex}:`, error.message);
  }
}
```

- [ ] **Step 2: Replace the webhook's local copy with the import**

In `app/api/webhooks/replicate-v2/route.ts`, delete the entire `refundFailedIteration` function definition (the block with the doc-comment starting "Refund a single failed fan-out iteration." through its closing brace, ~lines 161-213). Add to the import block:

```typescript
import { refundFailedIteration } from '@/lib/workflow/refund';
```

The webhook's existing calls to `refundFailedIteration(...)` now resolve to the import. (`clampIterations` is still used elsewhere in the webhook — keep its import.)

- [ ] **Step 3: Refund failed iterations in the dispatch sync fan-out branch**

In `lib/workflow/dispatch-v2.ts`, add the import near the top imports (after `import { checkAndDispatchChildren, handleNodeFailure } from './orchestrator';`):

```typescript
import { refundFailedIteration } from './refund';
```

Then, inside `dispatchReplicateNode`, in the `if (!anyPending) {` branch, locate:
```typescript
        if (aggregated.length === 0) throw new Error('All iterations failed');
```
Immediately **before** that line, insert a refund loop for any failed iterations:
```typescript
        // Synchronous fan-out (e.g. ElevenLabs): failed iterations were charged
        // upfront but produce no result here, so refund each one. Mirrors the
        // per-iteration refund the Replicate webhook does on the async path.
        const syncRefundClient = createServiceClient();
        await Promise.all(
            results.map((r, i) =>
                (!r.success || r.status !== 'success')
                    ? refundFailedIteration(syncRefundClient, executionId, nodeId, i)
                    : Promise.resolve()
            )
        );
```
(`createServiceClient` is already imported at the top of `dispatch-v2.ts`.)

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/workflow/refund.ts app/api/webhooks/replicate-v2/route.ts lib/workflow/dispatch-v2.ts
git commit -m "fix(billing): refund failed iterations on synchronous fan-out path"
```

---

## Phase 2 — Voice catalog API + sync

### Task 7: Voices list API route

**Files:**
- Create: `app/api/voices/list/route.ts`

- [ ] **Step 1: Create the route**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';

/**
 * GET /api/voices/list
 * Query params:
 *   q          - free text (matched against name, ilike)
 *   provider   - provider_id (default: 'elevenlabs')
 *   gender, language, category, use_case - exact-match filters
 *   external_id - return a single voice by its external_voice_id (for resolving
 *                 a selected voice's display name)
 *   page (0-based), page_size (default 60, max 120)
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;

    const { searchParams } = new URL(req.url);
    const q = searchParams.get('q')?.trim();
    const provider = searchParams.get('provider') || 'elevenlabs';
    const externalId = searchParams.get('external_id');
    const gender = searchParams.get('gender');
    const language = searchParams.get('language');
    const category = searchParams.get('category');
    const useCase = searchParams.get('use_case');
    const page = Math.max(0, parseInt(searchParams.get('page') || '0', 10) || 0);
    const pageSize = Math.min(120, Math.max(1, parseInt(searchParams.get('page_size') || '60', 10) || 60));

    let query = auth.supabase
      .from('voices')
      .select('id, external_voice_id, name, description, gender, age, accent, language, use_case, category, preview_url, labels')
      .eq('is_active', true)
      .eq('provider_id', provider);

    if (externalId) {
      query = query.eq('external_voice_id', externalId);
    } else {
      if (q) query = query.ilike('name', `%${q}%`);
      if (gender) query = query.eq('gender', gender);
      if (language) query = query.eq('language', language);
      if (category) query = query.eq('category', category);
      if (useCase) query = query.eq('use_case', useCase);
    }

    const from = page * pageSize;
    const to = from + pageSize - 1;
    query = query.order('name', { ascending: true }).range(from, to);

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ voices: data || [], hasMore: (data?.length || 0) === pageSize });
  } catch (err: any) {
    console.error('[Voices List API] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/voices/list/route.ts
git commit -m "feat(api): /api/voices/list (search + filter + paginate)"
```

---

### Task 8: ElevenLabs voice sync script

**Files:**
- Create: `scripts/sync-elevenlabs-voices.js`

- [ ] **Step 1: Create the script**

This is a standalone Node script (matches the repo's `scripts/` convention — run directly with `node`, reads `.env.local`). It is self-contained JS (no TS imports).

```javascript
/**
 * Seed/refresh the `voices` table from ElevenLabs.
 *
 * Pulls:
 *   - GET /v1/voices         → premade + your account's own voices (reliable to generate with)
 *   - GET /v1/shared-voices  → a slice of the community shared library (breadth)
 *
 * NOTE: A shared-library voice generally must be ADDED to your ElevenLabs account
 * before TTS generation with its voice_id will succeed. Premade + owned voices
 * always work. Shared voices are stored for browsing; if generation fails for a
 * shared voice, add it to your account in ElevenLabs and re-run this script.
 *
 * Usage: node scripts/sync-elevenlabs-voices.js
 * Env (from .env.local): ELEVENLABS_API_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PROVIDER_ID = 'elevenlabs';
const BASE = 'https://api.elevenlabs.io/v1';
// How many shared-library voices to pull (in pages of 100).
const SHARED_TARGET = 300;

if (!ELEVENLABS_API_KEY) { console.error('Missing ELEVENLABS_API_KEY'); process.exit(1); }
if (!SUPABASE_URL || !SERVICE_KEY) { console.error('Missing Supabase env'); process.exit(1); }

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

function mapVoice(v, category) {
  const labels = v.labels || {};
  return {
    provider_id: PROVIDER_ID,
    external_voice_id: v.voice_id,
    name: v.name || v.voice_id,
    description: v.description || null,
    gender: labels.gender || v.gender || null,
    age: labels.age || v.age || null,
    accent: labels.accent || v.accent || null,
    language: labels.language || v.language || null,
    use_case: labels.use_case || labels['use case'] || v.use_case || null,
    category: v.category || category,
    preview_url: v.preview_url || null,
    labels,
    is_active: true,
    updated_at: new Date().toISOString(),
  };
}

async function upsertBatch(rows) {
  if (rows.length === 0) return;
  const { error } = await supabase
    .from('voices')
    .upsert(rows, { onConflict: 'provider_id,external_voice_id' });
  if (error) throw new Error(`voices upsert failed: ${error.message}`);
}

async function fetchPremadeAndOwned() {
  const res = await fetch(`${BASE}/voices`, { headers: { 'xi-api-key': ELEVENLABS_API_KEY } });
  if (!res.ok) throw new Error(`GET /voices failed (${res.status}): ${await res.text()}`);
  const json = await res.json();
  const voices = json.voices || [];
  console.log(`[sync] /voices returned ${voices.length} voices`);
  await upsertBatch(voices.map((v) => mapVoice(v, v.category || 'premade')));
  return voices.length;
}

async function fetchSharedLibrary() {
  let collected = 0;
  let page = 0;
  const pageSize = 100;
  while (collected < SHARED_TARGET) {
    const url = `${BASE}/shared-voices?page_size=${pageSize}&page=${page}`;
    const res = await fetch(url, { headers: { 'xi-api-key': ELEVENLABS_API_KEY } });
    if (!res.ok) {
      console.warn(`[sync] /shared-voices page ${page} failed (${res.status}) — stopping shared sync.`);
      break;
    }
    const json = await res.json();
    const voices = json.voices || [];
    if (voices.length === 0) break;
    await upsertBatch(voices.map((v) => mapVoice(v, 'shared')));
    collected += voices.length;
    console.log(`[sync] shared page ${page}: +${voices.length} (total ${collected})`);
    if (json.has_more === false) break;
    page += 1;
  }
  return collected;
}

(async () => {
  try {
    const a = await fetchPremadeAndOwned();
    const b = await fetchSharedLibrary();
    const { count } = await supabase.from('voices').select('*', { count: 'exact', head: true });
    console.log(`[sync] Done. premade/owned=${a}, shared=${b}. Total rows now: ${count}`);
    process.exit(0);
  } catch (err) {
    console.error('[sync] ERROR:', err.message);
    process.exit(1);
  }
})();
```

- [ ] **Step 2: Verify `dotenv` is available**

Run: `node -e "require('dotenv'); console.log('dotenv ok')"`
Expected: prints `dotenv ok`. If it errors with "Cannot find module 'dotenv'", check how other `scripts/*.js` load env (e.g. grep for `dotenv` in `scripts/`) and match that pattern; install only if the other scripts rely on it being present.

- [ ] **Step 3: Run the sync against your live/local env (operator step)**

Run: `node scripts/sync-elevenlabs-voices.js`
Expected: logs `/voices returned N`, shared pages, and `Done. ... Total rows now: M` with M > 0. (Requires `ELEVENLABS_API_KEY` in `.env.local`.)

- [ ] **Step 4: Commit**

```bash
git add scripts/sync-elevenlabs-voices.js
git commit -m "feat(scripts): sync ElevenLabs voices into voices table"
```

---

## Phase 3 — Voice picker UI

### Task 9: Register the `voice_picker` control type

**Files:**
- Modify: `lib/nodes/types.ts`
- Modify: `components/admin/ModelForm.tsx`

- [ ] **Step 1: Extend the `Control['component']` union**

In `lib/nodes/types.ts`, the `Control` interface `component` field currently ends with `| 'threshold'`. Change it to include `voice_picker`:

```typescript
    component: 'text_input' | 'textarea' | 'slider' | 'number_input' | 'checkbox' | 'select' | 'prompt_textarea' | 'negative_prompt' | 'aspect_ratio' | 'resolution' | 'format' | 'reverse' | 'threshold' | 'voice_picker';
```

- [ ] **Step 2: Add it to the admin component dictionary**

In `components/admin/ModelForm.tsx`, add an entry to `COMPONENT_DICTIONARY` (after the `threshold` entry, before the closing `];`):

```typescript
    { id: 'voice_picker', label: 'Voice Picker (ElevenLabs)', type: 'string', default_value: '' },
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/nodes/types.ts components/admin/ModelForm.tsx
git commit -m "feat(controls): register voice_picker control type"
```

---

### Task 10: Voice picker modal component

**Files:**
- Create: `components/editor/VoicePickerModal.tsx`

- [ ] **Step 1: Create the modal**

```tsx
'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Search, Play, Pause, X, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface VoiceRecord {
  id: string;
  external_voice_id: string;
  name: string;
  description?: string | null;
  gender?: string | null;
  accent?: string | null;
  language?: string | null;
  use_case?: string | null;
  category?: string | null;
  preview_url?: string | null;
}

interface VoicePickerModalProps {
  open: boolean;
  onClose: () => void;
  selectedExternalId?: string;
  onSelect: (voice: VoiceRecord) => void;
}

const CATEGORY_FILTERS = ['', 'premade', 'professional', 'shared', 'cloned'];

export function VoicePickerModal({ open, onClose, selectedExternalId, onSelect }: VoicePickerModalProps) {
  const [voices, setVoices] = useState<VoiceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const fetchVoices = useCallback(async (reset: boolean) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (category) params.set('category', category);
      params.set('page', String(reset ? 0 : page));
      params.set('page_size', '60');
      const res = await fetch(`/api/voices/list?${params.toString()}`);
      const data = await res.json();
      const next: VoiceRecord[] = data.voices || [];
      setVoices((prev) => (reset ? next : [...prev, ...next]));
      setHasMore(!!data.hasMore);
    } finally {
      setLoading(false);
    }
  }, [q, category, page]);

  // Reset + refetch when the search/filter changes (debounced for text).
  useEffect(() => {
    if (!open) return;
    setPage(0);
    const t = setTimeout(() => fetchVoices(true), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, category, open]);

  // Stop audio when the modal closes.
  useEffect(() => {
    if (!open && audioRef.current) {
      audioRef.current.pause();
      setPlayingId(null);
    }
  }, [open]);

  const togglePreview = (voice: VoiceRecord) => {
    if (!voice.preview_url) return;
    if (!audioRef.current) audioRef.current = new Audio();
    const el = audioRef.current;
    if (playingId === voice.external_voice_id) {
      el.pause();
      setPlayingId(null);
      return;
    }
    el.src = voice.preview_url;
    el.play().then(() => setPlayingId(voice.external_voice_id)).catch(() => setPlayingId(null));
    el.onended = () => setPlayingId(null);
  };

  const loadMore = () => {
    setPage((p) => p + 1);
    // fetch the next page (append) on the new page value
    setTimeout(() => fetchVoices(false), 0);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="w-full max-w-3xl max-h-[80vh] flex flex-col bg-surface-elevated border border-stroke-subtle rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-stroke-subtle">
          <Search className="w-4 h-4 text-content-tertiary" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search voices…"
            className="flex-1 bg-transparent text-sm text-content-primary placeholder:text-content-tertiary/50 focus:outline-none"
          />
          <button onClick={onClose} className="p-1 rounded-md hover:bg-white/10 text-content-tertiary">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-1.5 px-4 py-2 border-b border-stroke-subtle/60 overflow-x-auto">
          {CATEGORY_FILTERS.map((c) => (
            <button
              key={c || 'all'}
              onClick={() => setCategory(c)}
              className={cn(
                'px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap transition-colors',
                category === c ? 'bg-accent-primary text-white' : 'bg-white/5 text-content-tertiary hover:bg-white/10'
              )}
            >
              {c === '' ? 'All' : c}
            </button>
          ))}
        </div>

        {/* Grid */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
          {voices.map((voice) => {
            const isSelected = voice.external_voice_id === selectedExternalId;
            const isPlaying = playingId === voice.external_voice_id;
            return (
              <div
                key={voice.id}
                className={cn(
                  'relative flex flex-col gap-1 p-2.5 rounded-xl border cursor-pointer transition-all',
                  isSelected ? 'border-accent-primary bg-accent-primary/10' : 'border-white/10 bg-white/5 hover:bg-white/[0.08]'
                )}
                onClick={() => onSelect(voice)}
              >
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-bold text-content-primary truncate">{voice.name}</span>
                  {isSelected && <Check className="w-3.5 h-3.5 text-accent-primary shrink-0" />}
                </div>
                <div className="flex flex-wrap gap-1">
                  {[voice.gender, voice.accent, voice.use_case].filter(Boolean).map((tag, i) => (
                    <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-white/10 text-content-tertiary uppercase tracking-wide">
                      {tag}
                    </span>
                  ))}
                </div>
                <button
                  onClick={(e) => { e.stopPropagation(); togglePreview(voice); }}
                  disabled={!voice.preview_url}
                  className={cn(
                    'mt-1 inline-flex items-center gap-1 self-start px-2 py-0.5 rounded-md text-[10px] font-semibold',
                    voice.preview_url ? 'bg-white/10 hover:bg-white/20 text-content-secondary' : 'opacity-30 cursor-not-allowed text-content-tertiary'
                  )}
                >
                  {isPlaying ? <Pause className="w-2.5 h-2.5" /> : <Play className="w-2.5 h-2.5" />}
                  {isPlaying ? 'Stop' : 'Preview'}
                </button>
              </div>
            );
          })}
          {voices.length === 0 && !loading && (
            <div className="col-span-full text-center text-xs text-content-tertiary py-8">No voices found.</div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-stroke-subtle/60 flex items-center justify-between">
          <span className="text-[11px] text-content-tertiary">{loading ? 'Loading…' : `${voices.length} voices`}</span>
          {hasMore && (
            <button onClick={loadMore} className="px-3 py-1 rounded-lg bg-white/5 hover:bg-white/10 text-xs font-semibold text-content-secondary">
              Load more
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS. (If `cn` is not at `@/lib/utils`, confirm its location via the existing import in `properties.tsx` — it imports `cn` from `@/lib/utils`, so this matches.)

- [ ] **Step 3: Commit**

```bash
git add components/editor/VoicePickerModal.tsx
git commit -m "feat(ui): VoicePickerModal (search, filters, audio preview)"
```

---

### Task 11: Voice picker control + wire into properties

**Files:**
- Create: `lib/nodes/plugins/ai_generator/VoicePickerControl.tsx`
- Modify: `lib/nodes/plugins/ai_generator/properties.tsx`

- [ ] **Step 1: Create the control component**

```tsx
'use client';

import React, { useEffect, useState } from 'react';
import { Mic, ChevronDown } from 'lucide-react';
import { VoicePickerModal, VoiceRecord } from '@/components/editor/VoicePickerModal';

interface VoicePickerControlProps {
  label: string;
  value: any;                 // the stored external_voice_id
  onChange: (val: string) => void;
}

/**
 * Renders a button showing the selected voice's name and opens the
 * VoicePickerModal. Stores only the external_voice_id in control_values; the
 * display name is resolved by querying /api/voices/list?external_id=... so no
 * extra fields leak into the API payload.
 */
export function VoicePickerControl({ label, value, onChange }: VoicePickerControlProps) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<VoiceRecord | null>(null);

  // Resolve the selected voice's display name from its stored id.
  useEffect(() => {
    let cancelled = false;
    if (!value) { setSelected(null); return; }
    if (selected?.external_voice_id === value) return;
    fetch(`/api/voices/list?external_id=${encodeURIComponent(String(value))}`)
      .then((r) => r.json())
      .then((data) => { if (!cancelled) setSelected((data.voices && data.voices[0]) || null); })
      .catch(() => { /* leave name unresolved; button shows the id */ });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const minimalLabelClass = 'text-[8px] font-bold text-content-tertiary uppercase tracking-[0.1em] pl-0.5 leading-none opacity-80';

  return (
    <div className="space-y-1">
      <label className={minimalLabelClass}>{label}</label>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full flex items-center justify-between gap-2 bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-content-primary text-xs hover:bg-white/[0.08] transition-colors"
      >
        <span className="flex items-center gap-1.5 min-w-0">
          <Mic className="w-3 h-3 text-accent-primary shrink-0" />
          <span className="truncate">{selected?.name || (value ? String(value) : 'Choose a voice…')}</span>
        </span>
        <ChevronDown className="w-3 h-3 text-content-tertiary shrink-0" />
      </button>
      <VoicePickerModal
        open={open}
        onClose={() => setOpen(false)}
        selectedExternalId={value ? String(value) : undefined}
        onSelect={(voice) => {
          setSelected(voice);
          onChange(voice.external_voice_id);
          setOpen(false);
        }}
      />
    </div>
  );
}
```

- [ ] **Step 2: Render it in `ControlRenderer`**

In `lib/nodes/plugins/ai_generator/properties.tsx`:

Add the import near the other imports (after the `import { Tooltip } ...` line):

```typescript
import { VoicePickerControl } from './VoicePickerControl';
```

In the `switch (control.component)` block inside `ControlRenderer`, add a new case **before** `case 'text_input':`:

```typescript
        case 'voice_picker':
            return (
                <VoicePickerControl
                    label={label}
                    value={value}
                    onChange={val => onChange(control.api_mapping_key, val)}
                />
            );
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/nodes/plugins/ai_generator/VoicePickerControl.tsx lib/nodes/plugins/ai_generator/properties.tsx
git commit -m "feat(ui): voice_picker control wired into node properties"
```

---

## Phase 4 — Admin authoring

### Task 12: Provider `adapter_key` (form + routes)

**Files:**
- Modify: `app/api/admin/providers/route.ts`
- Modify: `app/api/admin/providers/[id]/route.ts`

The provider create route uses `formData` (for logo upload). Add `adapter_key` as an optional text field.

- [ ] **Step 1: Accept `adapter_key` on provider create (POST)**

In `app/api/admin/providers/route.ts`, in `POST`, after `const logoFile = formData.get('logo') as File | null;` add:

```typescript
        const adapterKeyRaw = (formData.get('adapter_key') as string | null)?.trim();
        const adapter_key = adapterKeyRaw ? adapterKeyRaw : null;
```

Then change the insert from `.insert([{ id, name, logo_url: logoUrl }])` to:

```typescript
            .insert([{ id, name, logo_url: logoUrl, adapter_key }])
```

- [ ] **Step 2: Accept `adapter_key` on provider update (PATCH)**

In `app/api/admin/providers/[id]/route.ts` (the `PATCH` handler uses `formData`). After the line `const logoFile = formData.get('logo') as File | null;` add:

```typescript
        const adapterKeyRaw = (formData.get('adapter_key') as string | null)?.trim();
        const adapter_key = adapterKeyRaw ? adapterKeyRaw : null;
```

Then change the update call from:
```typescript
            .update({ name, logo_url: logoUrl, updated_at: new Date().toISOString() })
```
to:
```typescript
            .update({ name, logo_url: logoUrl, adapter_key, updated_at: new Date().toISOString() })
```

- [ ] **Step 3: Add an `adapter_key` input to the provider admin form**

In `app/admin/page.tsx`:

(i) Extend the `providerForm` state (~line 583) to include `adapter_key`:
```typescript
    const [providerForm, setProviderForm] = useState({
        name: '',
        logo: null as File | null,
        adapter_key: ''
    });
```

(ii) Append it in `handleProviderSubmit` (after `formData.append('name', providerForm.name);`, ~line 700):
```typescript
            formData.append('adapter_key', providerForm.adapter_key || '');
```

(iii) Every full-object `setProviderForm({...})` reset must now include `adapter_key` (TypeScript requires it since the state shape changed). Update all three full-literal resets:
- In `handleProviderSubmit` (~line 714): `setProviderForm({ name: '', logo: null, adapter_key: '' });`
- In the "cancel edit" handler (~line 1053): `setProviderForm({ name: '', logo: null, adapter_key: '' });`
- In the edit-prefill (~line 1135): `setProviderForm({ name: prov.name, logo: null, adapter_key: prov.adapter_key || '' });`
(The partial-spread calls like `setProviderForm({ ...providerForm, name: ... })` need no change.)

(iv) Add the input to the provider form JSX. Immediately **after** the "Provider Name" `<Input ... />` block (the one ending `required` then `/>` at ~line 1070), inside the same `<div className="grid grid-cols-1 md:grid-cols-2 gap-8">`, add:
```tsx
                                            <Input
                                                label="Adapter Key (blank = Replicate)"
                                                value={providerForm.adapter_key}
                                                onChange={e => setProviderForm({ ...providerForm, adapter_key: e.target.value })}
                                                placeholder="e.g. elevenlabs"
                                            />
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/providers/route.ts "app/api/admin/providers/[id]/route.ts" app/admin/page.tsx
git commit -m "feat(admin): provider adapter_key field + routes"
```

---

### Task 13: Model `provider_model_id` passthrough + external preset

**Files:**
- Modify: `app/api/admin/models/route.ts`
- Modify: `app/api/admin/models/[id]/route.ts`
- Modify: `app/api/models/list/route.ts`
- Modify: `components/admin/ModelForm.tsx`

- [ ] **Step 1: Pass `provider_model_id` through the create route**

In `app/api/admin/models/route.ts`:
- Add `provider_model_id` to the destructured `body`:
```typescript
        const {
            replicate_model_id,
            display_name,
            category_id,
            node_type_id,
            archetype_id,
            credit_cost,
            is_active,
            inputs_schema,
            outputs_schema,
            provider_id,
            provider_model_id,
            description
        } = body;
```
- Relax the required-fields check so adapter models (no `replicate_model_id`) are allowed when a `provider_id` is present:
```typescript
        if (!display_name || !category_id || !archetype_id) {
            return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
        }
        if (!replicate_model_id && !provider_id) {
            return NextResponse.json({ error: 'Provide a replicate_model_id or a provider' }, { status: 400 });
        }
```
- Add `provider_model_id` to the `.insert({...})` object (after `provider_id`):
```typescript
                provider_id,
                provider_model_id: provider_model_id || null,
```

- [ ] **Step 2: Pass `provider_model_id` through the update route**

In `app/api/admin/models/[id]/route.ts`:
- Add `provider_model_id` to the destructured `body`.
- Add it to the `.update({...})` object (after `provider_id`):
```typescript
                provider_id,
                provider_model_id: provider_model_id ?? null,
```

- [ ] **Step 3: Expose `adapter_key` to the client model list**

In `app/api/models/list/route.ts`, change the select to include `adapter_key` on the joined provider (and `provider_model_id` is covered by `*`):
```typescript
            .select('*, providers(name, logo_url, adapter_key)')
```

- [ ] **Step 4: Add a `provider_model_id` field + external preset to `ModelForm`**

In `components/admin/ModelForm.tsx`:

**(a)** Add `provider_model_id` to the **initial** `useState({...})` form initializer (after the `provider_id: initialData?.provider_id || '',` line, ~line 141):
```typescript
        provider_model_id: initialData?.provider_model_id || '',
```
And add the same to the `initialData` re-hydration `setForm({...})` inside the `useEffect(() => { if (initialData) {...} }, [initialData])` (after the `provider_id: initialData.provider_id || '',` line, ~line 172):
```typescript
                provider_model_id: initialData.provider_model_id || '',
```

**(b)** Add derived flags and the preset handler. Insert immediately **before** `const handleSubmit = async (e: React.FormEvent) => {` (~line 407):
```typescript
    const selectedProvider = providers.find((p: any) => p.id === form.provider_id);
    const isExternalProvider = !!selectedProvider?.adapter_key;

    const applyElevenLabsPreset = () => {
        setVisualControls([
            { id: 'c_text', api_mapping_key: 'text', label: 'Text', type: 'string', component: 'prompt_textarea', default_value: '', is_visible: true },
            { id: 'c_voice', api_mapping_key: 'voice_id', label: 'Voice', type: 'string', component: 'voice_picker', default_value: '', is_visible: true },
            { id: 'c_stability', api_mapping_key: 'stability', label: 'Stability', type: 'number', component: 'slider', default_value: 0.5, is_visible: true, min: 0, max: 1, step: 0.01 },
            { id: 'c_similarity', api_mapping_key: 'similarity_boost', label: 'Similarity', type: 'number', component: 'slider', default_value: 0.75, is_visible: true, min: 0, max: 1, step: 0.01 },
            { id: 'c_style', api_mapping_key: 'style', label: 'Style', type: 'number', component: 'slider', default_value: 0, is_visible: true, min: 0, max: 1, step: 0.01 },
            { id: 'c_format', api_mapping_key: 'output_format', label: 'Output format', type: 'string', component: 'select', default_value: 'mp3_44100_128', is_visible: false, options: ['mp3_44100_128', 'mp3_44100_64'] },
        ] as any);
    };
```

**(c)** The submit payload already carries the new field: `handleSubmit` calls `onSubmit({ ...form, ... })` and `provider_model_id` is now in `form`, so **no submit change is needed**.

**(d)** Make the Replicate Model ID optional for external providers and disable Fetch Schema for them. In the "Model Identification" `FormSection`:
- Change the Replicate Model ID `<Input ... required />` (~line 462) to `required={!isExternalProvider}`.
- Change the Fetch Schema button's `disabled={isFetchingSchema || !form.replicate_model_id}` (~line 468) to `disabled={isFetchingSchema || !form.replicate_model_id || isExternalProvider}`.

**(e)** Add the `provider_model_id` input + preset button. Inside the "Classification" `FormSection`, immediately **after** the closing `/>` of the "AI Provider" `<Select ...>` (the one ending `onChange={e => setForm({ ...form, provider_id: e.target.value === 'none' ? '' : e.target.value })}` at ~line 530) and still inside its wrapping `<div className="grid ...">`, add:
```tsx
                    {isExternalProvider && (
                        <Input
                            label="Provider model id (e.g. eleven_v3)"
                            name="provider_model_id"
                            value={form.provider_model_id}
                            onChange={e => setForm({ ...form, provider_model_id: e.target.value })}
                            placeholder="eleven_v3"
                        />
                    )}
```
Then, immediately **after** that grid's closing `</div>` but before the `FormSection` closes, add the preset button:
```tsx
                {isExternalProvider && (
                    <div className="mt-3">
                        <button type="button" onClick={applyElevenLabsPreset} className="text-[10px] font-black uppercase tracking-widest px-3 py-2 rounded-lg bg-accent-primary/10 text-accent-primary border border-accent-primary/30 hover:bg-accent-primary/20 transition-all">
                            Apply ElevenLabs speech preset
                        </button>
                    </div>
                )}
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/models/route.ts "app/api/admin/models/[id]/route.ts" app/api/models/list/route.ts components/admin/ModelForm.tsx
git commit -m "feat(admin): provider_model_id passthrough + ElevenLabs preset"
```

---

## Phase 5 — Graceful degradation + ops/docs

### Task 14: Graceful handling of a deactivated/missing model

The old Replicate speech model will be deactivated. A saved workflow node still references its `model_id`. The executor's existing `.single()` fetch throws "Model not found or inactive" — but `.single()` returns an error for 0 rows only if the row is truly gone; a deactivated (still-present) row is still returned. To make BOTH cases (deleted row, deactivated row) degrade to a clear user-facing error rather than a confusing crash, add an explicit active check.

**Files:**
- Modify: `lib/nodes/plugins/ai_generator/executor.server.ts`

- [ ] **Step 1: Select `is_active` and fail clearly when inactive**

Change the model select (from Task 6 Step 2) to also fetch `is_active` and `display_name`:
```typescript
            .select('replicate_model_id, provider_model_id, is_active, display_name, inputs_schema, outputs_schema, providers(adapter_key)')
```
Immediately after the existing `if (dbError || !model) throw ...` line, add:
```typescript
        if (model.is_active === false) {
            throw new Error(`Model "${model.display_name || model_id}" is no longer available. Pick a different model.`);
        }
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/nodes/plugins/ai_generator/executor.server.ts
git commit -m "feat(executor): clear error when a referenced model is deactivated"
```

---

### Task 15: Env + docs + full type-check + manual E2E checklist

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Document `ELEVENLABS_API_KEY` and the adapter seam in CLAUDE.md**

In `CLAUDE.md`, in the "Required env" sentence (the paragraph beginning "Required env (in `.env.local`)"), add `ELEVENLABS_API_KEY` (ElevenLabs direct-API speech/audio adapter) to the list.

In the "Things that bite" section, add a bullet:
```markdown
- **External provider adapters** ([lib/ai/providers/](lib/ai/providers/)) — a model whose `providers.adapter_key` is set runs through a code adapter (e.g. ElevenLabs, synchronous) instead of Replicate. The adapter uploads result bytes via [lib/workflow/media-mirror.ts](lib/workflow/media-mirror.ts) and returns a hosted `{ url }`; the dispatcher completes it through the same sync path as Replicate's local run. Replicate models (no `adapter_key`) are unchanged. Voices for the speech picker live in the `voices` table — seed with `node scripts/sync-elevenlabs-voices.js`.
```

- [ ] **Step 2: Full type-check**

Run: `npx tsc --noEmit`
Expected: PASS with no errors.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document ELEVENLABS_API_KEY + provider adapter seam"
```

- [ ] **Step 4: Operator/manual E2E checklist (run in the app)**

Do these once, in order, against a running dev server (`npm run dev`) with `ELEVENLABS_API_KEY` set and the two migrations applied:

1. **Seed voices:** `node scripts/sync-elevenlabs-voices.js` → confirms rows inserted.
2. **Create provider:** Admin → Providers → create "ElevenLabs" with adapter key `elevenlabs`.
3. **Create model:** Admin → Models → new model: provider = ElevenLabs (Fetch Schema hidden), set `provider_model_id` = `eleven_v3` (or `eleven_multilingual_v2`), category `audio`, an appropriate `node_type_id` (the Generate Speech type), click "Apply ElevenLabs speech preset", pick a default voice in the preview, set a flat `credit_cost`, save.
4. **Deactivate** the old Replicate speech model (set `is_active` off).
5. **Add a Generate Speech node** on the canvas; open Properties; confirm the Voice control opens the modal, search/filter works, a preview plays, and selecting sets the voice.
6. **Run (iterations = 1):** confirm an audio result appears, plays, and is stored under `chat-assets/.../results/...mp3` (not a transient ElevenLabs URL).
7. **Run (iterations = 3):** confirm 3 audio results aggregate onto the node and credits debit; force a failure (e.g. empty voice) and confirm a clear error + refund.
8. **Regression:** run an existing Replicate image model — confirm it still works unchanged.
9. **Deactivated model:** open a workflow that referenced the old Replicate speech model and run it — confirm the clear "no longer available" error (not a crash).

Record the outcomes. Any failure → return to the relevant task.

---

## Notes / known limitations (carried from the spec)

- **Shared-library voices** may require being added to your ElevenLabs account before generation with their `voice_id` succeeds. Premade/owned voices always work. If a shared voice fails at generation, add it in ElevenLabs and re-run the sync. (Documented in the sync script header.)
- **Sync timeout:** ElevenLabs TTS holds the serverless function open for the generation duration (normally seconds). Very long text could approach the function timeout; chunking is deferred. Keep input text reasonable.
- **Per-iteration streaming to chat** (as Replicate fan-out does via `node_predictions` realtime) is NOT implemented for the sync adapter path in v1 — all iterations complete server-side and render together. This is acceptable for launch; incremental streaming is a future enhancement.
- **Credit cost** is a flat `credit_cost` per run for launch; per-character pricing via `cost_per_unit` is deferred.
- **Refinement vs. the spec:** the spec described a shared `finalizeNodeResult` helper that the webhook would be refactored onto. During planning, reading the real code showed that ElevenLabs results already complete through the **existing** `dispatchReplicateNode` sync-success path (which infers `audio` from the `.mp3` URL). So the actual, lower-risk refactor is narrower: extract only `mirrorMediaToStorage` (Task 3) and `refundFailedIteration` (Task 6B) into shared modules and reuse them — no rewrite of the webhook's fan-out/finalize logic. The spec's intent ("results handled the same everywhere") is preserved; the mechanism is simpler.
```
