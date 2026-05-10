# Node Recipes

Every ephemeral node falls into one of four shapes. When adding a new node, pick the closest existing plugin as a structural reference and adapt — don't synthesize from scratch.

This document is the in-repo summary; the full version (with code skeletons, common pitfalls, decision trees) lives in [.claude/skills/create-ephemeral-node/references/node-recipes.md](../.claude/skills/create-ephemeral-node/references/node-recipes.md) and is what the `/create-ephemeral-node` skill consumes.

## The four shapes

### 1. Transform — "in → out"

A single input, a single output, a few inline numeric/select controls. The classic image filter.

**Reference plugin:** [lib/nodes/plugins/blur/](../lib/nodes/plugins/blur/)

Examples: `blur`, `levels`, `brightness`, `contrast`, `grayscale`, `rotate`, `resize`, future audio gain, video brightness.

Skeleton: `definition.ts` with one input + one output + 1–4 controls. `executor.server.ts` with a Sharp/ffmpeg pipeline. `executor.client.ts` with a Canvas 2D + CSS-filter approximation. `component.tsx` with inline controls + preview wrapped in `BaseNode`.

### 2. Source — "no input → out"

No upstream connections. The node IS the input UI.

**Reference plugins:** [lib/nodes/plugins/media_input/](../lib/nodes/plugins/media_input/) (file upload), [lib/nodes/plugins/prompt/](../lib/nodes/plugins/prompt/) (text)

Examples: `media_input` (image upload), `prompt` (text), future `audio_recorder`, `webcam_capture`, `color_picker`.

Skeleton: `handles.inputs: []`. The interactive UI lives in `component.tsx`. The executors are pass-throughs that normalize the envelope.

### 3. Layered — "many inputs → composited out"

Multiple inputs through a single static array-input handle, plus heavy custom UI for arranging the layers (typically a full-screen editor modal).

**Reference plugin:** [lib/nodes/plugins/compositor/](../lib/nodes/plugins/compositor/)

Examples: `compositor` (image layers), future `video_timeline`, `audio_mix`, `multi_view_3d`.

Skeleton: ONE input handle with `is_array: true`. Each `layer.sourceHandleId === edge.id` for runtime disambiguation. `executor.server.ts` reads `inputs[layer.sourceHandleId]` (the dual-keying done by orchestrator + start route makes this work). Heavy UI in `ui/EditorModal.tsx`.

### 4. Generative wrapper — "input → hosted ML model → out"

The node calls a Replicate model (or similar hosted service) asynchronously via webhook callbacks.

**Reference plugin:** [lib/nodes/plugins/ai_generator/](../lib/nodes/plugins/ai_generator/)

**For most cases: do NOT build a new plugin.** Add a row to the `ai_models` Supabase table. The existing `ai_generator` plugin will automatically expose it in the node palette with handles + controls derived from the model's `inputs_schema` JSONB column.

A new plugin is only justified if the operation goes through a non-Replicate API (OpenAI, Gemini, custom internal service) AND has fundamentally different orchestration than the standard "input → Replicate → output" pattern.

## Quick decision tree

- User wants to upload media or enter text → **Source** (build a plugin).
- User wants to combine multiple inputs → **Layered** (build a plugin).
- User wants to call a hosted ML model → **Replicate `ai_models` row** (no plugin needed).
- Otherwise (single input → transformed single output) → **Transform** (build a plugin).

## How to add a node

Run the `/create-ephemeral-node` skill. It walks through the questions and emits everything.
