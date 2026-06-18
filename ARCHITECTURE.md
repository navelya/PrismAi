# Architecture

Prism AI is a chat-driven, node-based image/media workflow editor. A user describes an outcome in chat, an LLM emits a workflow graph patch, the user runs it, and a server-side DAG orchestrator dispatches each node — either to Replicate (generative AI) or to a local Sharp-based handler (ephemeral transforms).

The single most important architectural concept is the **persistent vs. ephemeral node split** — see [PLAN.md](PLAN.md) for the full rationale. Persistent nodes (Generative AI, Media Input) produce stored URLs. Ephemeral nodes (Blur, Levels, Compositor, Prompt) are pure functions that produce buffers. Almost every other design decision in the codebase derives from this distinction.

## Top-level folders

| Folder | Purpose |
|---|---|
| [app/](app/) | Next.js 14 App Router. Pages (`chat`, `library`, `settings`, `admin`, `nodes`, `demo`, `auth/callback`, `login`) plus all API routes under `app/api/`. |
| [app/api/](app/api/) | Server endpoints — execution engine (`executions/`, `webhooks/replicate-v2/`), chat streaming (`chat/stream/`), CRUD (`sessions/`, `messages/`, `models/`, `user/`), uploads (`upload/`), admin tools (`admin/`), and a daily Vercel cron (`cron/cleanup-sessions/`). |
| [components/](components/) | React components grouped by surface: `chat/`, `editor/` (React Flow canvas + panels), `canvas/` (per-node React Flow renderers), `compositor/` (Konva-based layer editor), `library/`, `admin/`, `billing/`, `characters/`, `layout/`, `theme/`, `providers/`, `ui/` (design system primitives). |
| [lib/nodes/](lib/nodes/) | The plugin system. Each node type lives in `plugins/<name>/` and exports three pieces — see "Node plugin layout" below. `core/` aggregates them into shared/client/server registries; `registry.ts` re-exports the server registry; `types.ts` defines `WorkflowNode`/`Workflow`/`NodeExecutor`. |
| [lib/chat/](lib/chat/) | **The chat brain** — turns a user message into workflow graph ops via **Anthropic Claude** (NOT Gemini). `brain.ts` runs the agentic tool loop; `prompt/` builds the cached system prompt + live registry introspection; `tools/` defines the LLM tools (`add_node`, `update_node`, `remove_node`, `update_compositor_layer`, `ask_clarification`, `propose_plan`) and their handlers; `provider/anthropic.ts` streams turns with 1h prompt caching; `task-loop.ts`, `streaming/`, `registry-cache.ts`. |
| [lib/workflow/](lib/workflow/) | The v2 execution engine. Entry: `start` route → `dispatch-v2.ts` → `orchestrator.ts` (chain reaction) → `ephemeral-executor.ts` or `handlers.ts` (Sharp/ffmpeg transforms) for ephemeral nodes; Replicate for persistent. `result-format.ts` defines the typed-edge contract; `workflow-patch.ts`/`graph-ops.ts` apply LLM-emitted ops. |
| [lib/billing/](lib/billing/) | **Credits + subscriptions via Paddle.** `paddle-client.ts`/`paddle-server.ts` (SDK wrappers), `pricing-source.ts` (DB-backed runtime source of truth for plan/pack pricing + price-id→plan/pack lookups incl. archived ids; `plans-config.ts` now holds only static structure + seed defaults), `paddle-pricing.ts` (admin price create/archive), `cost.ts` (credit cost model), `run-plan.ts`, and the `use-*` hooks (`use-balance`, `use-subscription`, `use-credit-breakdown`, `use-pricing`) + ledger pollers. Admin pricing edits live under `app/api/admin/pricing/` and `components/admin/PricingAdminContent.tsx`. |
| [lib/store/](lib/store/) | Zustand store split into slices (`workflow`, `chat`, `execution`, `ui`, `live-position`). `app-store.ts` documents the persistence policy — what survives a page refresh and what must not. |
| [lib/supabase/](lib/supabase/) | Three Supabase clients: `client.ts` (browser), `server.ts` (SSR with cookies), `service.ts` (service-role, RLS-bypassing — only for webhooks/cron/background workers). |
| [lib/ai/](lib/ai/) | Thin clients for Gemini and Replicate plus a model-manager / rate-limit tracker. Gemini is used for **session-title generation and some image-gen routes**, NOT the chat brain (that's [lib/chat/](lib/chat/), Claude). |
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
| **Supabase** | Postgres (sessions, executions, node_results, node_predictions, ai_models, assets, characters, subscriptions, credit_ledger, profiles), Auth, Storage (`workflow-assets` / `chat-assets` permanent + `workflow-ephemeral-tmp` TTL'd), Realtime channels for live execution status and balance. | Server clients in [lib/supabase/](lib/supabase/); browser via Realtime in [lib/hooks/use-execution-channel.ts](lib/hooks/use-execution-channel.ts). |
| **Anthropic Claude** | **Chat → workflow generation** (the chat brain). Haiku 4.5 (free tier) / Sonnet 4.6 (paid), `nodejs` runtime, agentic tool loop with 1h prompt caching. | [app/api/chat/stream/route.ts](app/api/chat/stream/route.ts), [lib/chat/provider/anthropic.ts](lib/chat/provider/anthropic.ts). |
| **Google Gemini** | Session-title generation (Gemini Flash Lite) and some image-gen routes (`/api/image/generate-gemini`). NOT the chat brain. | [app/api/session/generate-title/route.ts](app/api/session/generate-title/route.ts), [lib/ai/gemini-client.ts](lib/ai/gemini-client.ts). |
| **Replicate** | All generative AI nodes. Async predictions with webhook callbacks; fan-out (`iterations > 1`) tracked in `node_predictions`. | [lib/workflow/dispatch-v2.ts](lib/workflow/dispatch-v2.ts) submits, [app/api/webhooks/replicate-v2/route.ts](app/api/webhooks/replicate-v2/route.ts) receives. |
| **Paddle** | Billing — subscriptions (Free/Starter/Pro/Studio) + one-time credit packs. Inline checkout, webhook-driven state sync, chargeback/refund handling. | [lib/billing/](lib/billing/), `app/api/billing/*`, [app/api/webhooks/paddle/route.ts](app/api/webhooks/paddle/route.ts). |
| **Vercel** | Hosting (Next.js), `@vercel/functions` `waitUntil` for fire-and-forget background work, Speed Insights, Analytics, Cron (`cleanup-sessions`, `sync`, `topup`, `apply-pending-changes`, `warm-cache` — see [vercel.json](vercel.json)). |
| **Pollinations.ai** | Free fallback image generation, no API key. Routed via `/api/image/generate*`. |

## Main data flow

```
┌─────────┐  chat msg  ┌──────────────────┐  workflow patch   ┌──────────────┐
│ Browser │ ─────────▶ │ /api/chat/stream │ ─── stream tool ──▶ │ Zustand      │
│         │            │ (nodejs, Claude) │   call deltas      │ workflow     │
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

1. **Chat → workflow.** [components/chat/ChatInterface.tsx](components/chat/ChatInterface.tsx) POSTs the message + `previousWorkflow` to [app/api/chat/stream/route.ts](app/api/chat/stream/route.ts) (`nodejs` runtime). [lib/chat/brain.ts](lib/chat/brain.ts) runs an agentic **Claude** tool loop (up to `MAX_ITERATIONS=6`): the system prompt introspects `sharedRegistry` + the live `ai_models` catalog (cached 1h), and Claude emits structured ops (`add_node`/`update_node`/`remove_node`/`update_compositor_layer`, or the terminal `ask_clarification`/`propose_plan`). [lib/workflow/graph-ops.ts](lib/workflow/graph-ops.ts) + [lib/workflow/workflow-patch.ts](lib/workflow/workflow-patch.ts) apply each op as a **patch, not a rewrite** — so user edits made between turns survive. ELK auto-layouts new nodes. The patch streams into the Zustand `workflow` slice live.

2. **User reviews & runs.** The canvas in [components/editor/EditorCanvas.tsx](components/editor/EditorCanvas.tsx) renders nodes via React Flow using `clientRegistry`. The user clicks Run; the editor sets `runFromNodeId` + `runMode` (`all`/`solo`/`chain`), which `SharedWorkflowEditor` watches and POSTs to `/api/executions/start`.

3. **Snapshot & seed.** [app/api/executions/start/route.ts](app/api/executions/start/route.ts) builds the target set per `runMode`, snapshots the subgraph into `executions.graph_json` (immutable for this run), inserts one `node_results` row per target node with `status='pending'`, and dispatches the root nodes.

4. **Persistent root: Replicate.** The AI Generator node is dispatched by [lib/workflow/dispatch-v2.ts](lib/workflow/dispatch-v2.ts) — looks up the model via `ai_models.replicate_model_id`, submits a prediction with `webhook = $NEXT_PUBLIC_APP_URL/api/webhooks/replicate-v2` and `metadata = {execution_id, node_id}`, returns immediately. Replicate runs the model out-of-process.

5. **Webhook arrives.** [app/api/webhooks/replicate-v2/route.ts](app/api/webhooks/replicate-v2/route.ts) verifies the `standardwebhooks` signature, fetches the model output, uploads it to the `workflow-assets` bucket, writes the URL into `node_results` with `status='completed'`, and calls `checkAndDispatchChildren`.

6. **Chain reaction.** [lib/workflow/orchestrator.ts](lib/workflow/orchestrator.ts) finds the Blur node (downstream), confirms all its parents in `execution_id` are completed (scoped by `execution_id`, NOT `session_id` — using `session_id` would dispatch with stale results from a prior run), reads the cat image URL from the parent's `result_data`, and dispatches Blur.

7. **Ephemeral execution.** Blur is in `EPHEMERAL_HANDLERS` ([lib/workflow/handlers.ts](lib/workflow/handlers.ts)), so [lib/workflow/ephemeral-executor.ts](lib/workflow/ephemeral-executor.ts) runs in-process: fetches the image, applies `sharp().blur(radius)`, writes the buffer to the ephemeral storage bucket, updates `node_results`, calls `checkAndDispatchChildren` again. Blur has no children; the orchestrator calls `updateExecutionFinalStatus` and marks the execution `completed`.

8. **Live UI.** Throughout steps 4–7, the browser is subscribed to the session's `node_results` channel via [lib/hooks/use-execution-channel.ts](lib/hooks/use-execution-channel.ts). Each row update pushes status (`pending → running → completed`) and output URLs into the Zustand `execution` slice; the canvas re-renders node borders, the chat message gets the final image. No polling.

9. **Cleanup.** Files in `workflow-ephemeral-tmp` are TTL'd via pg_cron. Soft-deleted sessions are hard-deleted nightly by [app/api/cron/cleanup-sessions/route.ts](app/api/cron/cleanup-sessions/route.ts) (Vercel cron, authed via `CRON_SECRET`).

## Subsystems beyond the core graph engine

The execution engine is the heart, but several large subsystems sit around it and are easy to miss:

- **Credits + billing (Paddle).** Every generative run is metered. [lib/billing/cost.ts](lib/billing/cost.ts) computes a credit cost from the `ai_models` row + controls; `/api/executions/start` does a **cost pre-flight + debit before dispatch** and `updateExecutionFinalStatus` calls `refund_tokens` on failure. Plans (Free/Starter/Pro/Studio) and one-time packs are defined in [lib/billing/plans-config.ts](lib/billing/plans-config.ts); checkout is Paddle inline ([app/checkout/[planId]](app/checkout/)); state is reconciled by [app/api/webhooks/paddle/route.ts](app/api/webhooks/paddle/route.ts) plus self-healing crons (`sync`, `topup`, `apply-pending-changes`). State lives in `subscriptions`, `credit_ledger`, and `profiles` (the `payment_disputed_at` chargeback flag blocks plan changes). Hooks: `use-balance`, `use-subscription`, `use-credit-breakdown`.
- **Characters (consistency references).** A first-class feature, not just a node. `characters` / `character_drafts` / shared-character tables back a CRUD API (`/api/characters/*`) with auto-describe and auto-generate (`/api/characters/generate`, `/auto-describe`). The `character` node embeds a **frozen snapshot** (1–5 reference images + weight) into the graph so a run is reproducible even if the source character is later edited. The chat brain only sees the character's name/description (server-side hydration injects the image URLs) to stop the LLM fabricating references.
- **Compositor (layered timeline).** More than a blend node — [components/compositor/](components/compositor/) is a Konva-based layer editor with per-layer transform/opacity/blend + **timeline fields** (`startTime`, `duration`) and forward-compat trim/speed/transition placeholders. The server executor uses ffmpeg for video composition; the chat brain edits it via the dedicated `update_compositor_layer` tool.
- **Admin console.** [app/admin](app/admin/) + `/api/admin/*` is a full back-office: AI-model registry (the runtime source of truth for `ai_generator`), providers, node-types/sub-categories, a canvas context-menu builder, and user management (ban, toggle-admin, adjust-tokens, ledger/asset inspection, stats export). Gated by `profiles.is_admin`.
- **Public + account surfaces.** Beyond the editor: a marketing landing page (`/`), `/pricing`, `/checkout/[planId]`, `/billing/success`, `/legal/*`, a multi-tab `/settings` (profile, editor, plan & billing, tokens & credits), `/library`, and `/assets`.

## Conventions worth knowing before editing

- **Path alias** `@/*` → repo root (see [tsconfig.json](tsconfig.json)).
- **Auth boundary** — [middleware.ts](middleware.ts) gates pages and most APIs. Public exceptions: `/api/auth`, `/api/image/generate*`, `/api/webhooks/*` (webhooks can't carry user cookies).
- **Service-role client** ([lib/supabase/service.ts](lib/supabase/service.ts)) bypasses RLS — use ONLY in webhooks/cron/background workers, never in user-facing handlers.
- **Workflow generation is patch-based**, not rewrite-based. The LLM emits ops like `addNode`/`updateNode`/`removeNode` ([lib/workflow/graph-ops.ts](lib/workflow/graph-ops.ts), [lib/workflow/workflow-patch.ts](lib/workflow/workflow-patch.ts)).
- **Adding an ephemeral node** = add one entry to `EPHEMERAL_HANDLERS` in [lib/workflow/handlers.ts](lib/workflow/handlers.ts) and create a plugin under `lib/nodes/plugins/<name>/` with the three required files.
- **`ai_models.inputs_schema` is the runtime source of truth** for the dynamic `ai_generator` node — not TypeScript types. Adding a new generative model means inserting a row, not writing code.
- **Zustand persistence is deliberate** — `runFromNodeId` and `runMode` MUST NOT survive a page refresh. The header comment in [lib/store/app-store.ts](lib/store/app-store.ts) is load-bearing; read it before changing what gets persisted.
