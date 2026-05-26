# Chat-run nodes with inline results & cost-gated auto-run

**Date:** 2026-05-26
**Status:** Design approved, pending implementation plan

## Problem

Today the chat brain only *edits* the workflow graph — it emits node/edge patches and the
user must switch attention to the canvas and click **Run** to execute. The user wants the
chat to feel agentic: after the AI builds or changes nodes, it should be able to run those
nodes and show the results **inline in the chat**, gated by cost.

Desired behavior:

- After an AI turn touches runnable nodes, estimate the credit cost of running them.
- If the cost is at or below the user's **max auto-run credits** (default **10**), run
  automatically and show the result inline.
- Otherwise finish the turn with a "Ready to run" state and a **Run** button that shows the
  cost. The user can click it, keep typing to change things, or just continue.
- Show the result of **the nodes the AI ran** directly in the chat.

## The one hard rule

The run decision is bound to **end-of-stream only** — evaluated after `endAiTurn()` on the
**clean-completion path** of the stream reader loop
([lib/hooks/use-chat-messages.ts:567-587](../../../lib/hooks/use-chat-messages.ts#L567-L587)).
It must **never** be triggered from the `catch` path
([use-chat-messages.ts:589-599](../../../lib/hooks/use-chat-messages.ts#L589-L599)), nor from
per-`tool` events ([use-chat-messages.ts:494-528](../../../lib/hooks/use-chat-messages.ts#L494-L528)),
nor from `task_start`/`task_complete`/`tasks_complete`
([use-chat-messages.ts:454-493](../../../lib/hooks/use-chat-messages.ts#L454-L493)).

This is what guarantees a multi-task plan runs **once, after all tasks finish** — not after
each task. The whole task loop executes inside a single stream / single HTTP request, so
there is exactly one `beginAiTurn()`/`endAiTurn()` pair per stream regardless of task count.
The accumulated `aiTurn.touchedNodeIds` is the complete touched set at end-of-stream.

## Why Approach A (client-orchestrated, reuse existing run pipeline)

Most building blocks already exist:

- **Running from outside the canvas already works.** The UI slice exposes
  `triggerRunSelection(nodeIds)` / `triggerRunFromNode(nodeId, mode)`
  ([lib/store/slices/ui-slice.ts:160-169](../../../lib/store/slices/ui-slice.ts#L160-L169));
  `SharedWorkflowEditor` watches those run signals, computes cost, optionally shows a credit
  modal, and POSTs to `/api/executions/start`
  ([components/editor/SharedWorkflowEditor.tsx:566-615](../../../components/editor/SharedWorkflowEditor.tsx#L566-L615)).
  "Run just the nodes the AI touched" maps cleanly onto a `selection` run.
- **The AI already tracks exactly which nodes it touched this turn:**
  `aiTurn.touchedNodeIds` ([lib/store/slices/ui-slice.ts:36-63](../../../lib/store/slices/ui-slice.ts#L36-L63)).
- **Cost estimation already exists and is pure:** `computeExecutionCost()` in
  [lib/billing/cost.ts:160-199](../../../lib/billing/cost.ts#L160-L199) — only `ai_generator`
  nodes incur cost.
- **Per-node results already flow back:** `node_results` → realtime
  ([lib/hooks/use-execution-channel.ts](../../../lib/hooks/use-execution-channel.ts)) →
  `execution-slice.nodeOutputs[nodeId]`
  ([lib/store/slices/execution-slice.ts](../../../lib/store/slices/execution-slice.ts)).
- **Chat messages already support rich types** (plan, clarification, usage) and there is an
  existing approve/feedback card pattern (TaskProgressCard) to model the Run card on.

Rejected alternatives:

- **Approach B (server emits run-proposal stream event):** couples the edge chat route to
  billing + `ai_models` lookups and duplicates cost logic that already runs client-side. More
  risk, no Stage-1 benefit.
- **Approach C (new AI "run" tool):** conflicts with the client-side trigger decision and
  needs prompt/brain work for no early payoff. Stage 3 "AI-initiated" is achieved in Approach
  A by enabling auto-run on AI turns, not by a new tool.

## Architecture & data flow

```
stream ends cleanly (after endAiTurn)
   │  read aiTurn.touchedNodeIds (accumulated across all tasks)
   ▼
buildRunPlan(touchedIds, workflow, modelsById)   ← new shared util (lib/billing/run-plan.ts)
   │  → { runTargetIds, terminalIds, cost }
   ▼
decide():
   touched set empty          → no card, nothing runs
   cost === 0                 → auto-run
   cost ≤ maxAutoRunCredits   → auto-run            (Stage 2+)
   else                       → attach runProposal to the assistant message
   ▼
auto-run path → triggerRunSelection(runTargetIds, { preconfirmed: true })
card path     → render RunProposalCard; Run click → same trigger
   ▼
SharedWorkflowEditor run effect (existing) → POST /api/executions/start
   │  (skips the credit modal when the run is preconfirmed)
   ▼
node_results → realtime → execution-slice.nodeOutputs[nodeId]
   ▼
InlineResults (on the message) reads nodeOutputs[terminalIds], renders live;
freezes URLs onto the message on completion
```

## Components

### New: `lib/billing/run-plan.ts`

Pure function `buildRunPlan(touchedIds, workflow, modelsById)` →
`{ runTargetIds: string[]; terminalIds: string[]; cost: number }`.

- `runTargetIds` mirrors the server's `selection`-mode target set logic in
  [app/api/executions/start/route.ts:128-199](../../../app/api/executions/start/route.ts#L128-L199)
  (seed = touched runnable nodes; include ephemeral ancestors; generative ancestors are
  pre-seeded from DB, not re-run).
- `cost` calls `computeExecutionCost()` so the chat estimate, the editor modal estimate, and
  the server debit all agree (within the existing `COST_DRIFT_TOLERANCE` of 5%,
  [lib/billing/cost.ts:93](../../../lib/billing/cost.ts#L93)).
- `terminalIds` = nodes in `runTargetIds` with **no outgoing edge to another node in
  `runTargetIds`** (the leaves of the executed subgraph). These are surfaced inline.

**Refactor:** the editor's current selection→cost logic (`calculateExecutionCost` referenced
at [SharedWorkflowEditor.tsx:566](../../../components/editor/SharedWorkflowEditor.tsx#L566)) is
extracted into this shared util so the editor and chat compute identical plans/estimates. The
editor is updated to call the shared util — no behavioral change to the editor.

### Changed: store

- **`Message`** ([lib/store/types.ts:5-77](../../../lib/store/types.ts#L5-L77)) gains:
  - `runProposal?: { runTargetIds: string[]; terminalIds: string[]; cost: number; status: 'ready' | 'running' | 'done' | 'failed' | 'superseded' }`
  - `inlineResultIds?: string[]` — the terminal node IDs whose outputs render inline.
- **`triggerRunSelection`** ([ui-slice.ts:160-169](../../../lib/store/slices/ui-slice.ts#L160-L169))
  gains an options arg `{ preconfirmed?: boolean }`, stored as a transient run flag
  (e.g. `runPreconfirmed`) that, like `runFromNodeId`/`runMode`, is **excluded from
  persistence** (see the persistence policy in
  [lib/store/app-store.ts](../../../lib/store/app-store.ts) and CLAUDE.md).

### Changed: `SharedWorkflowEditor` run effect

When the active run signal is `preconfirmed`, skip the credit-confirmation modal and commit
directly — the chat Run card already displayed and confirmed the cost. Non-chat runs are
unaffected.

### New: chat components

- **`RunProposalCard`** — renders cost + a Run button when `runProposal.status === 'ready'`;
  shows running/done/failed/superseded states. Modeled on the existing TaskProgressCard.
  Click → `triggerRunSelection(runProposal.runTargetIds, { preconfirmed: true })` and set
  status to `running`.
- **`InlineResults`** — given `inlineResultIds`, subscribes to
  `execution-slice.nodeOutputs[id]` for each and renders thumbnails live. On completion the
  resolved URLs are frozen onto the message (the same way `workflow` is snapshotted onto a
  message today, [use-chat-messages.ts:369-375](../../../lib/hooks/use-chat-messages.ts#L369-L375)),
  so they survive refresh without depending on live store state.

Both are rendered from the message renderer alongside the existing plan/clarification/usage
sections.

### Changed: settings

- `maxAutoRunCredits` stored in `profiles.preferences` (JSONB) — no migration needed; the
  column already exists and holds `theme`/`layoutEngine`. Default **10** when absent.
- A control in the settings page ([app/settings/page.tsx](../../../app/settings/page.tsx),
  Editor & Appearance section or a new "Spending limits" subsection) to read/write it via the
  existing `profiles` upsert path.
- The value is read into the store on load so the end-of-stream decision can use it
  synchronously.

## Edge cases & error handling

| Case | Behavior |
|---|---|
| Empty touched set (pure planning/text turn) | No card; nothing runs. |
| Stream failed mid-build (`catch` path) | Never evaluate a run. Decision only on clean completion. |
| Plan turn vs. plan execution | Two separate streams: the plan proposal turn touches no nodes (nothing runs); the post-approval turn builds nodes then runs once at its end-of-stream. |
| Insufficient balance | Can't auto-run; card shown. Run click hits existing 402 path ([start/route.ts:502-535](../../../app/api/executions/start/route.ts#L502-L535)) → card → `failed` with top-up CTA. Reuses optimistic-charge/settle. |
| Run already in progress | Card disabled; status reflects `running`. |
| Page refresh with a pending card | `runProposal` rehydrates as a **manual button only**. Auto-run lives solely in the live end-of-stream path, so there is zero risk of re-firing on load (consistent with the `runFromNodeId` non-persistence rule). |
| Graph edited after a card appears | If target nodes changed/removed, card → `superseded` (disabled). |

## Staging (drives the implementation plan)

- **Stage 1 — Plumbing + manual button.** Ship `buildRunPlan` (+ editor refactor to use it),
  `triggerRunSelection({ preconfirmed })`, modal bypass, `RunProposalCard`, `InlineResults`,
  and the end-of-stream decision. Behavior: **zero-cost runs auto-run**; **any paid run shows
  the Run card** (button always). Proves the mechanism end-to-end safely. `maxAutoRunCredits`
  is read but treated as 0 for paid runs at this stage.
- **Stage 2 — Cost-gated auto-run + settings.** Add the `maxAutoRunCredits` setting (default
  10) and its settings UI. Behavior: `cost ≤ limit` auto-runs; above it shows the card.
- **Stage 3 — AI sees results & iterates.** Feed terminal results back to the chat brain so it
  can verify/continue a multi-step goal — the genuinely "AI-initiated" agentic loop. Scoped
  last and flagged as the largest/most exploratory; may be split into its own spec when
  reached.

## Testing

No formal test runner in this repo (per CLAUDE.md). Verification:

- **Types:** `npx tsc --noEmit` (the reliable check here; `npm run lint`/`build` are unreliable
  in this environment).
- **Manual integration scenarios:**
  1. Free edit (e.g. blur only) → auto-runs, inline result appears.
  2. Paid edit → Run card with correct cost; clicking Run executes exactly once.
  3. Multi-task plan → runs once after all tasks finish, not per task.
  4. Cost above limit (Stage 2) → card, not auto-run; below limit → auto-run.
  5. Insufficient balance → card → failed with top-up CTA.
  6. Refresh with a pending card → manual button present, does not auto-fire.
  7. Editor (non-chat) runs still show the existing credit modal unchanged.

## Non-goals

- No new AI "run" tool or prompt/brain changes in Stages 1–2.
- No server-side run-proposal stream event.
- No change to the execution engine, orchestrator, webhook, or debit/refund RPCs.
- Showing every intermediate node's result inline (only terminal/leaf nodes are surfaced).
