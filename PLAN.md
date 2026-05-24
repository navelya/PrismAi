# Workflow Engine — Design Rationale

This is the long-form rationale behind Prism AI's execution engine. Read it before changing dispatch/orchestrator code. For the concrete file map and end-to-end flow, see [ARCHITECTURE.md](ARCHITECTURE.md).

> **History note.** Older versions of this file contained a speculative design (an `executions.node_states` JSONB model, an `/api/executions/cancel` route, a claim that result caching was "not done") plus a long multi-analyst debate. None of that matched what was actually built. This document has been rewritten to describe the engine as it really works. Where the design intent and the implementation differ, both are called out.

## The foundation: two kinds of nodes

Every decision in the engine flows from one classification, stored on each node:

- **Persistent nodes** produce a stored file whose URL is written back and reused on later runs. They are: **AI Generator** (runs on Replicate, async), **Media Input** (uploaded by the user before any run), and **Character** (a frozen reference snapshot).
- **Ephemeral nodes** produce no permanent output. They are pure functions — same inputs + same config ⇒ same result. Their output is a temporary buffer/URL that exists only during execution. They are: **Blur**, **Levels**, **Compositor**, **Prompt**.

This split is why persistent outputs land in the permanent `chat-assets` bucket while ephemeral outputs land in `workflow-ephemeral-tmp` and are cleaned up after the run. It's also what makes result caching safe: an ephemeral node is fully determined by its inputs and config.

## Why a snapshot-and-dispatch engine

A run must be reproducible and isolated from edits the user makes mid-run. So when a run starts:

1. The executable subgraph for the chosen run mode is computed and **snapshotted** into `executions.graph_json`. The engine reads from this snapshot, never from the live canvas, so changing the canvas during a run can't corrupt it.
2. Every target node gets a `node_results` row at `status='pending'`.
3. Root nodes are dispatched. Everything after that is **event-driven**: each completion triggers a check for newly-ready children.

State is held in tables, not a single JSON blob:

- `executions` — the run (immutable `graph_json` snapshot + overall `status`).
- `node_results` — per-node state keyed by `(execution_id, node_id)`. **This is the heartbeat.** No `node_states` JSONB column exists.
- `node_predictions` — one row per fan-out prediction when an AI Generator runs `iterations > 1`.
- `node_output_cache` — hash-keyed result cache.

## Check-and-dispatch: the single driver of forward progress

`checkAndDispatchChildren(executionId, completedNodeId)` runs after every node completion (from an ephemeral handler or a Replicate webhook). It:

1. Loads the execution's `graph_json` snapshot.
2. Finds every node that lists the just-completed node as an input.
3. For each, checks whether **all** of its parents are `completed` **within this `execution_id`**.
4. If so, resolves that node's inputs from the parents' `node_results` and dispatches it.

**The `execution_id` scope is load-bearing.** Readiness must be checked per-execution, not per-session: two runs on the same session would otherwise see each other's results and dispatch nodes with stale inputs. This is the most common place subtle bugs get introduced — keep every readiness/result query scoped to `execution_id`.

When no children remain, the execution is marked `completed` (or `failed` if any node failed).

## Run modes

The run mode decides which nodes are in the snapshot ([lib/workflow/validate-execution.ts](lib/workflow/validate-execution.ts)):

- **`all`** — the whole graph; a fresh pipeline.
- **`solo`** — the target node plus its *ephemeral* ancestors (recursively). Generative ancestors are **not** re-run; their last results are read from `node_results` and pre-seeded. Re-running an AI node just to reproduce an image it already made would waste money.
- **`chain`** — `solo` plus everything downstream of the target (DFS forward). "Run this node and everything that depends on it."
- **`selection`** — an explicit set of nodes the user picked.

Out-of-set generative parents are captured as `preseedInputs` on the execution so the snapshot is self-contained.

## Result caching

Caching is **implemented** ([lib/workflow/persist-node.ts](lib/workflow/persist-node.ts)). Before a node's output is persisted, the engine computes `SHA-256(nodeType + config + inputUrls)` and looks it up in `node_output_cache`:

- **Hit** — return the cached thumbnail/result URLs, bump `last_used_at`, skip the actual work.
- **Miss** — execute, upload to storage, upsert the hash row.
- **`forceOverwrite`** — explicitly re-run target nodes bypass the cache so the user always gets a fresh result when they ask for one.

The hash deliberately excludes `node_id`, so identical logic on different node instances shares a cache entry. This is the main lever for keeping Replicate spend down during iterative editing.

## Storage lifecycle

- **`chat-assets`** (permanent) — Media Input uploads, AI Generator outputs, and leaf-node results, under `{userId}/{sessionId}/...`. Removed only when a session is hard-deleted by the cleanup cron.
- **`workflow-ephemeral-tmp`** (transient) — intermediate ephemeral outputs under `{executionId}/{nodeId}/...`, cleaned up when the execution reaches a terminal state.
- Per-node **thumbnail** folders are wiped before each run so stale previews never accumulate.

## Double-dispatch safety

Concurrent webhook arrivals could try to dispatch the same child twice. The guard is that a node only transitions out of `pending` once; the dispatcher that wins the transition owns the dispatch. Keep this invariant intact when touching `node_results` updates — without it, duplicate Replicate predictions (and duplicate charges) are possible.

## What is intentionally NOT built yet

These are real gaps, not hidden features. Don't assume they exist:

- **Run cancellation.** Cancelling a run mid-flight is not possible in this architecture, and there is no `/api/executions/cancel` route. Once a run starts, credits are debited up front and generative work is submitted to Replicate as fire-and-forget async predictions; the chain reaction is then driven entirely by stateless serverless webhook invocations, with no central long-running process to signal or interrupt. The `cancelled` status exists in the enum but nothing sets it. Truly supporting cancellation would mean more than adding a route — it requires a way to stop in-flight predictions (which are already billed by Replicate) and a credit-refund/settlement policy for partially-completed runs.
- **Automatic retry of failed nodes.** Re-running is manual (the run modes allow it). A transient Replicate failure currently fails the run; auto-retrying just the failed node would save the user a full re-run.
- **Stuck-node recovery.** If a webhook is missed, a node can sit in `running` indefinitely. There is no watchdog cron checking Replicate for the real status of long-running predictions.
- **Execution history UI.** The `executions` table accumulates every run, but there is no per-session history view. Surfacing it is a read-only query — no schema change required.

## Things to keep true when editing the engine

- Read from the execution **snapshot**, never the live canvas.
- Scope every readiness/result query by **`execution_id`**.
- Preserve the single-transition-out-of-`pending` guard against double dispatch.
- Don't re-run generative ancestors in `solo`/`chain` — pre-seed them from the DB.
- Respect the persistent/ephemeral split when choosing a storage bucket and deciding cache eligibility.
