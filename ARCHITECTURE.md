# Architecture

Prism AI is a chat-driven, node-based image/media workflow editor. A user describes an outcome in chat, an LLM emits a workflow graph patch, the user runs it, and a server-side DAG orchestrator dispatches each node — either to Replicate (generative AI) or to a local Sharp-based handler (ephemeral transforms).

The single most important architectural concept is the **persistent vs. ephemeral node split** — see [PLAN.md](PLAN.md) for the full rationale. Persistent nodes (Generative AI, Media Input) produce stored URLs. Ephemeral nodes (Blur, Levels, Compositor, Prompt) are pure functions that produce buffers. Almost every other design decision in the codebase derives from this distinction.

## Top-level folders

| Folder | Purpose |
|---|---|
| [app/](app/) | Next.js 14 App Router. Pages (`chat`, `library`, `settings`, `admin`, `nodes`, `demo`, `auth/callback`, `login`) plus all API routes under `app/api/`. |
| [app/api/](app/api/) | Server endpoints — execution engine (`executions/`, `webhooks/replicate-v2/`), chat streaming (`chat/stream/`), CRUD (`sessions/`, `messages/`, `models/`, `user/`), uploads (`upload/`), admin tools (`admin/`), and a daily Vercel cron (`cron/cleanup-sessions/`). |
| [components/](components/) | React components grouped by surface: `chat/`, `editor/` (React Flow canvas + panels), `canvas/` (per-node React Flow renderers), `compositor/` (Konva-based layer editor), `library/`, `admin/`, `layout/`, `theme/`, `providers/`, `ui/` (design system primitives). |
| [lib/nodes/](lib/nodes/) | The plugin system. Each node type lives in `plugins/<name>/` and exports three pieces — see "Node plugin layout" below. `core/` aggregates them into shared/client/server registries; `registry.ts` re-exports the server registry; `types.ts` defines `WorkflowNode`/`Workflow`/`NodeExecutor`. |
| [lib/workflow/](lib/workflow/) | The v2 execution engine. Entry: `start` route → `dispatch-v2.ts` → `orchestrator.ts` (chain reaction) → `ephemeral-executor.ts` or `handlers.ts` (Sharp transforms) for ephemeral nodes; Replicate for persistent. `result-format.ts` defines the typed-edge contract. |
| [lib/store/](lib/store/) | Zustand store split into slices (`workflow`, `chat`, `execution`, `ui`, `live-position`). `app-store.ts` documents the persistence policy — what survives a page refresh and what must not. |
| [lib/supabase/](lib/supabase/) | Three Supabase clients: `client.ts` (browser), `server.ts` (SSR with cookies), `service.ts` (service-role, RLS-bypassing — only for webhooks/cron/background workers). |
| [lib/ai/](lib/ai/) | Thin clients for Gemini and Replicate plus a model-manager / rate-limit tracker. |
| [lib/hooks/](lib/hooks/) | React hooks for sessions, chat messages, file upload, undo/redo, and the realtime `use-execution-channel` that subscribes to `node_results` updates. |
| [lib/db/](lib/db/), [lib/storage/](lib/storage/), [lib/api/](lib/api/), [lib/utils/](lib/utils/), [lib/editor/](lib/editor/) | DB helpers, storage upload helpers, the typed API client used from the browser, generic utilities (graph layout/traversal, schema parser, perf), and the React Flow node factory. |
| [hooks/](hooks/) | Top-level workflow editor hooks (`useAutoSave`, `useWorkflowEditor`, `useWorkflowLibrary`). Distinct from `lib/hooks/` — these are page-level, those are atomic. |
| [supabase/migrations/](supabase/migrations/) | Postgres schema history. The schema *is* the source of truth — `supabase_*.sql` files at the root are stale snapshots. |
| [scripts/](scripts/) | One-off Node scripts for poking at v2 execution / supabase. Not a test suite — run by hand. |
| [public/](public/) | Static assets (icons, manifest, grid pattern). |
| [middleware.ts](middleware.ts) | Supabase auth gate for `/chat`, `/editor`, `/library`, `/settings` and most `/api/*`. |

### Node plugin layout

Each plugin (e.g. [lib/nodes/plugins/blur/](lib/nodes/plugins/blur/)) has three files split by *bundle target* — Next.js compiles client and server separately, and `sharp` cannot ship to the browser:

- `index.ts` → **shared def** (type, family, handles, `aiSchema`, `defaultConfig`). Safe to import anywhere. Aggregated in [lib/nodes/core/shared-registry.ts](lib/nodes/core/shared-registry.ts) and consumed by the chat LLM.
- `component.tsx` → **client def** (React Flow node + property panel). Aggregated in [lib/nodes/core/client-registry.ts](lib/nodes/core/client-registry.ts). Browser-only.
- `executor.ts` → **server def** (`(config, inputs, context) => NodeExecutionResult`). Aggregated in [lib/nodes/core/server-registry.ts](lib/nodes/core/server-registry.ts). Server-only — imports `sharp`.

The `ai_generator` node is special: its handles and controls are loaded at runtime from the `ai_models.inputs_schema` JSONB column, not from a static plugin.

## External services

| Service | Used for | Touched from |
|---|---|---|
| **Supabase** | Postgres (sessions, workflows, executions, node_results, ai_models, assets), Auth, Storage (`workflow-assets` permanent + `workflow-ephemeral-tmp` TTL'd), Realtime channels for live execution status. | Server clients in [lib/supabase/](lib/supabase/); browser via Realtime in [lib/hooks/use-execution-channel.ts](lib/hooks/use-execution-channel.ts). |
| **Google Gemini** | Chat → workflow generation. Vercel AI SDK with `@ai-sdk/google`, edge runtime. | [app/api/chat/stream/route.ts](app/api/chat/stream/route.ts), [lib/ai/gemini-client.ts](lib/ai/gemini-client.ts). |
| **Replicate** | All generative AI nodes. Async predictions with webhook callbacks. | [lib/workflow/dispatch-v2.ts](lib/workflow/dispatch-v2.ts) submits, [app/api/webhooks/replicate-v2/route.ts](app/api/webhooks/replicate-v2/route.ts) receives. |
| **Vercel** | Hosting (Next.js + edge), `@vercel/functions` `waitUntil` for fire-and-forget background work, Speed Insights, Analytics, Cron (`/api/cron/cleanup-sessions` daily at 02:00 UTC, see [vercel.json](vercel.json)). |
| **Hugging Face Spaces** (optional) | Python `rembg` background-removal microservice on port 8000. Lives in a separate `python-backend/` repo, not in this tree. See [STARTUP.md](STARTUP.md), [DEPLOYMENT.md](DEPLOYMENT.md). |
| **Pollinations.ai** | Free fallback image generation, no API key. Routed via `/api/image/generate*`. |

## Main data flow

```
┌─────────┐  chat msg  ┌──────────────────┐  workflow patch   ┌──────────────┐
│ Browser │ ─────────▶ │ /api/chat/stream │ ─── stream tool ──▶ │ Zustand      │
│         │            │ (edge, Gemini)   │   call deltas      │ workflow     │
└─────────┘            └──────────────────┘                    │ slice        │
     │                                                         └──────┬───────┘
     │ user clicks Run                                                │
     ▼                                                                ▼
┌──────────────────────┐  POST graph + runMode  ┌─────────────────────────────┐
│ /api/executions/start│ ─────────────────────▶ │ executions row + node_results│
│ (snapshot graph)     │                        │ all targets = 'pending'      │
└──────────┬───────────┘                        └─────────────────────────────┘
           │ dispatch root nodes
           ▼
   ┌───────┴────────┐
   │                │
   ▼                ▼
ephemeral         persistent
(Sharp,           (Replicate, async)
in-process)              │
   │                     ▼
   │              ┌──────────────────────┐
   │              │ Replicate finishes   │
   │              │ POST /api/webhooks/  │
   │              │     replicate-v2     │
   │              └──────────┬───────────┘
   ▼                         ▼
checkAndDispatchChildren(executionId, completedNodeId)
   │
   │ for each child whose parents are ALL completed
   │ in THIS execution_id (not session_id — stale results)
   ▼
dispatch child  ──▶ ... chain continues until no children left
                    then updateExecutionFinalStatus
                                  │
                                  ▼
                       ┌──────────────────────┐
                       │ Supabase Realtime     │
                       │ pushes node_results   │
                       │ updates to browser    │
                       └──────────┬───────────┘
                                  ▼
                          Canvas + chat update live
```

## A typical user request, end to end

User types *"generate an image of a cat and blur it"* and hits send.

1. **Chat → workflow.** [components/chat/ChatInterface.tsx](components/chat/ChatInterface.tsx) POSTs the message + `previousWorkflow` to [app/api/chat/stream/route.ts](app/api/chat/stream/route.ts) (edge runtime). The route introspects `sharedRegistry` to render a node-type prompt for Gemini, streams back a `WorkflowPatch` via Vercel AI SDK tool calls, and [lib/workflow/workflow-patch.ts](lib/workflow/workflow-patch.ts) applies it to the previous graph (patches, not full rewrites — preserves user edits made between turns). The new workflow lands in the Zustand `workflow` slice.

2. **User reviews & runs.** The canvas in [components/editor/EditorCanvas.tsx](components/editor/EditorCanvas.tsx) renders nodes via React Flow using `clientRegistry`. The user clicks Run; the editor sets `runFromNodeId` + `runMode` (`all`/`solo`/`chain`), which `SharedWorkflowEditor` watches and POSTs to `/api/executions/start`.

3. **Snapshot & seed.** [app/api/executions/start/route.ts](app/api/executions/start/route.ts) builds the target set per `runMode`, snapshots the subgraph into `executions.graph_json` (immutable for this run), inserts one `node_results` row per target node with `status='pending'`, and dispatches the root nodes.

4. **Persistent root: Replicate.** The AI Generator node is dispatched by [lib/workflow/dispatch-v2.ts](lib/workflow/dispatch-v2.ts) — looks up the model via `ai_models.replicate_model_id`, submits a prediction with `webhook = $NEXT_PUBLIC_APP_URL/api/webhooks/replicate-v2` and `metadata = {execution_id, node_id}`, returns immediately. Replicate runs the model out-of-process.

5. **Webhook arrives.** [app/api/webhooks/replicate-v2/route.ts](app/api/webhooks/replicate-v2/route.ts) verifies the `standardwebhooks` signature, fetches the model output, uploads it to the `workflow-assets` bucket, writes the URL into `node_results` with `status='completed'`, and calls `checkAndDispatchChildren`.

6. **Chain reaction.** [lib/workflow/orchestrator.ts](lib/workflow/orchestrator.ts) finds the Blur node (downstream), confirms all its parents in `execution_id` are completed (scoped by `execution_id`, NOT `session_id` — using `session_id` would dispatch with stale results from a prior run), reads the cat image URL from the parent's `result_data`, and dispatches Blur.

7. **Ephemeral execution.** Blur is in `EPHEMERAL_HANDLERS` ([lib/workflow/handlers.ts](lib/workflow/handlers.ts)), so [lib/workflow/ephemeral-executor.ts](lib/workflow/ephemeral-executor.ts) runs in-process: fetches the image, applies `sharp().blur(radius)`, writes the buffer to the ephemeral storage bucket, updates `node_results`, calls `checkAndDispatchChildren` again. Blur has no children; the orchestrator calls `updateExecutionFinalStatus` and marks the execution `completed`.

8. **Live UI.** Throughout steps 4–7, the browser is subscribed to the session's `node_results` channel via [lib/hooks/use-execution-channel.ts](lib/hooks/use-execution-channel.ts). Each row update pushes status (`pending → running → completed`) and output URLs into the Zustand `execution` slice; the canvas re-renders node borders, the chat message gets the final image. No polling.

9. **Cleanup.** Files in `workflow-ephemeral-tmp` are TTL'd via pg_cron. Soft-deleted sessions are hard-deleted nightly by [app/api/cron/cleanup-sessions/route.ts](app/api/cron/cleanup-sessions/route.ts) (Vercel cron, authed via `CRON_SECRET`).

## Conventions worth knowing before editing

- **Path alias** `@/*` → repo root (see [tsconfig.json](tsconfig.json)).
- **Auth boundary** — [middleware.ts](middleware.ts) gates pages and most APIs. Public exceptions: `/api/auth`, `/api/image/generate*`, `/api/webhooks/*` (webhooks can't carry user cookies).
- **Service-role client** ([lib/supabase/service.ts](lib/supabase/service.ts)) bypasses RLS — use ONLY in webhooks/cron/background workers, never in user-facing handlers.
- **Workflow generation is patch-based**, not rewrite-based. The LLM emits ops like `addNode`/`updateNode`/`removeNode` ([lib/workflow/graph-ops.ts](lib/workflow/graph-ops.ts), [lib/workflow/workflow-patch.ts](lib/workflow/workflow-patch.ts)).
- **Adding an ephemeral node** = add one entry to `EPHEMERAL_HANDLERS` in [lib/workflow/handlers.ts](lib/workflow/handlers.ts) and create a plugin under `lib/nodes/plugins/<name>/` with the three required files.
- **`ai_models.inputs_schema` is the runtime source of truth** for the dynamic `ai_generator` node — not TypeScript types. Adding a new generative model means inserting a row, not writing code.
- **Zustand persistence is deliberate** — `runFromNodeId` and `runMode` MUST NOT survive a page refresh. The header comment in [lib/store/app-store.ts](lib/store/app-store.ts) is load-bearing; read it before changing what gets persisted.
