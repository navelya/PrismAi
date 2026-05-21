---
name: create-ephemeral-node
description: Use when the user wants to create a new ephemeral node plugin in this PrismAi repo (a workflow node type like blur/compositor/media_input/prompt/ai_generator). Triggers on "create a node for X", "add a new node type", "build an ephemeral node that does Y", "I want a node that...", or the slash command /create-ephemeral-node. The skill drives the full plugin lifecycle: it asks targeted UX/data questions (server tech and live-preview approach are INFERRED from the description, not asked), picks the closest existing plugin as a structural reference, and emits the complete plugin folder + three barrel-file edits, then verifies with `npm run build`.
---

# Create Ephemeral Node

You are creating a new ephemeral-node plugin in the PrismAi codebase. This skill drives the entire process from a short user description to a working node visible in the canvas, registered in all three registries, and discoverable by the chat brain.

## Hard rules (do not skip)

1. **Always do the design phase before writing files.** Ask the questions in Phase 1 first, then present a plan in Phase 2 for the user to approve. Only then build.
2. **Server tech is INFERRED, not asked.** Read the user's description and pick (Sharp, ffmpeg-wasm-server, Replicate via the existing ai_generator pattern, etc.). See [references/server-tech-inference.md](references/server-tech-inference.md). State your choice in the plan; user can override.
3. **Live preview is mandatory.** Every ephemeral node has `executor.client.ts`. The skill picks the preview approach by data type — see [references/client-preview-inference.md](references/client-preview-inference.md). State your choice in the plan.
4. **If the node produces OR consumes `video`, read [references/live-data-flow.md](references/live-data-flow.md) before designing.** Video envelope items carry exactly one of `url` (static asset) or `graph` (live `GraphDescription`); the legacy `cssFilter`/`stream`/`canvas` sibling fields were removed in 2026-05. The compositor + blur are the canonical references — match their pattern. Filter-shaped nodes wrap upstream in `{ kind: 'filter', upstream, cssFilter }` rather than re-encoding; live producers publish `{ url: '', graph, resolution }` into `nodeOutputs`.
5. **The python rembg microservice is being deleted — IGNORE IT.** Background removal and similar AI ops go through Replicate via the `ai_generator` pattern, not a local microservice.
6. **Reach for existing UI primitives first.** [references/ui-primitives.md](references/ui-primitives.md) is the inventory. Don't invent a new component if `NumberInput`, `Select`, `Switch`, `Checkbox`, `Textarea`, `ImageLightbox`, or `BlurryImage` already covers it.
7. **New components: in-plugin if one-off, shared library if reusable.** Create new components inside `lib/nodes/plugins/<name>/ui/` if the component is only useful for THIS node. Promote to `components/ui/` if you'd plausibly use it from another part of the app. When in doubt, in-plugin.
8. **Style language is modern minimal / glassmorphism.** See [references/style-guide.md](references/style-guide.md). Match the existing nodes — same border weights, same surface opacities, same icon sizes.
9. **Pick the closest existing plugin as a structural reference and adapt — don't synthesize from scratch.** [references/node-recipes.md](references/node-recipes.md) lists the four shapes and their reference plugins.

## The four phases

### Phase 1 — Understand (ask, don't assume)

Ask these questions ONE AT A TIME in a conversation. Don't dump them all at once. Skip questions whose answers are obvious from the user's initial description.

1. **Node type slug.** What's the snake_case identifier? (e.g. `blur`, `video_combine`, `audio_extract`). This is what `type` becomes in `definition.ts` and the registry keys.
2. **Display name + one-sentence description.** What appears on the canvas card and in the AI brain's node-type list.
3. **Shape.** Which of the four shapes (transform / source / layered / generative-wrapper) — see [references/node-recipes.md](references/node-recipes.md).
4. **Inputs.** What data flows in? List each as `{ id, label, type, optional?, is_array? }` using the types in [references/handle-types.md](references/handle-types.md).
5. **Outputs.** Same shape for outputs.
6. **Controls.** What does the user manipulate on this node? List each as `{ key, kind: 'number' | 'select' | 'string' | 'boolean' | 'textarea' | 'custom', range/options/default, label }`.
7. **Where do controls live?** Inline in the canvas card (default), in a modal triggered by a button, or in a side property panel? Most ephemeral nodes use inline; modal is reserved for layered editors like compositor; side panels are rare (only ai_generator uses one). Pick based on Phase 1.3's shape.

If a question's answer is unambiguous from the description, state your assumption and move on; don't ask. Example: "create a node that blurs an image" → shape is transform, inputs `image:image`, outputs `image_out:image`, controls are inferred (radius). Ask only about radius range and any extra knobs.

### Phase 2 — Plan (propose, get approval)

After Phase 1, write a plan as a single message and wait for user approval. The plan must include:

1. **Reference plugin** — which existing plugin in `lib/nodes/plugins/` you'll structurally model on (blur, compositor, media_input, prompt, ai_generator). State why it's the closest match.
2. **Server tech choice** — what library/service the executor will use. Reference [references/server-tech-inference.md](references/server-tech-inference.md). E.g., "Sharp for the resize pipeline; output to `workflow-ephemeral-tmp` bucket." If the operation needs a Replicate model, recommend wrapping `ai_generator` instead of building a new ephemeral plugin.
3. **Client preview approach** — Canvas 2D, `<video>` element + canvas, Web Audio + waveform canvas, model-viewer, or Konva. Reference [references/client-preview-inference.md](references/client-preview-inference.md). State why this preview is feasible in-browser.
4. **Components to use** — list of existing primitives from [references/ui-primitives.md](references/ui-primitives.md) you'll import. Mention any NEW components needed and where they'll live (in-plugin `ui/` or `components/ui/`).
5. **File list** — every file you'll create or modify. Use exact paths.
6. **`aiSchema` design summary** — what the chat brain will see. The brain uses this to construct the node from natural language; under-specified schemas mean the AI can't use the node well. See [references/aischema-cookbook.md](references/aischema-cookbook.md).
7. **Open questions** — anything where you made a judgment call that the user should sanity-check.

After presenting, wait for "go" before writing any file. If the user pushes back on the plan, revise and re-present.

### Phase 3 — Build

Execute the plan. Order:

1. **`definition.ts`** — `NodeSharedDef` literal, config TS interface, `aiSchema`. See [references/plugin-structure.md](references/plugin-structure.md) for the file contract and [references/aischema-cookbook.md](references/aischema-cookbook.md) for schema patterns.
2. **`executor.server.ts`** — server execution. Self-contained: fetches inputs, runs the transform, and MUST use `uploadEphemeralResult` from `lib/nodes/plugins/utils/ephemeral.ts` to handle the upload to `workflow-ephemeral-tmp` (NOT `chat-assets`) and return the `NodeExecutionResult`. See [references/server-tech-inference.md](references/server-tech-inference.md) for tech choice.
3. **`executor.client.ts`** — live-preview executor. Uses the browser-only approach. Returns `{ type: 'image', data: [{ url: dataUrl }] }` envelope. See [references/client-preview-inference.md](references/client-preview-inference.md) for approach by data type.
4. **`component.tsx`** — the canvas card. Imports `BaseNode` from `@/lib/nodes/core/canvas/BaseNode`, includes the inline controls and preview, exports both `default` (the React component) and `<plugin>ClientDef: NodeClientDef`. Ensure `DownloadHandler` registration explicitly wraps the export function to correctly forward the `isInternal` flag: `registerDownloadHandler(id, (isInternal?: boolean) => fetchYourExport(undefined, isInternal))`. When invoking upstream handlers, explicitly pass the `isInternal` flag (e.g., `await upstreamHandler(isInternal ?? true)`). Explicitly wrap UI state modifications (like `setDownloadState('rendering')`) in an `if (!isInternal)` check. See `lib/nodes/plugins/blur/component.tsx` for a concrete reference.
5. **`properties.tsx`** — only if user explicitly wanted a side panel. Otherwise omit.
6. **`shared.ts`** — only if both server and client executors need shared pure helpers. Omit if not needed.
7. **`ui/` subfolder** — any new node-specific components. One-off only.
8. **`index.ts`** — barrel. MUST NOT export `executor.server.ts` (server-only, would leak `sharp` into the client bundle). See [references/plugin-structure.md](references/plugin-structure.md).
9. **Three registry edits** — append one import + one entry to each of `lib/nodes/core/shared-registry.ts`, `lib/nodes/core/client-registry.ts`, `lib/nodes/core/server-registry.ts`. The pattern is mechanical:
   - shared: `<type>: <type>SharedDef`
   - client: `<type>: <type>ClientDef`
   - server: `<type>: { ...<type>SharedDef, executor: <type>Executor }`
10. **`components/ui/<New>.tsx`** — only if Phase 2 identified a reusable new component. Match the style language in [references/style-guide.md](references/style-guide.md).

### Phase 4 — Verify

1. Run `npm run build`. Must pass. If it fails, read the error, fix, rebuild. Don't proceed until green.
2. Confirm the new entry exists in all three registries by grepping.
3. Confirm `sharedRegistry` correctly exposes the new type to the chat brain — the AI introspects this at request time.
4. Print a short summary: what was created, where, and what to test in the browser.

DO NOT smoke-test in browser yourself — that's the user's job. Just point them at what to try.

## Slash command invocation

User typed `/create-ephemeral-node` (optionally with `<description>`). If they passed an inline description, jump straight to Phase 1 with that description as context. If they didn't, ask: "What kind of node do you want to build? Short description is fine — I'll ask for details."

## When to refuse / push back

- **The operation is not actually ephemeral.** If the user describes something that needs a hosted ML model (style transfer, upscale, anything that runs heavy compute), it's NOT an ephemeral node — it's a Replicate model that should be added to the `ai_models` DB table and used through the existing `ai_generator` plugin. Tell the user this and stop. Don't build a fake-ephemeral wrapper.
- **The data type doesn't fit existing handle types.** If you need a type that's not in [references/handle-types.md](references/handle-types.md), pause and ask the user; don't invent one. The data-types table is shared with the DB and adding new ones has wider implications.
- **Live preview is genuinely impossible client-side.** E.g. heavy ffmpeg passes might be too slow. In that case, do `executor.client.ts` as a "stub" that returns `null` (no preview), and document why in a comment. Don't skip the file entirely — the structure expects it.

## Reference files

Read these as you work; don't try to hold them all in head:

- [references/plugin-structure.md](references/plugin-structure.md) — file/folder contract
- [references/ui-primitives.md](references/ui-primitives.md) — existing component inventory with imports + props
- [references/node-recipes.md](references/node-recipes.md) — the four shape patterns with skeletons
- [references/handle-types.md](references/handle-types.md) — `NodeDataType` enum and when to use which
- [references/aischema-cookbook.md](references/aischema-cookbook.md) — `aiSchema` patterns by shape
- [references/style-guide.md](references/style-guide.md) — modern-minimal style language
- [references/server-tech-inference.md](references/server-tech-inference.md) — picking server tech from a description
- [references/client-preview-inference.md](references/client-preview-inference.md) — picking client preview approach
- [references/live-data-flow.md](references/live-data-flow.md) — REQUIRED reading when designing any node that produces or consumes `video`. Covers the single envelope contract (graph / url / text, post-2026-05), the `kind: 'filter'` graph-wrapping pattern for filters, handle-type narrowing for polymorphic outputs, and the record-to-blob pattern for lightboxes over live signals.

The project also has [lib/nodes/plugins/README.md](../../lib/nodes/plugins/README.md) and [docs/node-recipes.md](../../docs/node-recipes.md) which are the in-repo equivalents of the structure + recipe references; they stay current with the codebase.
