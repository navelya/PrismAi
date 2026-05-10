# Ephemeral Node Plugins

Each ephemeral node (a workflow node type like `blur`, `compositor`, `media_input`) lives in its own folder here.

## Folder contract

```
lib/nodes/plugins/<snake_case_type>/
  definition.ts        # required — NodeSharedDef + config TS interface + aiSchema
  executor.server.ts   # required — server-side execution (sharp / ffmpeg / fetch+upload)
  executor.client.ts   # required — browser-side live preview
  component.tsx        # required — React Flow canvas card
  index.ts             # required — barrel (must NOT export executor.server.ts)
  properties.tsx       # optional — custom side panel (rare; only ai_generator uses one)
  shared.ts            # optional — pure helpers used by both executors
  ui/                  # optional — node-specific UI subcomponents (modals, canvases)
```

## Registry wiring

Each plugin must be registered in three places:

- `lib/nodes/core/shared-registry.ts` — `<type>: <type>SharedDef`
- `lib/nodes/core/client-registry.ts` — `<type>: <type>ClientDef`
- `lib/nodes/core/server-registry.ts` — `<type>: { ...<type>SharedDef, executor: <type>Executor }`

Adding a new node = create the folder + add three import-and-entry lines.

## Behavior contract

- **Server executor uploads to `workflow-ephemeral-tmp` bucket** (TTL'd via pg_cron). Never to `workflow-assets` (persistent) or `chat-assets` (chat attachments).
- **Server executor returns `NodeExecutionResult { success, data, error? }`** — `data` is an array of typed items (`ImageObject[]`, `string[]`, etc.). The runtime extracts URLs from `ImageObject` and writes them to `node_results.result_data`.
- **Client executor returns `{ type: NodeDataType, data: any[] }` or `null`** — same envelope shape as the server side, normalized via `toLegacyRenderableOutput`.
- **`index.ts` MUST NOT export `executor.server.ts`** — `sharp` is server-only and would leak into the client bundle.

## Compositor input quirk

The Compositor handle `layers` is a single static array-input handle, but the runtime needs to disambiguate which upstream value belongs to which layer. The convention is that each `CompositorLayer.sourceHandleId === edge.id` (the React Flow edge ID). Server-side input builders (`lib/workflow/orchestrator.ts:buildInputsFromParents`, `app/api/executions/start/route.ts` preseeding, `lib/workflow/ephemeral-executor.ts:buildNodeInputs`, the dispatch-ephemeral route) all dual-key inputs by both `edge.targetHandle` AND `edge.id`. Browser-side `lib/hooks/use-node-auto-compute.ts` does the same. New layered nodes following this pattern get this for free — just keep `layer.sourceHandleId === edge.id`.

## How to add a new node

Use the **`/create-ephemeral-node`** skill in Claude Code. It walks through:

1. Asks targeted questions about node shape, inputs, outputs, controls, UX.
2. Infers server tech (Sharp / ffmpeg / etc.) and client preview approach (Canvas / Web Audio / Three / etc.) from your description.
3. Picks the closest existing plugin as a structural reference.
4. Emits the full plugin folder + three registry edits.
5. Verifies with `npm run build`.

The skill lives at `.claude/skills/create-ephemeral-node/` in this repo.

## Architecture references

- [docs/node-recipes.md](../../../docs/node-recipes.md) — the four shape patterns (transform, source, layered, generative wrapper).
- [ARCHITECTURE.md](../../../ARCHITECTURE.md) — overall plugin system + execution flow.
- [docs/superpowers/specs/2026-05-09-ephemeral-node-organization-design.md](../../../docs/superpowers/specs/2026-05-09-ephemeral-node-organization-design.md) — design rationale for this folder layout.
