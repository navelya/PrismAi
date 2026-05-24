# Architecture

Prism AI is a chat-driven, node-based image/media workflow editor for solo designers. A user describes an outcome in chat, **Claude** (Anthropic) emits a workflow-graph patch via tool calls, the user runs it, and a server-side DAG orchestrator dispatches each node — either to Replicate (generative AI) or to a local Sharp-based handler (ephemeral transforms). Runs are metered against a credit balance backed by Paddle billing.

The single most important architectural concept is the **persistent vs. ephemeral node split** — see [PLAN.md](PLAN.md) for the full rationale. Persistent nodes (AI Generator, Media Input, Character) produce stored URLs. Ephemeral nodes (Blur, Levels, Compositor) are pure functions that produce buffers. Almost every other design decision in the codebase derives from this distinction.

> **Note on accuracy.** This document was rewritten to match the code as of May 2026. Earlier revisions described a Gemini-on-edge chat brain and an `executions.node_states` JSONB execution model — both stale. The chat brain is Claude on the Node.js runtime; execution state lives in the `node_results` table. See the data-flow and execution sections below for the current truth.

## Top-level folders

| Folder | Purpose |
|---|---|
| [app/](app/) | Next.js 14 App Router. Pages (`chat`, `library`, `assets`, `settings`, `pricing`, `checkout`, `billing`, `admin`, `nodes`, `demo`, `legal`, `login`, `auth/callback`) plus all API routes under `app/api/`. |
| [app/api/](app/api/) | Server endpoints — execution engine (`executions/`, `webhooks/replicate-v2/`), chat streaming (`chat/stream/`), CRUD (`sessions/`, `messages/`, `models/`, `characters/`, `user/`), uploads (`upload/`), billing (`billing/`, `webhooks/paddle/`), admin tools (`admin/`), image fallbacks (`image/`), telemetry (`telemetry/`), and Vercel crons (`cron/`). |
| [components/](components/) | React components grouped by surface: `chat/`, `editor/` (React Flow canvas + panels), `canvas/` (per-node React Flow renderers), `compositor/` (Konva-based layer editor), `library/`, `billing/`, `admin/`, `layout/`, `theme/`, `providers/`, `ui/` (design system primitives). |
| [lib/chat/](lib/chat/) | The chat brain. `brain.ts` (`runBrain`) runs the Claude tool-calling loop; `provider/anthropic.ts` streams turns; `tools/` defines and dispatches the workflow-mutation tools; `prompt/` builds the system prompt + node-registry context; `task-loop.ts` synthesizes multi-task plan blueprints. |
| [lib/nodes/](lib/nodes/) | The plugin system. Each node type lives in `plugins/<name>/` and exports shared/client/server pieces — see "Node plugin layout" below. `core/` aggregates them into shared/client/server registries; `core/types.ts` defines `WorkflowNode`/`Workflow`/node-def types. |
| [lib/workflow/](lib/workflow/) | The execution engine. Entry: `executions/start` route → `dispatch-v2.ts` → `orchestrator.ts` (chain reaction) → `ephemeral-executor` (Sharp transforms) for ephemeral nodes; Replicate for persistent. `persist-node.ts` handles output storage + result caching. `validate-execution.ts` resolves run scope per run mode. |
| [lib/billing/](lib/billing/) | Credits + Paddle. `plans-config.ts` (plan catalog), `cost.ts` (per-node credit cost computation), `paddle-server.ts`/`paddle-client.ts`/`paddle-mapping.ts` (Paddle integration), and balance/subscription hooks. |
| [lib/store/](lib/store/) | Zustand store split into slices (`workflow`, `chat`, `execution`, `ui`, `live-position`). `app-store.ts` documents the persistence policy — what survives a page refresh and what must not. |
| [lib/supabase/](lib/supabase/) | Three Supabase clients: `client.ts` (browser), `server.ts` (SSR with cookies), `service.ts` (service-role, RLS-bypassing — only for webhooks/cron/background workers). |
| [lib/ai/](lib/ai/) | `replicate-client.ts` (used by the execution layer). `gemini-client.ts` and `model-manager.ts` are **legacy** — remnants of an earlier Gemini-backed generation path, not used by the chat brain. |
| [lib/hooks/](lib/hooks/), [lib/db/](lib/db/), [lib/storage/](lib/storage/), [lib/utils/](lib/utils/), [lib/editor/](lib/editor/) | React hooks (sessions, chat, upload, undo/redo, the realtime `use-execution-channel` subscribing to `node_results`), DB helpers, storage upload helpers, generic utilities (graph layout/traversal, schema parsing), and the React Flow node factory. |
| [hooks/](hooks/) | Page-level workflow editor hooks (`useAutoSave`, `useWorkflowEditor`, `useWorkflowLibrary`). Distinct from the atomic `lib/hooks/`. |
| [supabase/migrations/](supabase/migrations/) | Postgres schema history. The migrations *are* the source of truth — `supabase_*.sql` snapshots at the root are stale. |
| [scripts/](scripts/) | One-off Node scripts for poking at execution / Supabase. Not a test suite — run by hand. |
| [middleware.ts](middleware.ts) | Supabase auth gate for app pages and most `/api/*`. |

### Node plugin layout

Each plugin (e.g. [lib/nodes/plugins/blur/](lib/nodes/plugins/blur/)) is split by *bundle target* — Next.js compiles client and server separately, and `sharp` cannot ship to the browser. Typical files:

- `definition.ts` → **shared def** (type, family, handles, config type/schema, `defaultConfig`). Safe to import anywhere; aggregated in [lib/nodes/core/shared-registry.ts](lib/nodes/core/shared-registry.ts) and consumed by the chat brain.
- `component.tsx` / `properties.tsx` → **client def** (React Flow node + property panel). Aggregated in [lib/nodes/core/client-registry.ts](lib/nodes/core/client-registry.ts). Browser-only.
- `executor.client.ts` → **optional client-side executor** for live in-canvas preview (e.g. blur previewed locally without a server round-trip).
- `executor.server.ts` → **server def** (`(config, inputs, context) => result`). Aggregated in [lib/nodes/core/server-registry.ts](lib/nodes/core/server-registry.ts). Server-only — imports `sharp`.
- `index.ts` → barrel that re-exports the shared + client pieces. It **must not** export `executor.server.ts` (would leak `sharp` into the browser bundle); the server registry imports the server executor directly.

The `ai_generator` node is special: its handles and controls are loaded at runtime from the `ai_models.inputs_schema` JSONB column, not from a static definition.

## Node types shipped today

| Type | Family | Persistence | What it does |
|---|---|---|---|
| `ai_generator` | generative | persistent | Dynamic generative node; model + controls come from the `ai_models` row. Supports `iterations` (fan-out) and output selection. |
| `media_input` | input | persistent | User-uploaded image(s). |
| `character` | input | persistent | Reusable character reference (name, 1–6 reference images, description, weight). Config is a frozen snapshot so saved workflows survive edits/deletes. |
| `prompt` | input | ephemeral | Text string output. |
| `blur` | utility | ephemeral | Gaussian/box/stack blur on image or video (Sharp). |
| `levels` | utility | ephemeral | Tonal remap: black/white points + gamma. |
| `compositor` | output | ephemeral | Konva-based multi-layer compositor (position/scale/rotation/opacity/blend/crop; video-aware). |

## External services

| Service | Used for | Touched from |
|---|---|---|
| **Supabase** | Postgres (sessions, messages, executions, node_results, node_predictions, node_output_cache, ai_models, characters, profiles, plans, subscriptions, token_ledger), Auth, Storage (`chat-assets` permanent + `workflow-ephemeral-tmp` TTL'd), Realtime channels for live execution status. | Server clients in [lib/supabase/](lib/supabase/); browser via Realtime in [lib/hooks/use-execution-channel.ts](lib/hooks/use-execution-channel.ts). |
| **Anthropic Claude** | Chat → workflow generation. `@anthropic-ai/sdk`, **Node.js runtime**. Claude Haiku 4.5 (free tier) and Sonnet 4.6 (paid), gated server-side by plan. | [app/api/chat/stream/route.ts](app/api/chat/stream/route.ts), [lib/chat/](lib/chat/). |
| **Replicate** | All generative AI nodes. Async predictions with webhook callbacks. | [lib/workflow/dispatch-v2.ts](lib/workflow/dispatch-v2.ts) submits, [app/api/webhooks/replicate-v2/route.ts](app/api/webhooks/replicate-v2/route.ts) receives. |
| **Paddle** | Subscription billing + credit purchases. | [lib/billing/](lib/billing/), [app/api/billing/](app/api/billing/), [app/api/webhooks/paddle/route.ts](app/api/webhooks/paddle/route.ts). |
| **Google Gemini** | Session-title generation and image fallbacks. Not the chat brain. | [lib/ai/gemini-client.ts](lib/ai/gemini-client.ts), [app/api/image/generate-gemini/](app/api/image/generate-gemini/). |
| **Vercel** | Hosting (Next.js), `@vercel/functions` `waitUntil` for fire-and-forget background work, Speed Insights, Analytics, Cron (see [vercel.json](vercel.json)). |
| **Pollinations.ai / Hugging Face** | Fallback image generation paths. | [app/api/image/generate/](app/api/image/generate/), [app/api/image/generate-hf/](app/api/image/generate-hf/). |

## Main data flow

```
┌─────────┐  chat msg  ┌──────────────────┐  tool calls →     ┌──────────────┐
│ Browser │ ─────────▶ │ /api/chat/stream │ ─ workflow patch ─▶ │ Zustand      │
│         │            │ (nodejs, Claude  │   (NDJSON stream)  │ workflow     │
└─────────┘            │  via lib/chat)   │                    │ slice        │
     │                 └──────────────────┘                    └──────┬───────┘
     │ user clicks Run                                                │
     ▼                                                                ▼
┌──────────────────────┐  POST graph + mode  ┌─────────────────────────────┐
│ /api/executions/start│ ──────────────────▶ │ executions row (graph_json   │
│ (snapshot subgraph,  │                     │ snapshot) + node_results rows│
│  debit credits)      │                     │ for every target = pending   │
└──────────┬───────────┘                     └─────────────────────────────┘
           │ dispatch root nodes (dispatch-v2)
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
checkAndDispatchChildren(executionId, completedNodeId)   ← scoped by execution_id
   │
   │ for each child whose parents are ALL completed IN THIS execution_id
   ▼
dispatch child ──▶ ... chain continues until no children left
                   then mark execution completed/failed
                                  │
                                  ▼
                       ┌──────────────────────┐
                       │ Supabase Realtime     │
                       │ pushes node_results   │
                       │ updates to the browser│
                       └──────────┬───────────┘
                                  ▼
                          Canvas + chat update live
```

## How a chat message becomes a workflow

1. **Stream request.** [components/chat/ChatInterface.tsx](components/chat/ChatInterface.tsx) POSTs the message, the previous workflow, attached images (≤4, uploaded to storage so the model only sees stable URLs), selected node refs, and any `@`-mentioned character IDs to [app/api/chat/stream/route.ts](app/api/chat/stream/route.ts).

2. **Plan + model gating.** The route resolves the user's plan: free tier is forced to Claude Haiku 4.5; paid tiers default to Sonnet 4.6 (and may opt down to Haiku).

3. **The brain loop.** `runBrain` ([lib/chat/brain.ts](lib/chat/brain.ts)) runs a tool-calling loop (max 6 iterations) against Claude with extended thinking enabled for non-trivial messages. The system prompt embeds a registry context ([lib/chat/prompt/registry-context.ts](lib/chat/prompt/registry-context.ts)) describing every node type, its handles, and the live `ai_models` catalog so the model knows valid `targetHandle`s per model. Tools: `add_node`, `update_node`, `update_compositor_layer`, `remove_node`, `ask_clarification`, `propose_plan`.

4. **Patches, not rewrites.** Each tool returns a `WorkflowPatch` (added/updated/removed nodes + edges) via [lib/workflow/graph-ops.ts](lib/workflow/graph-ops.ts); patches are merged and applied with [lib/workflow/workflow-patch.ts](lib/workflow/workflow-patch.ts), preserving user edits made between turns. Events (thinking, text, tool+patch, clarifications, plan cards) stream to the client as NDJSON.

5. **Plans.** For larger requests the brain may `propose_plan`; when the user approves, the route replays the stored plan, and [lib/chat/task-loop.ts](lib/chat/task-loop.ts) synthesizes each task into a grouped blueprint and applies it.

## How a run executes, end to end

1. **Start.** [app/api/executions/start/route.ts](app/api/executions/start/route.ts) receives `session_id`, `graph_json`, the target node(s), and the run `mode`. It computes the executable subgraph for the mode, snapshots it (plus `preseedInputs` for out-of-set generative parents read from prior `node_results`) into `executions.graph_json` (immutable for this run), **debits credits idempotently on `execution_id`**, inserts one `node_results` row per target node (`status='pending'`), and dispatches root nodes via [lib/workflow/dispatch-v2.ts](lib/workflow/dispatch-v2.ts).

2. **Run modes** ([lib/workflow/validate-execution.ts](lib/workflow/validate-execution.ts)):
   - `all` — every node in the graph.
   - `solo` — the target plus its ephemeral ancestors (generative ancestors are read from the DB, not re-run).
   - `chain` — `solo` plus all downstream descendants.
   - `selection` — an explicit multi-node set.

3. **Persistent dispatch.** `ai_generator` is submitted to Replicate with `webhook = $NEXT_PUBLIC_APP_URL/api/webhooks/replicate-v2` and metadata `{execution_id, node_id}`. Fan-out (`iterations > 1`) is tracked per prediction in the `node_predictions` table.

4. **Webhook.** [app/api/webhooks/replicate-v2/route.ts](app/api/webhooks/replicate-v2/route.ts) verifies the `standardwebhooks` signature, persists the output, writes the URL into `node_results` (`status='completed'`), and calls `checkAndDispatchChildren`.

5. **Chain reaction.** [lib/workflow/orchestrator.ts](lib/workflow/orchestrator.ts) loads the execution's graph snapshot, finds children whose parents are **all** completed **within this `execution_id`** (NOT `session_id` — that would pull stale results from a prior run), resolves their inputs from parent `node_results`, and dispatches them. Ephemeral nodes run in-process via Sharp.

6. **Result caching.** Before producing output, [lib/workflow/persist-node.ts](lib/workflow/persist-node.ts) computes `SHA-256(nodeType + config + inputUrls)` and looks it up in the `node_output_cache` table. On a hit it returns the cached URLs and skips re-execution (bumping `last_used_at`); `forceOverwrite` bypasses the cache for explicitly re-run target nodes. This deduplicates work across runs and cuts Replicate cost on iterative editing.

7. **Storage.** Persistent outputs and leaf-node results go to the permanent `chat-assets` bucket (`{userId}/{sessionId}/...`); intermediate ephemeral outputs go to `workflow-ephemeral-tmp` and are cleaned up when the execution reaches a terminal state. Per-node thumbnail folders are wiped before each run.

8. **Live UI.** The browser subscribes to the session's `node_results` channel via [lib/hooks/use-execution-channel.ts](lib/hooks/use-execution-channel.ts); each row update pushes status and output URLs into the Zustand `execution` slice. No polling.

## Execution state model

State lives in tables, not a single JSONB blob:

- **`executions`** — one row per run. `graph_json` is the immutable snapshot; `status` ∈ {pending, running, completed, failed, cancelled}.
- **`node_results`** — per-node state, keyed by `(execution_id, node_id)`. Columns include `status`, `result_type`/`result_data`, `error`, `replicate_id`, `node_type`, `session_id` (for realtime grouping). **This is the source of truth for execution progress** — there is no `executions.node_states` JSONB column.
- **`node_predictions`** — one row per fan-out prediction when `iterations > 1`.
- **`node_output_cache`** — hash-keyed result cache (see above).

The legacy `node_executions` table exists in migration history but is **not used** by the current engine.

## Billing & credits

- **Provider:** Paddle. Plans (`free`, `starter`, `pro`, `studio`) are defined in [lib/billing/plans-config.ts](lib/billing/plans-config.ts); each grants a monthly credit allotment.
- **Cost:** [lib/billing/cost.ts](lib/billing/cost.ts) computes a node's credit cost from the model's base cost plus per-control and per-connected-item modifiers, multiplied by `iterations`. A client estimate is shown pre-run (`CreditConfirmModal`); the server debits on `start` within a small drift tolerance and caps per-run cost.
- **Ledger:** `profiles.token_balance` (guarded by a tamper-proof trigger) is the live balance; `token_ledger` is the append-only history (signup bonus, monthly top-up, execution debit/refund, purchases, subscription grants, admin adjustments, Paddle events).
- **Webhooks/crons:** [app/api/webhooks/paddle/route.ts](app/api/webhooks/paddle/route.ts) syncs subscription state; daily crons handle top-ups, reconciliation, and scheduled plan changes (see below).

## Cron jobs (see [vercel.json](vercel.json))

| Path | Schedule (UTC) | Purpose |
|---|---|---|
| `/api/cron/cleanup-sessions` | `0 2 * * *` | Hard-delete soft-deleted sessions and wipe their `chat-assets` storage. |
| `/api/cron/topup` | `0 3 * * *` | Monthly credit top-up for active subscriptions whose `next_topup_at` has passed (idempotent RPC). |
| `/api/cron/reconcile` | `0 4 * * *` | Reconcile billing/subscription state. |
| `/api/cron/apply-pending-changes` | `0 5 * * *` | Apply scheduled plan changes once Paddle renews. |

`/api/cron/warm-cache` exists to keep the Anthropic prompt-cache prefix warm; ephemeral storage TTL is handled at the bucket/cleanup level rather than by a Vercel cron.

## Conventions worth knowing before editing

- **Path alias** `@/*` → repo root (see [tsconfig.json](tsconfig.json)).
- **Auth boundary** — [middleware.ts](middleware.ts) gates pages and most APIs. Public exceptions: `/api/auth`, `/api/image/generate*`, and `/api/webhooks/*` (webhooks can't carry user cookies).
- **Service-role client** ([lib/supabase/service.ts](lib/supabase/service.ts)) bypasses RLS — use ONLY in webhooks/cron/background workers, never in user-facing handlers.
- **Orchestrator readiness is scoped by `execution_id`, not `session_id`** — using `session_id` would dispatch with stale results from a prior run.
- **`runFromNodeId` and `runMode` MUST NOT survive a page refresh** — they are trigger signals; rehydrating them re-fires executions on load. The persistence config in [lib/store/app-store.ts](lib/store/app-store.ts) deliberately excludes them.
- **Three-way registry split** in [lib/nodes/core/](lib/nodes/core/) — don't import the server registry from a client component (pulls `sharp` into the browser) or vice versa.
- **`ai_models.inputs_schema` is the runtime source of truth** for the dynamic `ai_generator` node — adding a generative model is usually a DB row, not a code change.
- **Not implemented yet:** run cancellation (no `/api/executions/cancel`, no Replicate `predictions.cancel()`), automatic retry of failed nodes (re-running is manual), and stuck-node recovery.
