# Ephemeral Node Organization

## Goal

Reorganize the ephemeral-node subsystem so that **a single plugin folder fully describes a node** — definition, AI schema, server executor, optional client executor, canvas component, and any custom UI. Eliminate the parallel handler registry that currently duplicates server logic, kill orphan handlers that have no plugin, and consolidate the per-node UI that today is spread across `lib/nodes/plugins/`, `components/canvas/`, and `components/compositor/`.

The target audience is two consumers:

1. A **future scaffolding skill** that creates new ephemeral nodes from a short description. It must be able to emit one folder, append one line per registry, and stop.
2. The **chat-brain LLM** that reads `sharedRegistry` to know what nodes exist. After the refactor every node has a complete `definition.ts` with a real `aiSchema` — no more orphan types invisible to the brain.

## Problems with the current state

1. **Two parallel server-execution registries.** `lib/workflow/handlers.ts` (the `EPHEMERAL_HANDLERS` map) is what the runtime actually calls; `lib/nodes/plugins/<name>/executor.ts` is the "official" plugin executor exposed via `serverRegistry`. The two paths are partly adapter-wrapped, partly duplicated inline (`handleCompositor` inside `handlers.ts` re-implements 90 lines of compositor logic that already exist in the plugin's executor).
2. **Orphan server handlers.** `levels`, `brightness`, `contrast`, `grayscale`, `invert`, `rotate`, `resize` exist in `EPHEMERAL_HANDLERS` but have no plugin folder, no shared def, no AI schema, no canvas component. They run on the server but the chat-brain cannot see them.
3. **Inconsistent file layout per plugin.** `blur/` has 5 files (`index.ts`, `types.ts`, `executor.ts`, `component.tsx`, `client-blur.ts`); `compositor/` has 4 (no `types.ts`); `prompt/` and `media_input/` have 3 (no client executor). File names also differ (`client-blur.ts` vs `client-compositor.ts`).
4. **Per-node UI is spread across three top-level directories.** `lib/nodes/plugins/<name>/component.tsx` is a one-line wrapper around `components/canvas/<Name>Node.tsx`; the compositor's heavy Konva editor lives in a separate `components/compositor/`. Searching for "everything about a node" returns three folders.
5. **`lib/nodes/types.ts` is a junk drawer.** It mixes truly cross-cutting types (`Workflow`, `WorkflowNode`, `ExecutionContext`, `NodeExecutionResult`, `NodeExecutor`, `ImageObject`) with per-plugin configs (`BlurConfig`, `CompositorConfig`, `MediaInputConfig`, `PromptConfig`, `LayerTransform`, `CompositorLayer`).
6. **The `ai_generator` node has no plugin folder.** Its definition is inline in `shared-registry.ts`, its executor is at `lib/nodes/core/ai-generator-executor.ts`, its component and property panel are in `components/canvas/`. It is the most-edited node and the worst-organized one.

## Target architecture

### Top-level layout

```
lib/nodes/
  types.ts                          # ONLY cross-cutting types: Workflow, WorkflowNode, WorkflowEdge,
                                    # ExecutionContext, NodeExecutionResult, NodeExecutor,
                                    # ImageObject, NodeStatus, NodeType, ExecutionStatus, ExecutionRecord.
                                    # Per-plugin config types (BlurConfig, CompositorConfig, etc.)
                                    # are removed from this file and live in each plugin's definition.ts.
  registry.ts                       # tiny: re-exports serverRegistry as nodeRegistry + getNodeExecutor()

  core/
    types.ts                        # NodeSharedDef, NodeClientDef, NodeServerDef, NodeDataType,
                                    # ClientExecutor, ClientExecutorResult
    shared-registry.ts              # imports each plugin's definition.ts (one line per plugin)
    client-registry.ts              # imports each plugin's component + optional client executor
    server-registry.ts              # imports each plugin's server executor; also exports
                                    # isEphemeralNode(type) by checking !!serverRegistry[type] &&
                                    # serverRegistry[type].family !== 'generative'

    canvas/
      BaseNode.tsx                  # moved from components/canvas/BaseNode.tsx
      NodeHeader.tsx                # moved from components/canvas/NodeHeader.tsx
      DefaultNode.tsx               # NEW: opinionated default canvas node for the 80% case
      NodePreview.tsx               # NEW: image / text preview primitive used by DefaultNode
      NodeControls.tsx              # NEW: auto-renders inline controls from a node's aiSchema
      AutoPropertyPanel.tsx         # NEW: auto-renders the property panel from aiSchema

  plugins/
    blur/
      definition.ts                 # blurSharedDef + BlurConfig interface + aiSchema (single file)
      executor.server.ts            # Sharp pipeline only (no isBrowser branch)
      executor.client.ts            # Canvas live preview only (no isServer branch)
      component.tsx                 # the canvas card; for blur this is a re-export of DefaultNode
                                    # OR the rich custom component (see "DefaultNode opt-in" below)
      index.ts                      # barrel: re-exports definition + component + client executor
                                    # NOTE: index.ts MUST NOT import executor.server.ts (kept off
                                    # the client bundle)

    compositor/
      definition.ts                 # CompositorConfig, CompositorLayer, LayerTransform,
                                    # calculateInitialTransform, aiSchema
      executor.server.ts
      executor.client.ts
      component.tsx                 # custom (current CompositorNode.tsx, moved)
      properties.tsx                # custom panel that opens the Konva editor modal
      shared.ts                     # layer geometry / transform helpers used by both executors
      index.ts
      ui/
        EditorModal.tsx             # was components/compositor/CompositorEditorModal.tsx
        Renderer.tsx                # was components/compositor/CompositorRenderer.tsx
        # additional Konva-related files migrate here as needed

    media_input/
      definition.ts
      executor.server.ts            # no client executor (server-only file ingestion)
      component.tsx                 # custom (current MediaInputNode.tsx, moved)
      index.ts

    prompt/
      definition.ts
      executor.server.ts            # no client executor
      component.tsx                 # custom (current PromptNode.tsx, moved)
      index.ts

    ai_generator/
      definition.ts                 # the dynamic-handles definition (currently inline in shared-registry)
      executor.server.ts            # was lib/nodes/core/ai-generator-executor.ts
      component.tsx                 # was components/canvas/AIGeneratorNode.tsx
      properties.tsx                # was components/canvas/AIGeneratorProperties.tsx
      index.ts
```

### Files deleted in the migration

- `lib/workflow/handlers.ts` — entire file. Runtime calls `serverRegistry[type].executor` directly.
- `lib/nodes/plugins/levels/` — empty folder.
- `lib/nodes/core/ai-generator-executor.ts` — moves into `lib/nodes/plugins/ai_generator/executor.server.ts`.
- `components/canvas/BlurNode.tsx`, `CompositorNode.tsx`, `MediaInputNode.tsx`, `PromptNode.tsx`, `AIGeneratorNode.tsx`, `AIGeneratorProperties.tsx` — moved into their plugin folders.
- `components/canvas/BaseNode.tsx`, `NodeHeader.tsx` — moved to `lib/nodes/core/canvas/`.
- `components/canvas/CustomNode.tsx` — verified usage during migration; either moved to `core/canvas/` or deleted if unused.
- `components/compositor/` — entire folder. Contents move to `lib/nodes/plugins/compositor/ui/`.
- `lib/nodes/plugins/blur/types.ts` and `client-blur.ts` — merged into `definition.ts` and renamed to `executor.client.ts`.
- `lib/nodes/plugins/compositor/client-compositor.ts` — renamed to `executor.client.ts`.
- The orphan handlers (`levels`, `brightness`, `contrast`, `grayscale`, `invert`, `rotate`, `resize`) — deleted. They had no UI and no AI presence; the scaffolding skill can recreate any of them properly later.

### Naming convention (uniform across every plugin)

| File | Required? | Purpose |
|---|---|---|
| `definition.ts` | yes | `NodeSharedDef` literal, config TS interface, `aiSchema` |
| `executor.server.ts` | yes | Server-side execution; imports `sharp`, `@/lib/supabase/service`, etc. without conditional gating |
| `executor.client.ts` | optional | Client-side live preview; imports browser APIs without conditional gating |
| `component.tsx` | yes | The React Flow canvas node; either re-exports `DefaultNode` or implements a custom one |
| `properties.tsx` | optional | Custom property panel; absent → `AutoPropertyPanel` is used |
| `shared.ts` | optional | Pure helpers used by both executors |
| `ui/` | optional | Subfolder for heavy node-specific UI (modals, canvases, etc.) |
| `index.ts` | yes | Barrel re-exporting definition + component + optional client executor |

The skill emits exactly these names. There are no alternative names.

### DefaultNode opt-in

A plugin uses the default canvas node by re-exporting it from `component.tsx`:

```tsx
// lib/nodes/plugins/blur/component.tsx
export { DefaultNode as default } from '@/lib/nodes/core/canvas/DefaultNode';
```

`DefaultNode` reads the plugin's `definition.ts` (handles + `aiSchema`) and renders:

- The standard `BaseNode` shell (header, status border, handles).
- A `NodePreview` that auto-resolves the first output handle's value from `nodeOutputs`.
- Inline controls auto-rendered from `aiSchema`:
  - `{type: 'number', minimum, maximum}` → slider + number input
  - `{enum}` → select
  - `{type: 'boolean'}` → checkbox
  - `{type: 'string'}` → single-line text input
  - `{type: 'string', format: 'multiline'}` → textarea

Plugins with custom UI needs (compositor's Konva modal, media_input's upload UI, ai_generator's dynamic handles, prompt's autosizing textarea) replace `component.tsx` with a hand-written component that imports `BaseNode` directly from `lib/nodes/core/canvas/BaseNode.tsx`.

The same pattern applies to `properties.tsx`: absent → `AutoPropertyPanel` is rendered; present → the custom panel is used.

### Runtime execution path

Before:

```
dispatch-v2.ts → isEphemeralNode (from handlers.ts)
              → ephemeral-executor.ts → EPHEMERAL_HANDLERS[type] (from handlers.ts)
              → adapter (sometimes) → plugin executor (sometimes)
```

After:

```
dispatch-v2.ts → isEphemeralNode (from server-registry.ts)
              → ephemeral-executor.ts → serverRegistry[type].executor (from server-registry.ts)
```

`ephemeral-executor.ts` and `app/api/executions/dispatch-ephemeral/route.ts` are updated to:

1. Import `serverRegistry` from `lib/nodes/core/server-registry.ts` instead of `EPHEMERAL_HANDLERS` from `lib/workflow/handlers.ts`.
2. Call `serverRegistry[type].executor(config, inputs, context)` and consume its `NodeExecutionResult` shape directly.

**Executor contract — who uploads.** Today the responsibility is split: `EPHEMERAL_HANDLERS` handlers return raw `Buffer | string` and the *executor wrapper* (`ephemeral-executor.ts`) uploads to `workflow-ephemeral-tmp`; meanwhile the plugin `executor.ts` files upload internally and return URLs inside `NodeExecutionResult`. The post-refactor contract picks one rule:

- **Plugin server executors are fully self-contained.** They fetch inputs, run the transform, upload any binary output to `workflow-ephemeral-tmp` themselves, and return a `NodeExecutionResult` whose `data` already contains URLs (or text, or structured JSON). They are the authoritative implementation.
- **`ephemeral-executor.ts` becomes thin.** It (a) loads the graph, (b) builds inputs from upstream `node_results`, (c) calls `serverRegistry[type].executor(config, inputs, context)`, (d) maps the returned `NodeExecutionResult` to a `node_results` row (`status`, `result_type`, `result_data`), (e) calls `checkAndDispatchChildren`. No more in-line buffer-upload loop.

This collapses the two duplicate upload paths into one, removes the `HandlerFunction` type entirely, and gives every node a uniform server-side signature.

`isEphemeralNode(type)` becomes a single function in `server-registry.ts`:

```ts
export function isEphemeralNode(type: string): boolean {
  const def = serverRegistry[type];
  return !!def && def.family !== 'generative';
}
```

This replaces the current "is the type a key in `EPHEMERAL_HANDLERS`?" check. The two callers (`dispatch-v2.ts` and `app/api/executions/start/route.ts`) update their imports.

### Scaffolding-skill contract

When the scaffolding skill is invoked, it produces *one and only one* folder under `lib/nodes/plugins/<snake_case_name>/`, plus exactly three small edits to the registry barrel files. The protocol:

1. **Clarify** (only when ambiguous): the node's input handles (count, types, mandatory?), output handles, config knobs (with min/max/defaults), whether a client-side preview is feasible (often "no" for ffmpeg, AI, 3D), the server tech (Sharp, ffmpeg-wasm-server, Replicate proxy, custom microservice).
2. **Emit the plugin folder.** Always: `definition.ts`, `executor.server.ts`, `component.tsx`, `index.ts`. Conditionally: `executor.client.ts`, `properties.tsx`, `shared.ts`, `ui/`.
3. **Wire three registries.** Append one `import` + one entry to `shared-registry.ts`, `client-registry.ts`, `server-registry.ts`. The entries are mechanical: `<type>: { ...sharedDef, executor: serverExecutor }` for server, `<type>: { ...sharedDef, component, clientExecutor? }` for client, `<type>: sharedDef` for shared.
4. **Do not touch any other file.** There is no `handlers.ts`, no `EPHEMERAL_HANDLERS`, no `node-type-mapper`, no second registration site.

The skill's templates can be fully mechanical because the file names, file roles, and registration pattern are uniform across every plugin.

## Out of scope

- The chat-brain prompt / `lib/chat/` is not modified. It still introspects `sharedRegistry` exactly as today.
- The `useNodeAutoCompute` hook contract (`ClientExecutor` signature, return envelope) is preserved unchanged.
- The webhook flow for `ai_generator` (Replicate predictions, signed callbacks) is preserved unchanged — only the executor's home directory moves.
- The `ai_models.inputs_schema` JSONB → dynamic handles flow is preserved unchanged.
- Database schema, storage buckets, RLS policies are unchanged.
- The `lib/workflow/` engine files (`dispatch-v2.ts`, `orchestrator.ts`, `result-format.ts`, etc.) keep their roles and structure. Only their imports of `handlers.ts` change.

## Risks and mitigations

- **Risk:** A caller of `EPHEMERAL_HANDLERS`, `handleX`, `isEphemeralNode`, or any of the moved-component paths is missed during the migration.
  - **Mitigation:** Plan executes a full repo grep for each removed identifier before declaring the migration complete. The grep list is enumerated explicitly in the implementation plan.
- **Risk:** The plugin `executor.ts` files and the `handlers.ts` handlers diverge in subtle ways (e.g., compositor's plugin executor uploads to `chat-assets` while `handleCompositor` returns a buffer that ephemeral-executor uploads to `workflow-ephemeral-tmp`; blur's plugin executor maps `radius` 0–100 to 0–20px while `handleBlur` passes `radius` directly to Sharp). The consolidated executor must match observable runtime behavior, not the dead plugin-executor branch.
  - **Mitigation:** The implementation plan walks each plugin executor and handler pair side-by-side. The current *runtime* behavior (i.e., what `handlers.ts` produces today, including the upload destination performed by `ephemeral-executor.ts`) is the source of truth; the new self-contained `executor.server.ts` must produce the same outputs to the same buckets. Behavioral changes (e.g., choosing to upload to a different bucket, or fixing the radius scale) are explicitly out of scope for the structural refactor and are flagged as separate tickets.
- **Risk:** Bundle leakage. Importing `executor.server.ts` from a client-reachable path would pull `sharp` into the browser bundle.
  - **Mitigation:** `index.ts` re-exports `definition`, `component`, and `executor.client` only. `executor.server.ts` is imported exclusively from `server-registry.ts`, which is itself only imported by server-side code (`lib/nodes/registry.ts`, `lib/workflow/*`, API routes). The implementation plan adds an explicit assertion (a comment or build-time check) on `index.ts`.
- **Risk:** The `DefaultNode` abstraction is wrong for some current node and we silently regress its UI.
  - **Mitigation:** First migration pass keeps every existing component as-is (custom). Only after the structural move is verified does anyone consider migrating a node to `DefaultNode`. That migration is opt-in per node, not bundled with the structural work.

## Acceptance criteria

1. `lib/workflow/handlers.ts` does not exist.
2. Every node in `serverRegistry` has a corresponding folder under `lib/nodes/plugins/<name>/` with at minimum `definition.ts`, `executor.server.ts`, `component.tsx`, `index.ts`.
3. No file outside `lib/nodes/plugins/` and `lib/nodes/core/canvas/` references a node-specific React component.
4. `components/canvas/` and `components/compositor/` no longer exist.
5. `lib/nodes/types.ts` contains only cross-cutting types.
6. The chat → workflow → run → ephemeral execution → UI update flow works end-to-end for every existing node (`blur`, `compositor`, `media_input`, `prompt`, `ai_generator`) with no behavior change observable from the chat or canvas.
7. Adding a new ephemeral node requires creating exactly one new folder under `lib/nodes/plugins/` and appending one line to each of the three registry barrel files. No other source file is touched.
