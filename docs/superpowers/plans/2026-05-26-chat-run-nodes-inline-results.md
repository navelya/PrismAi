# Chat-run nodes with inline results & cost-gated auto-run — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After the AI edits the workflow in a chat turn, the chat runs the nodes it touched — automatically when free or under the user's auto-run credit limit, otherwise behind a "Ready to run" card with a Run button — and shows the resulting images inline in the chat message.

**Architecture:** Approach A (client-orchestrated, reuse the existing run pipeline). At end-of-stream the chat reads `aiTurn.touchedNodeIds`, computes a run plan + cost with a new pure util that reuses `computeExecutionCost`, then either calls the existing `triggerRunSelection(...)` (auto-run) or attaches a `runProposal` to the assistant message (Run card). Results flow back through the existing `node_results` → realtime → `execution-slice.nodeOutputs` path; the touched turn's terminal-node outputs are rendered inline and frozen onto the message.

**Tech Stack:** Next.js 14 (App Router), React, Zustand, TypeScript, Supabase (Postgres + Realtime). No test runner in this repo — **verification is `npx tsc --noEmit` plus the manual scenarios in each task** (per CLAUDE.md; `npm run lint`/`build` are unreliable in this environment).

**Scope:** This plan delivers **Stage 1** (plumbing + manual Run card; free runs auto-run) and **Stage 2** (cost-gated auto-run + settings). **Stage 3** (feed terminal results back to the chat brain so it can iterate) is a separate brain-feedback subsystem and gets its own spec/plan — it is intentionally **not** in this plan.

**Key shared names (use these exact identifiers across tasks):**
- `buildRunPlan(workflow, touchedNodeIds, modelsById)` → `{ runTargetIds: string[]; terminalIds: string[]; cost: number; generativeCount: number }` in `lib/billing/run-plan.ts`.
- `Message.runProposal?: { runTargetIds: string[]; terminalIds: string[]; cost: number; status: RunProposalStatus }` where `type RunProposalStatus = 'ready' | 'running' | 'done' | 'failed' | 'superseded'`.
- `Message.inlineResultIds?: string[]`.
- Store: `runPreconfirmed: boolean`; `triggerRunSelection(nodeIds: string[], opts?: { preconfirmed?: boolean })`.
- Store: `maxAutoRunCredits: number` (default `10`); `setMaxAutoRunCredits(n: number)`.
- DB message metadata keys: `metadata.run_proposal`, `metadata.inline_result_ids`, and the existing `metadata.execution_result` (frozen images).
- Chat handler: `onRunProposal?: (messageId: string) => void`.

---

## File structure

**Create:**
- `lib/billing/run-plan.ts` — pure `buildRunPlan`; reuses `computeExecutionCost` for cost parity.
- `components/chat/RunProposalCard.tsx` — the "Ready to run / Running / Done / Failed" card with the Run button.
- `components/chat/InlineRunResults.tsx` — renders the touched turn's terminal-node outputs (live from the store while running; frozen from `message.result` after).

**Modify:**
- `lib/store/types.ts` — `Message` fields; `UISlice` (`runPreconfirmed`, `triggerRunSelection` signature, `maxAutoRunCredits`, `setMaxAutoRunCredits`).
- `lib/store/slices/ui-slice.ts` — `runPreconfirmed` default + setters; `maxAutoRunCredits` default + setter.
- `lib/store/app-store.ts` — exclude `runPreconfirmed` from persistence; reset on rehydrate.
- `components/editor/SharedWorkflowEditor.tsx` — skip credit modal when `runPreconfirmed`.
- `lib/hooks/use-chat-messages.ts` — end-of-stream run decision; freeze inline results.
- `lib/hooks/use-session.ts` — hydrate `run_proposal` / `inline_result_ids` from DB metadata.
- `components/chat/Message.tsx` — render `RunProposalCard` + `InlineRunResults`; thread `onRunProposal`.
- `components/chat/MessageList.tsx` — thread `onRunProposal`.
- `components/chat/ChatInterface.tsx` — define `handleRunProposal`; pass to `MessageList`.
- `app/settings/page.tsx` — "Max auto-run credits" control (Stage 2).

---

## Stage 1 — Plumbing + manual Run card

### Task 1: Add the run-plan types to the store

**Files:**
- Modify: `lib/store/types.ts` (Message interface ~line 6-77; UISlice interface ~line 289-371)

- [ ] **Step 1: Add the `RunProposalStatus` type and Message fields**

In `lib/store/types.ts`, just above `export interface Message {`, add:

```typescript
export type RunProposalStatus = 'ready' | 'running' | 'done' | 'failed' | 'superseded';
```

Inside `interface Message`, after the `planApproveError?` field (~line 76), add:

```typescript
    // Chat-run feature: when an AI turn touched runnable nodes whose run was
    // NOT auto-executed (paid run above the auto-run limit), this holds the
    // proposed run. Rendered as the RunProposalCard. Persisted to DB
    // metadata.run_proposal so the card (as a manual button) survives refresh.
    runProposal?: {
        runTargetIds: string[];
        terminalIds: string[];
        cost: number;
        status: RunProposalStatus;
    };
    // Terminal node ids whose outputs render inline under this message while a
    // chat-triggered run is in flight. Frozen into `result` on completion.
    // Persisted to DB metadata.inline_result_ids.
    inlineResultIds?: string[];
```

- [ ] **Step 2: Extend the UISlice interface**

In `lib/store/types.ts`, inside `interface UISlice`, replace the run-signal block (currently lines ~322-328):

```typescript
    runFromNodeId: string | null;
    runMode: 'solo' | 'chain' | 'ab_test' | 'selection' | null;
    /** Targets for 'selection' mode — the set of nodes from the multi-select toolbar's Run button. */
    runSelectionIds: string[] | null;
    triggerRunFromNode: (nodeId: string, runMode?: 'solo' | 'chain' | 'ab_test') => void;
    triggerRunSelection: (nodeIds: string[]) => void;
    clearRunFromNode: () => void;
```

with:

```typescript
    runFromNodeId: string | null;
    runMode: 'solo' | 'chain' | 'ab_test' | 'selection' | null;
    /** Targets for 'selection' mode — the set of nodes from the multi-select toolbar's Run button. */
    runSelectionIds: string[] | null;
    /**
     * True when the current run signal was already cost-confirmed by the caller
     * (the chat Run card / chat auto-run) and the SharedWorkflowEditor effect
     * should skip the credit modal. Ephemeral — never persisted (same policy as
     * runFromNodeId/runMode).
     */
    runPreconfirmed: boolean;
    triggerRunFromNode: (nodeId: string, runMode?: 'solo' | 'chain' | 'ab_test') => void;
    triggerRunSelection: (nodeIds: string[], opts?: { preconfirmed?: boolean }) => void;
    clearRunFromNode: () => void;
    /** Max credits a chat run may cost before it stops auto-running and shows a Run card. Default 10. */
    maxAutoRunCredits: number;
    setMaxAutoRunCredits: (n: number) => void;
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: errors only in `ui-slice.ts` (missing `runPreconfirmed`, `maxAutoRunCredits`, `setMaxAutoRunCredits`, and the new `triggerRunSelection` arg) — those are fixed in Task 2. No errors in `types.ts`.

- [ ] **Step 4: Commit**

```bash
git add lib/store/types.ts
git commit -m "feat(chat-run): add runProposal/inlineResultIds + run-signal types"
```

---

### Task 2: Implement the store fields & setters

**Files:**
- Modify: `lib/store/slices/ui-slice.ts` (initial state ~line 27-35; setters ~line 160-169)
- Modify: `lib/store/app-store.ts` (partialize ~line 142-144; onRehydrate ~line 188-190)

- [ ] **Step 1: Add initial state**

In `lib/store/slices/ui-slice.ts`, in the initial state object, after `runSelectionIds: null,` (line 29) add:

```typescript
    runPreconfirmed: false,
    maxAutoRunCredits: 10,
```

- [ ] **Step 2: Update the run setters**

In `lib/store/slices/ui-slice.ts`, replace the `triggerRunFromNode` / `triggerRunSelection` / `clearRunFromNode` block (lines 160-169) with:

```typescript
    triggerRunFromNode: (nodeId, mode = 'chain') => set({ runFromNodeId: nodeId, runMode: mode, runSelectionIds: null, runPreconfirmed: false }),
    triggerRunSelection: (nodeIds, opts) => set({
        // runFromNodeId stays non-null so the existing SharedWorkflowEditor effect
        // (which gates on `if (!runFromNodeId || !runMode) return`) still fires.
        // The first id is a stable sentinel; the actual targets live in runSelectionIds.
        runFromNodeId: nodeIds[0] ?? null,
        runMode: 'selection',
        runSelectionIds: nodeIds,
        runPreconfirmed: opts?.preconfirmed ?? false,
    }),
    clearRunFromNode: () => set({ runFromNodeId: null, runMode: null, runSelectionIds: null, runPreconfirmed: false }),
    setMaxAutoRunCredits: (n) => set({ maxAutoRunCredits: Number.isFinite(n) && n >= 0 ? n : 0 }),
```

- [ ] **Step 3: Exclude `runPreconfirmed` from persistence**

In `lib/store/app-store.ts`, in the `partialize` exclude list, after `'runSelectionIds',` (line 144) add:

```typescript
                    'runPreconfirmed',
```

In the `onRehydrateStorage` reset block, after `state.runSelectionIds = null;` (line 190) add:

```typescript
                    state.runPreconfirmed = false;
```

(Note: `maxAutoRunCredits` is intentionally **persisted** — it is a user preference, not a trigger signal.)

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 5: Commit**

```bash
git add lib/store/slices/ui-slice.ts lib/store/app-store.ts
git commit -m "feat(chat-run): runPreconfirmed flag + maxAutoRunCredits store field"
```

---

### Task 3: Create `buildRunPlan`

**Files:**
- Create: `lib/billing/run-plan.ts`

- [ ] **Step 1: Write the util**

Create `lib/billing/run-plan.ts`:

```typescript
/**
 * Run-plan computation for chat-triggered runs.
 *
 * Pure — no I/O. Given the current workflow and the set of node ids the AI
 * touched this turn, decide what would run, what the terminal (leaf) outputs
 * are, and what it costs.
 *
 * Cost is computed via computeExecutionCost (the same pure function the editor
 * and server use) so the chat estimate, the editor modal, and the server debit
 * cannot drift apart.
 */
import type { AiModel } from '@/lib/nodes/types';
import { computeExecutionCost, type CostNode } from './cost';

export interface RunPlanWorkflow {
    nodes: { id: string; type?: string | null; data?: any }[];
    edges: { source: string; target: string; targetHandle?: string | null }[];
}

export interface RunPlan {
    /** Node ids passed to the server as the selection run target set. */
    runTargetIds: string[];
    /** Leaves of the touched subgraph — their outputs are shown inline. */
    terminalIds: string[];
    /** Estimated credit cost of the run (only ai_generator nodes cost). */
    cost: number;
    /** Number of ai_generator nodes that will run. */
    generativeCount: number;
}

const EMPTY_PLAN: RunPlan = { runTargetIds: [], terminalIds: [], cost: 0, generativeCount: 0 };

/**
 * @param workflow      current full workflow (nodes + edges)
 * @param touchedNodeIds aiTurn.touchedNodeIds — union of nodes the AI added/updated this turn
 * @param modelsById     model lookup (from buildModelsMap)
 */
export function buildRunPlan(
    workflow: RunPlanWorkflow | null | undefined,
    touchedNodeIds: string[] | null | undefined,
    modelsById: Map<number, AiModel>
): RunPlan {
    if (!workflow || !touchedNodeIds || touchedNodeIds.length === 0) return EMPTY_PLAN;

    const nodeById = new Map(workflow.nodes.map((n) => [n.id, n]));
    // Only touched nodes that still exist in the graph are runnable targets.
    const runTargetIds = touchedNodeIds.filter((id) => nodeById.has(id));
    if (runTargetIds.length === 0) return EMPTY_PLAN;

    const targetSet = new Set(runTargetIds);

    // Terminal = a target node with no outgoing edge to ANOTHER target node.
    const hasDownstreamTarget = new Set<string>();
    for (const e of workflow.edges) {
        if (targetSet.has(e.source) && targetSet.has(e.target)) {
            hasDownstreamTarget.add(e.source);
        }
    }
    const terminalIds = runTargetIds.filter((id) => !hasDownstreamTarget.has(id));

    // Cost: mirror the editor's 'selection' path — charge ai_generator nodes in
    // the target set, with full-graph context for connected-media pricing.
    const costNodes: CostNode[] = runTargetIds.map((id) => {
        const n = nodeById.get(id)!;
        return { id, type: (n.type as string) ?? '', config: n.data?.config };
    });
    const graph = {
        allNodes: workflow.nodes.map((n) => ({
            id: n.id,
            type: (n.type as string) ?? '',
            config: n.data?.config,
        })),
        edges: workflow.edges.map((e) => ({
            source: e.source,
            target: e.target,
            targetHandle: e.targetHandle ?? null,
        })),
    };

    const { cost, generativeCount } = computeExecutionCost(costNodes, modelsById, graph);
    return { runTargetIds, terminalIds, cost, generativeCount };
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Sanity-check the logic by hand**

Re-read the function against these cases and confirm each holds:
- touched = `[]` or workflow null → `EMPTY_PLAN` (no card, nothing runs).
- touched = `[blur]` (ephemeral only, parent is an already-run ai_generator not in touched) → `cost === 0`, `terminalIds === ['blur']`.
- touched = `[gen, blur]` with edge gen→blur → `cost` counts `gen`, `terminalIds === ['blur']`.
- touched = `[genA, genB]` no edge between them → both terminal.

- [ ] **Step 4: Commit**

```bash
git add lib/billing/run-plan.ts
git commit -m "feat(chat-run): buildRunPlan util (run targets, terminals, cost)"
```

---

### Task 4: Skip the credit modal for preconfirmed runs

**Files:**
- Modify: `components/editor/SharedWorkflowEditor.tsx` (run-signal effect, lines 566-615)

- [ ] **Step 1: Read `runPreconfirmed` in the effect and branch on it**

In `components/editor/SharedWorkflowEditor.tsx`, add a selector near the other run selectors (after line 547 `const runSelectionIds = useAppStore((state) => state.runSelectionIds);`):

```typescript
    const runPreconfirmed = useAppStore((state) => state.runPreconfirmed);
```

In the run-signal `useEffect` (lines 566-615), snapshot the flag right after snapshotting `selectionIds` (after line 579):

```typescript
        const preconfirmed = runPreconfirmed;
```

In the `selection` branch, replace the cost gate (lines 590-597):

```typescript
            if (cost > 0) {
                setPendingExecutionTarget({ id: null, mode: 'selection', selectionIds: present });
                setPendingCost(cost);
                setPendingNodeCount(count);
                setShowCreditModal(true);
            } else {
                commitExecution(null, 'selection', present);
            }
            return;
```

with:

```typescript
            if (cost > 0 && !preconfirmed) {
                setPendingExecutionTarget({ id: null, mode: 'selection', selectionIds: present });
                setPendingCost(cost);
                setPendingNodeCount(count);
                setShowCreditModal(true);
            } else {
                // preconfirmed: the chat Run card already showed & confirmed the cost.
                commitExecution(null, 'selection', present);
            }
            return;
```

Finally, add `runPreconfirmed` to the effect dependency array (line 615): `}, [runFromNodeId, runMode, runSelectionIds, runPreconfirmed, nodes, calculateExecutionCost]);`

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Manual verification**

Run `npm run dev`. In the editor, multi-select two generative nodes and click the toolbar Run — the credit modal **still appears** (that path passes no `preconfirmed`, so `runPreconfirmed` is `false`). This confirms existing behavior is unchanged.

- [ ] **Step 4: Commit**

```bash
git add components/editor/SharedWorkflowEditor.tsx
git commit -m "feat(chat-run): skip credit modal for preconfirmed selection runs"
```

---

### Task 5: End-of-stream run decision in the chat hook

**Files:**
- Modify: `lib/hooks/use-chat-messages.ts` (after the stream reader loop, around line 583-587)

- [ ] **Step 1: Add a helper that decides & acts, then call it after a clean stream finish**

In `lib/hooks/use-chat-messages.ts`, locate the clean-completion point — immediately after the `while (true) { ... }` reader loop ends and BEFORE `useAppStore.getState().endAiTurn();` (line 587). Insert this block there (it must run only on the clean path — it is inside the `try`, never the `catch`):

```typescript
            // ── Chat-run decision (Approach A) ──────────────────────────────
            // Bound to end-of-stream on the CLEAN path only. Never per-tool,
            // never per-task, never in catch. This is what guarantees a
            // multi-task plan runs ONCE, after all tasks finish.
            try {
                const store = useAppStore.getState();
                const touched = store.aiTurn?.touchedNodeIds ?? [];
                const workflow = store.currentWorkflow;
                if (streamDone && touched.length > 0 && workflow) {
                    const { buildRunPlan } = await import('@/lib/billing/run-plan');
                    const { buildModelsMap } = await import('@/lib/billing/cost');
                    const modelsById = buildModelsMap(store.models as any[]);
                    const plan = buildRunPlan(workflow as any, touched, modelsById);

                    if (plan.runTargetIds.length > 0) {
                        // STAGE 1: auto-run only when free. Paid runs always show a card.
                        // (STAGE 2 widens this to `plan.cost <= store.maxAutoRunCredits`.)
                        const shouldAutoRun = plan.cost === 0;

                        if (shouldAutoRun) {
                            useAppStore.getState().updateMessage(assistantMsgId, {
                                inlineResultIds: plan.terminalIds,
                                runProposal: {
                                    runTargetIds: plan.runTargetIds,
                                    terminalIds: plan.terminalIds,
                                    cost: plan.cost,
                                    status: 'running',
                                },
                            });
                            store.triggerRunSelection(plan.runTargetIds, { preconfirmed: true });
                        } else {
                            useAppStore.getState().updateMessage(assistantMsgId, {
                                inlineResultIds: plan.terminalIds,
                                runProposal: {
                                    runTargetIds: plan.runTargetIds,
                                    terminalIds: plan.terminalIds,
                                    cost: plan.cost,
                                    status: 'ready',
                                },
                            });
                        }
                        // Persist the proposal so it survives refresh as a manual card.
                        void persistRunProposal(assistantMsgId);
                    }
                }
            } catch (e) {
                console.error('[chat-run] decision failed', e);
            }
            // ────────────────────────────────────────────────────────────────
```

- [ ] **Step 2: Add the `persistRunProposal` helper**

In the same file, add a module-level helper (near the top-level helpers, e.g. just below the imports or above the hook body — match the file's existing helper placement). It reads the message from the store and PATCHes its DB metadata:

```typescript
async function persistRunProposal(messageId: string) {
    try {
        const msg = useAppStore.getState().chatMessages.find((m) => m.id === messageId);
        if (!msg) return;
        await fetch(`/api/messages/${messageId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                metadata: {
                    run_proposal: msg.runProposal ?? null,
                    inline_result_ids: msg.inlineResultIds ?? null,
                },
            }),
        });
    } catch (e) {
        console.error('[chat-run] persistRunProposal failed', e);
    }
}
```

> ⚠️ The PATCH route (`app/api/messages/[id]/route.ts`) **replaces** `metadata` wholesale. Before shipping, confirm whether the assistant message row already has metadata (thinking/usage/plan) that must be preserved. If it does, fetch-merge in the route or include the existing fields here. See Task 5b.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS. (`streamDone` and `assistantMsgId` are already in scope at this point — verify by reading lines 540-587.)

- [ ] **Step 4: Commit**

```bash
git add lib/hooks/use-chat-messages.ts
git commit -m "feat(chat-run): end-of-stream run decision (free=auto-run, paid=card)"
```

---

### Task 5b: Make the message PATCH merge metadata (don't clobber)

**Files:**
- Modify: `app/api/messages/[id]/route.ts` (lines 22-24, 43-48)

- [ ] **Step 1: Merge metadata instead of replacing**

In `app/api/messages/[id]/route.ts`, the handler currently sets `updatePayload.metadata = body.metadata` directly (line 24), which overwrites the row's existing metadata. Replace the metadata handling so a partial metadata patch merges with what's stored. Replace lines 20-28:

```typescript
        // Allowed fields to update
        const updatePayload: any = {};
        if (body.images !== undefined) updatePayload.images = body.images;
        if (body.content !== undefined) updatePayload.content = body.content;
        if (body.metadata !== undefined) updatePayload.metadata = body.metadata;

        if (Object.keys(updatePayload).length === 0) {
            return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
        }
```

with:

```typescript
        // Allowed fields to update
        const updatePayload: any = {};
        if (body.images !== undefined) updatePayload.images = body.images;
        if (body.content !== undefined) updatePayload.content = body.content;

        if (body.metadata === undefined && Object.keys(updatePayload).length === 0) {
            return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
        }
```

Then, after the ownership-verification select (which already fetches the row at lines 33-41), change that select to also return `metadata`, and shallow-merge before update. Replace the select (lines 33-41) and update (lines 43-48):

```typescript
        const { data: message, error: messageError } = await supabase
            .from('messages')
            .select('session_id, metadata, sessions!inner(user_id)')
            .eq('id', messageId)
            .single();

        if (messageError || !message || (message.sessions as any).user_id !== user.id) {
            return NextResponse.json({ error: 'Message not found or unauthorized' }, { status: 404 });
        }

        // Shallow-merge metadata so a partial patch (e.g. run_proposal) does not
        // clobber existing keys (thinking/usage/plan/clarification).
        if (body.metadata !== undefined) {
            updatePayload.metadata = { ...((message as any).metadata ?? {}), ...body.metadata };
        }

        const { data: updatedMessage, error: updateError } = await supabase
            .from('messages')
            .update(updatePayload)
            .eq('id', messageId)
            .select()
            .single();
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/messages/[id]/route.ts
git commit -m "fix(messages): shallow-merge metadata on PATCH to preserve existing keys"
```

---

### Task 6: Hydrate the proposal from DB metadata

**Files:**
- Modify: `lib/hooks/use-session.ts` (metadata type ~line 168-188; assistant mapping ~line 202-219)

- [ ] **Step 1: Extend the metadata type**

In `lib/hooks/use-session.ts`, in the `metadata` type literal (lines 168-188), add after `node_refs?` (line 187):

```typescript
                        run_proposal?: {
                            runTargetIds: string[];
                            terminalIds: string[];
                            cost: number;
                            status: 'ready' | 'running' | 'done' | 'failed' | 'superseded';
                        } | null;
                        inline_result_ids?: string[] | null;
```

- [ ] **Step 2: Map it onto the assistant message**

In `lib/hooks/use-session.ts`, after the `metadata.plan` mapping block (ends line 219), add:

```typescript
                    if (msg.role === 'assistant' && metadata.run_proposal) {
                        const rp = metadata.run_proposal;
                        // A run that was still 'running' when the page unloaded can't be
                        // live anymore — re-offer it as a manual 'ready' card. Auto-run
                        // lives only in the live end-of-stream path, so this never
                        // re-fires a run on load.
                        const status = rp.status === 'running' ? 'ready' : rp.status;
                        formatted.runProposal = {
                            runTargetIds: Array.isArray(rp.runTargetIds) ? rp.runTargetIds : [],
                            terminalIds: Array.isArray(rp.terminalIds) ? rp.terminalIds : [],
                            cost: typeof rp.cost === 'number' ? rp.cost : 0,
                            status,
                        };
                    }
                    if (msg.role === 'assistant' && Array.isArray(metadata.inline_result_ids)) {
                        formatted.inlineResultIds = metadata.inline_result_ids;
                    }
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/hooks/use-session.ts
git commit -m "feat(chat-run): hydrate run_proposal/inline_result_ids from DB metadata"
```

---

### Task 7: Build the `RunProposalCard` component

**Files:**
- Create: `components/chat/RunProposalCard.tsx`

- [ ] **Step 1: Write the component**

Create `components/chat/RunProposalCard.tsx`. Model the styling on the existing plan/clarification cards (look at `components/chat/PlanCard.tsx` for class conventions before writing — match its container/button styles). Use `formatCredits` for the cost label.

```tsx
'use client';

import { formatCredits } from '@/lib/billing/cost';
import type { RunProposalStatus } from '@/lib/store/types';

interface RunProposalCardProps {
    cost: number;
    status: RunProposalStatus;
    onRun: () => void;
}

export function RunProposalCard({ cost, status, onRun }: RunProposalCardProps) {
    if (status === 'superseded') {
        return (
            <div className="mt-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                This run is out of date — the workflow changed since it was proposed.
            </div>
        );
    }

    if (status === 'done') {
        return (
            <div className="mt-2 rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                Ran · {formatCredits(cost)} credits
            </div>
        );
    }

    if (status === 'failed') {
        return (
            <div className="mt-2 flex items-center justify-between rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs">
                <span className="text-destructive">Run failed.</span>
                <button
                    type="button"
                    onClick={onRun}
                    className="rounded-md border border-border/60 px-2 py-1 font-medium hover:bg-muted"
                >
                    Retry · {formatCredits(cost)}
                </button>
            </div>
        );
    }

    const running = status === 'running';
    return (
        <div className="mt-2 flex items-center justify-between rounded-lg border border-border/60 bg-card/50 px-3 py-2">
            <span className="text-xs text-muted-foreground">
                {running ? 'Running…' : 'Ready to run'}
            </span>
            <button
                type="button"
                disabled={running}
                onClick={onRun}
                className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
                {running ? 'Running…' : `Run · ${formatCredits(cost)} credits`}
            </button>
        </div>
    );
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/chat/RunProposalCard.tsx
git commit -m "feat(chat-run): RunProposalCard component"
```

---

### Task 8: Build the `InlineRunResults` component

**Files:**
- Create: `components/chat/InlineRunResults.tsx`

- [ ] **Step 1: Write the component**

Create `components/chat/InlineRunResults.tsx`. It subscribes to `nodeOutputs` for the terminal ids and renders them via the existing `MessageRenderer` (the same renderer used for `message.result` at `Message.tsx:328`). It converts the store envelope to the legacy renderable shape with `toLegacyRenderableOutput` (already imported in ui-slice.ts:3, from `@/lib/workflow/result-format`).

```tsx
'use client';

import { useMemo } from 'react';
import { useAppStore } from '@/lib/store/app-store';
import { toLegacyRenderableOutput } from '@/lib/workflow/result-format';
import { MessageRenderer } from './MessageRenderer';

interface InlineRunResultsProps {
    terminalIds: string[];
    isCanvasMode?: boolean;
}

export function InlineRunResults({ terminalIds, isCanvasMode }: InlineRunResultsProps) {
    const nodeOutputs = useAppStore((s) => s.nodeOutputs);

    const items = useMemo(() => {
        const out: any[] = [];
        for (const id of terminalIds) {
            const legacy = toLegacyRenderableOutput(nodeOutputs?.[id]);
            if (Array.isArray(legacy)) {
                for (const item of legacy) {
                    if (item?.url) out.push(item);
                }
            }
        }
        return out;
    }, [terminalIds, nodeOutputs]);

    if (items.length === 0) return null;
    return (
        <div className="mt-2">
            <MessageRenderer data={items} isCanvasMode={isCanvasMode} />
        </div>
    );
}
```

> Before writing, open `components/chat/MessageRenderer.tsx` and confirm its props (`data`, `isCanvasMode`) and the array item shape it expects (`{ url, resolution?, metadata? }`). Adjust the item push above to match exactly what `message.result` items look like (see the legacy fallback at `use-session.ts:156-160`).

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/chat/InlineRunResults.tsx
git commit -m "feat(chat-run): InlineRunResults — live terminal-node outputs in chat"
```

---

### Task 9: Render the card & results in `Message.tsx`; freeze on completion

**Files:**
- Modify: `components/chat/Message.tsx` (local Message interface ~line 24-51; props ~line 189-209; render body ~line 326-395)

- [ ] **Step 1: Add the new fields to the local Message interface and props**

In `components/chat/Message.tsx`, in the local message-shape interface (lines 24-51), after `planApproveError?` (line 50) add:

```typescript
    runProposal?: {
        runTargetIds: string[];
        terminalIds: string[];
        cost: number;
        status: import('@/lib/store/types').RunProposalStatus;
    };
    inlineResultIds?: string[];
```

In the component props interface (after `onPlanFeedback?` ~line 209) add:

```typescript
    onRunProposal?: (messageId: string) => void;
```

Add `onRunProposal` to the destructured props (near line 191) and to the imports at the top:

```tsx
import { RunProposalCard } from './RunProposalCard';
import { InlineRunResults } from './InlineRunResults';
```

- [ ] **Step 2: Render the card and inline results**

In the assistant render body, after the TaskProgressCard block (ends ~line 395), add:

```tsx
                    {message.type === 'assistant' && message.runProposal && (
                        <RunProposalCard
                            cost={message.runProposal.cost}
                            status={message.runProposal.status}
                            onRun={() => onRunProposal?.(message.id)}
                        />
                    )}

                    {message.type === 'assistant'
                        && message.inlineResultIds
                        && message.inlineResultIds.length > 0
                        && !message.result
                        && message.runProposal?.status === 'running' && (
                        <InlineRunResults
                            terminalIds={message.inlineResultIds}
                            isCanvasMode={isCanvasMode}
                        />
                    )}
```

> The `!message.result` guard means: while running, show **live** outputs from the store; once frozen into `message.result` (Step 4), the existing `MessageRenderer` block at line 326-328 takes over and `InlineRunResults` stops rendering. No double render.

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: errors in `MessageList.tsx` / `ChatInterface.tsx` for the not-yet-threaded `onRunProposal` — fixed in Task 10. No errors in `Message.tsx`.

- [ ] **Step 4: Add the freeze-on-completion watcher**

The card status and `message.result` must update when the run finishes. Add a small hook that watches `nodeStatuses` for the active proposal's terminal ids. Create it inline in `lib/hooks/use-chat-messages.ts` as an effect within the `useChatMessages` hook body (it already has access to `messages` and the store). Add this `useEffect` (import `useEffect` if not already imported):

```typescript
    // Freeze a chat-run's inline results onto the message when its terminal
    // nodes all settle, and flip the RunProposalCard status accordingly.
    const nodeStatusesForRun = useAppStore((s) => s.nodeStatuses);
    useEffect(() => {
        const msgs = useAppStore.getState().chatMessages;
        for (const m of msgs) {
            const rp = m.runProposal;
            if (!rp || rp.status !== 'running') continue;
            const ids = rp.terminalIds.length ? rp.terminalIds : rp.runTargetIds;
            const statuses = ids.map((id) => nodeStatusesForRun[id]);
            if (statuses.some((s) => s === 'pending' || s === 'running' || s === undefined)) continue;

            const anyError = statuses.some((s) => s === 'error');
            if (anyError) {
                useAppStore.getState().updateMessage(m.id, {
                    runProposal: { ...rp, status: 'failed' },
                });
                void persistRunProposal(m.id);
                continue;
            }

            // All terminals succeeded — freeze their outputs into `result`.
            const store = useAppStore.getState();
            const result: any[] = [];
            for (const id of ids) {
                const legacy = toLegacyRenderableOutput(store.nodeOutputs?.[id]);
                if (Array.isArray(legacy)) for (const item of legacy) if (item?.url) result.push(item);
            }
            useAppStore.getState().updateMessage(m.id, {
                result: result.length ? result : m.result,
                runProposal: { ...rp, status: 'done' },
            });
            // Persist frozen images + done status so a reload renders them
            // without depending on live store state.
            void persistFrozenResult(m.id, result);
        }
    }, [nodeStatusesForRun]);
```

Add the `toLegacyRenderableOutput` import at the top of `use-chat-messages.ts`:

```typescript
import { toLegacyRenderableOutput } from '@/lib/workflow/result-format';
```

And add the `persistFrozenResult` module-level helper next to `persistRunProposal`:

```typescript
async function persistFrozenResult(messageId: string, result: any[]) {
    try {
        const msg = useAppStore.getState().chatMessages.find((m) => m.id === messageId);
        await fetch(`/api/messages/${messageId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                metadata: {
                    execution_result: result,
                    run_proposal: msg?.runProposal ?? null,
                },
            }),
        });
    } catch (e) {
        console.error('[chat-run] persistFrozenResult failed', e);
    }
}
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: same `onRunProposal` threading errors as Step 3 (fixed in Task 10); nothing new.

- [ ] **Step 6: Commit**

```bash
git add components/chat/Message.tsx lib/hooks/use-chat-messages.ts
git commit -m "feat(chat-run): render Run card + inline results; freeze on completion"
```

---

### Task 10: Thread `onRunProposal` through the chat tree

**Files:**
- Modify: `components/chat/MessageList.tsx` (props ~line 44-72; pass-through ~line 117-125)
- Modify: `components/chat/ChatInterface.tsx` (handlers; `<MessageList>` ~line 420-441)

- [ ] **Step 1: MessageList prop + pass-through**

In `components/chat/MessageList.tsx`, add to the props interface (after `onPlanFeedback?` ~line 50):

```typescript
    onRunProposal?: (messageId: string) => void;
```

Add `onRunProposal` to the destructured props (near line 72) and pass it to `<Message>` (near line 125):

```tsx
                                onRunProposal={onRunProposal}
```

- [ ] **Step 2: Define the handler in ChatInterface and pass it**

In `components/chat/ChatInterface.tsx`, define a handler (near `handlePlanApprove`/`handlePlanFeedback`):

```tsx
    const handleRunProposal = (messageId: string) => {
        const store = useAppStore.getState();
        const msg = store.chatMessages.find((m) => m.id === messageId);
        const rp = msg?.runProposal;
        if (!rp || (rp.status !== 'ready' && rp.status !== 'failed')) return;
        // Validate targets still exist; otherwise mark superseded.
        const wf = store.currentWorkflow;
        const present = rp.runTargetIds.filter((id) => wf?.nodes.some((n: any) => n.id === id));
        if (present.length === 0) {
            store.updateMessage(messageId, { runProposal: { ...rp, status: 'superseded' } });
            return;
        }
        store.updateMessage(messageId, { runProposal: { ...rp, status: 'running' } });
        store.triggerRunSelection(present, { preconfirmed: true });
    };
```

> `useAppStore` is already imported in ChatInterface (it uses the store throughout). Confirm the import exists; add `import { useAppStore } from '@/lib/store/app-store';` if not.

Pass it to `<MessageList>` (in the props block around line 440):

```tsx
                onRunProposal={handleRunProposal}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (all `onRunProposal` threading resolved).

- [ ] **Step 4: Commit**

```bash
git add components/chat/MessageList.tsx components/chat/ChatInterface.tsx
git commit -m "feat(chat-run): thread onRunProposal through MessageList to ChatInterface"
```

---

### Task 11: Stage 1 end-to-end manual verification

**Files:** none (verification only)

- [ ] **Step 1: Free run auto-executes with inline result**

Run `npm run dev`. In a chat session, ask for an edit that touches only free nodes (e.g. "add a blur to this image" on an existing generated image). Confirm:
- No Run card appears; the run starts automatically.
- The blurred result appears inline under the assistant message.
- After completion, refresh the page — the result is still shown (frozen into `metadata.execution_result`).

- [ ] **Step 2: Paid run shows a Run card**

Ask for an edit that adds/updates an `ai_generator` node (cost > 0). Confirm:
- The assistant message ends with a "Ready to run · N credits" card; nothing runs yet.
- Clicking **Run** starts the run (no credit modal), the card shows "Running…", and the image appears inline when done; card → "Ran · N credits".

- [ ] **Step 3: Multi-task plan runs once**

Trigger a plan with multiple tasks (the plan/approve flow). Approve it. Confirm the nodes build task-by-task but the run fires **once** after all tasks complete (watch the network tab: a single POST to `/api/executions/start`), not per task.

- [ ] **Step 4: Refresh leaves a manual button (no auto-fire)**

With a paid Run card showing (status `ready`), refresh. Confirm the card reappears as a Run button and **does not** auto-run on load.

- [ ] **Step 5: Editor runs unchanged**

In the editor, run a paid selection from the toolbar — the credit modal still appears (preconfirmed path not used).

- [ ] **Step 6: Commit a checkpoint tag (optional)**

```bash
git commit --allow-empty -m "chore(chat-run): Stage 1 verified end-to-end"
```

---

## Stage 2 — Cost-gated auto-run + settings

### Task 12: Load `maxAutoRunCredits` from the user's profile

**Files:**
- Modify: `lib/hooks/use-session.ts` (or wherever the profile/preferences are loaded on session init — confirm by grepping for `preferences` in `lib/hooks/use-session.ts` and `app/settings/page.tsx`)

- [ ] **Step 1: Hydrate the store value from `profiles.preferences`**

Find where the app loads the user profile/preferences on startup (the settings page reads `profiles.preferences`; there is likely a load on the chat page too). Where preferences are read into the app, add:

```typescript
const pref = (profile?.preferences as any)?.maxAutoRunCredits;
useAppStore.getState().setMaxAutoRunCredits(
    typeof pref === 'number' && pref >= 0 ? pref : 10
);
```

> If no central preferences load exists on the chat page, add a one-shot fetch in `ChatInterface` mount: `GET /api/user/me` (returns profile), read `preferences.maxAutoRunCredits`, call `setMaxAutoRunCredits`. Keep it a single call guarded so it runs once.

- [ ] **Step 2: Type-check + manual verify**

Run: `npx tsc --noEmit` → PASS. With dev server running, set a value in the DB (`profiles.preferences.maxAutoRunCredits = 25`) and confirm via React devtools / a temporary log that the store value is `25` after load (default `10` when absent).

- [ ] **Step 3: Commit**

```bash
git add lib/hooks/use-session.ts
git commit -m "feat(chat-run): load maxAutoRunCredits from profile preferences"
```

---

### Task 13: Apply the auto-run threshold

**Files:**
- Modify: `lib/hooks/use-chat-messages.ts` (the `shouldAutoRun` line added in Task 5)

- [ ] **Step 1: Widen the auto-run condition**

In the end-of-stream decision block (Task 5), replace:

```typescript
                        // STAGE 1: auto-run only when free. Paid runs always show a card.
                        // (STAGE 2 widens this to `plan.cost <= store.maxAutoRunCredits`.)
                        const shouldAutoRun = plan.cost === 0;
```

with:

```typescript
                        // STAGE 2: auto-run when free OR at/under the user's limit.
                        const shouldAutoRun = plan.cost <= store.maxAutoRunCredits;
```

- [ ] **Step 2: Type-check + manual verify**

Run: `npx tsc --noEmit` → PASS. With limit = 10: a run costing ≤ 10 auto-executes; a run costing > 10 shows the card. Set limit = 0 to reproduce Stage 1 behavior (paid always carded).

- [ ] **Step 3: Commit**

```bash
git add lib/hooks/use-chat-messages.ts
git commit -m "feat(chat-run): cost-gated auto-run against maxAutoRunCredits"
```

---

### Task 14: Settings UI control

**Files:**
- Modify: `app/settings/page.tsx` (Editor & Appearance section, ~line 476-635 where `preferences` is read/written)

- [ ] **Step 1: Add a number input bound to `preferences.maxAutoRunCredits`**

In the Editor & Appearance section of `app/settings/page.tsx`, where other preferences (theme, layoutEngine) are edited and saved via `supabase.from('profiles').upsert({ id, preferences, avatar_url })`, add a labeled control. Match the section's existing field markup; the field reads/writes `preferences.maxAutoRunCredits` (default 10):

```tsx
{/* Max auto-run credits */}
<div className="space-y-1">
    <label className="text-sm font-medium">Max auto-run credits</label>
    <p className="text-xs text-muted-foreground">
        Chat runs costing up to this many credits run automatically. Above it, a Run button appears.
    </p>
    <input
        type="number"
        min={0}
        step={1}
        value={preferences.maxAutoRunCredits ?? 10}
        onChange={(e) =>
            setPreferences((p: any) => ({
                ...p,
                maxAutoRunCredits: Math.max(0, Math.trunc(Number(e.target.value) || 0)),
            }))
        }
        className="w-32 rounded-md border border-border bg-background px-2 py-1 text-sm"
    />
</div>
```

> Match the exact `preferences` state variable name and setter used in this file (it may be `prefs`/`setPrefs` or inline upsert). Read lines 476-635 first and mirror the existing pattern. Ensure the existing Save handler includes `maxAutoRunCredits` in the upserted `preferences` object.

- [ ] **Step 2: Also push the change into the live store on save**

After a successful save in this page, call `useAppStore.getState().setMaxAutoRunCredits(preferences.maxAutoRunCredits ?? 10)` so the chat picks it up without a reload (import `useAppStore` if needed).

- [ ] **Step 3: Type-check + manual verify**

Run: `npx tsc --noEmit` → PASS. In the settings page, set the value to 3, save, reload settings → value persists. Then in chat, a 5-credit run shows the card; a 2-credit run auto-runs.

- [ ] **Step 4: Commit**

```bash
git add app/settings/page.tsx
git commit -m "feat(chat-run): settings control for max auto-run credits"
```

---

## Deferred — Stage 3 (separate spec/plan)

**Not implemented here.** Stage 3 ("AI sees terminal results and iterates toward a multi-step goal") is a brain-feedback subsystem: it requires feeding completed terminal-node outputs back into the chat brain's context and letting it decide to continue. That changes the chat route / brain prompt and is large enough to warrant its own brainstorm → spec → plan. When reached, start a new spec at `docs/superpowers/specs/`. The Stage 1–2 client orchestration built here (touched-set detection, `buildRunPlan`, preconfirmed runs, inline results) is the foundation it will build on.

---

## Known follow-ups (deferred, non-blocking)

Surfaced by the final holistic review on 2026-05-26. None block Stage 1/2; tracked here for a later pass.

1. **Deleted in-flight terminal node can strand a "running" card.** The freeze watcher in [lib/hooks/use-chat-messages.ts](../../../lib/hooks/use-chat-messages.ts) skips ids whose `nodeStatuses` value is `undefined`. If a terminal node is deleted *while its chat-run is in flight*, its status entry is removed → the watcher skips forever → the card stays "Running…". Fix idea: intersect the watched ids with nodes currently present in `currentWorkflow`, and treat "all terminals missing" as settled (fail). Low likelihood (requires deleting an in-flight terminal).
2. **Freeze watcher has no per-execution scoping across concurrent running proposals.** It iterates all messages with `status==='running'` against the single global `nodeStatuses`. Safe under the current one-run-per-stream / sequential-user-runs assumption; worth a comment, or execution-id scoping if concurrent chat runs ever become possible.
3. **Minor polish:** `RunProposalCard` running button could add `disabled:cursor-not-allowed`; settings number input could add `aria-label` + `max={10000}`; `RunPlan.generativeCount` is currently unused. All cosmetic.

## Self-Review

**1. Spec coverage**

| Spec requirement | Task(s) |
|---|---|
| End-of-stream-only decision (run once after all tasks) | Task 5 (placement + comment); verified Task 11 Step 3 |
| `buildRunPlan` reuses `computeExecutionCost`; terminal-node calc | Task 3 |
| Cost parity with editor/server | Task 3 (shared `computeExecutionCost`) |
| `triggerRunSelection({ preconfirmed })` + modal bypass | Tasks 2, 4 |
| `runProposal`/`inlineResultIds` on Message + persistence + hydrate | Tasks 1, 5, 5b, 6 |
| RunProposalCard | Task 7 |
| InlineRunResults (live) + freeze on completion | Tasks 8, 9 |
| Zero-cost auto-run; paid carded (Stage 1) | Task 5 |
| Cost-gated auto-run + settings (Stage 2) | Tasks 12, 13, 14 |
| Edge: empty touched set → nothing | Task 3 (EMPTY_PLAN) + Task 5 guard |
| Edge: stream failed → never run | Task 5 (inside `try`, `streamDone` guard) |
| Edge: insufficient balance → card failed | Task 9 freeze watcher (anyError → failed) + start route 402 |
| Edge: refresh = manual button, no auto-fire | Task 6 (running→ready normalize) + auto-run only in live path |
| Edge: graph edited after card → superseded | Task 10 Step 2 (present-check) |
| Editor runs unchanged | Task 4 Step 3, Task 11 Step 5 |

Note on a spec deviation: the spec mentioned "extract the editor's selection→cost logic into the shared util." This plan instead has `buildRunPlan` call the already-shared pure `computeExecutionCost` directly, which guarantees identical numbers **without** refactoring the editor's subtle run effect (lower risk). Parity is preserved by construction. The editor refactor is intentionally not done.

**2. Placeholder scan:** No "TBD/TODO/implement later". The two ⚠️ notes (Task 5b metadata-merge, Task 8 renderer prop confirmation) point to concrete reads the implementer must do before writing, and Task 5b fully implements the merge — they are not deferred work.

**3. Type consistency:** `RunProposalStatus`, `runProposal` shape, `triggerRunSelection(nodeIds, opts?)`, `runPreconfirmed`, `maxAutoRunCredits`/`setMaxAutoRunCredits`, `onRunProposal`, `buildRunPlan` return shape, `persistRunProposal`/`persistFrozenResult`, and DB keys `run_proposal`/`inline_result_ids`/`execution_result` are used identically across all tasks.
