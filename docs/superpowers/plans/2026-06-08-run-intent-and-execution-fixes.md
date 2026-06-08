# Run-intent re-architecture + UI fixes — Implementation Plan (Phases 1–3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the chat brain own run intent (an explicit `run_nodes` tool) instead of the frontend inferring runs from touched nodes; stop over-building compositor sinks; show the running border only on leaf nodes; and remove the AI-add layout flash.

**Architecture:** The Anthropic Claude tool loop (`lib/chat/`) gains a `run_nodes` tool that records execution intent and streams a `runRequest` event. The client stops auto-running off `aiTurn.touchedNodeIds` and instead seeds its existing run-plan/auto-run path from `runRequest`. Two isolated UI fixes follow: a leaf-only gate on the running border in `BaseNode`, and a reveal-on-settle mechanism (plus accurate registry sizes) so AI-added nodes appear once, correctly placed.

**Tech stack:** Next.js, React, Zustand, React Flow, Anthropic SDK (NDJSON streaming), TypeScript.

**Verification note:** This repo has **no test runner**. The reliable static check is `npx tsc --noEmit` (NOT `npm run lint`/`build`). Each task ends with a tsc check, a targeted manual E2E check, and a commit.

**Phase 0 (prod realtime fix) is already SHIPPED** on this branch (`780a9bec`) — split `node_predictions` onto its own channel + hydrate-on-subscribe-failure in `lib/hooks/use-execution-channel.ts`. Not repeated here.

**Spec:** `docs/superpowers/specs/2026-06-08-run-intent-and-execution-fixes-design.md`

---

## Phase 1 — Run-intent re-architecture

### Task 1.1: Add the `run_nodes` tool schema + ToolName

**Files:**
- Modify: `lib/chat/tools/definitions.ts` (TOOLS array; `ToolName` union L394)

- [ ] **Step 1: Add the tool schema** — insert a new entry into the `TOOLS` array (place it right after the `remove_node` entry, L257-272). It mirrors `remove_node`'s list shape but uses `nodeIds`:

```ts
  {
    name: 'run_nodes',
    description: 'Request that the given nodes be RUN (executed) now. Call this ONLY when the user explicitly asks to generate / run / make / produce a result this turn. Adding or editing nodes does NOT imply a run — never call run_nodes just because you added nodes. Pass the node ids whose output the user wants (usually the generator(s) or final node); the system automatically runs everything downstream. You MAY reference ids you created earlier this same turn with add_node. The user still controls whether it auto-runs or shows a Run button — your job is only to signal that a run was requested.',
    input_schema: {
      type: 'object',
      properties: {
        nodeIds: {
          type: 'array',
          minItems: 1,
          items: { type: 'string' },
          description: 'Node IDs to run (canvas UUIDs or temporary IDs you used in this turn). Bundle every node to run into this single array.',
        },
      },
      required: ['nodeIds'],
    },
  },
```

- [ ] **Step 2: Extend the `ToolName` union** (L394). Add `'run_nodes'`:

```ts
export type ToolName = 'add_node' | 'update_node' | 'update_compositor_layer' | 'remove_node' | 'ask_clarification' | 'propose_plan' | 'escalate' | 'run_nodes';
```

- [ ] **Step 3: tsc check**

Run: `npx tsc --noEmit`
Expected: FAILS in `lib/chat/tools/handlers.ts` — the `dispatchTool` switch's `_exhaustive: never` default no longer covers `run_nodes`. This is expected and fixed in Task 1.2.

- [ ] **Step 4: Commit**

```bash
git add lib/chat/tools/definitions.ts
git commit -m "feat(chat): add run_nodes tool schema + ToolName"
```

---

### Task 1.2: Make the dispatcher exhaustive (no-op for `run_nodes`)

**Files:**
- Modify: `lib/chat/tools/handlers.ts` (`dispatchTool` switch L452-477)

`run_nodes` is brain-handled (like `ask_clarification`/`propose_plan`/`escalate`) and must NEVER mutate the workflow. It never actually reaches `dispatchTool`, but the `never` default requires a case.

- [ ] **Step 1: Add the case** — insert after the `escalate` case (L462-465):

```ts
    case 'run_nodes':
      // Brain-handled in brain.ts (records run intent + streams runRequest).
      // It must never mutate the workflow, so this is a no-op like the other
      // terminal/brain tools above.
      return { success: true };
```

- [ ] **Step 2: tsc check**

Run: `npx tsc --noEmit`
Expected: PASS (the exhaustiveness error from Task 1.1 is resolved). New work in later tasks may add errors; those are handled in their tasks.

- [ ] **Step 3: Commit**

```bash
git add lib/chat/tools/handlers.ts
git commit -m "feat(chat): dispatchTool no-op case for run_nodes"
```

---

### Task 1.3: Add the `runRequest` stream event type

**Files:**
- Modify: `lib/chat/streaming/protocol.ts` (`StreamEvent` union L68-86)

- [ ] **Step 1: Add the event** — append a member to the `StreamEvent` union (after the `model` member, before `done`):

```ts
  | { type: 'runRequest'; nodeIds: string[] }
```

- [ ] **Step 2: tsc check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/chat/streaming/protocol.ts
git commit -m "feat(chat): add runRequest stream event type"
```

---

### Task 1.4: Record run intent in the brain + stream it

**Files:**
- Modify: `lib/chat/brain.ts` (`BrainResult` L12-25; locals L105-117; `tool_call` switch ~L411-433; return L541)

- [ ] **Step 1: Add `runRequest` to `BrainResult`** — after the `escalated` field (L24, before the closing brace):

```ts
  /** Explicit run intent from the run_nodes tool, or null if no run was requested. */
  runRequest: { nodeIds: string[] } | null;
```

- [ ] **Step 2: Add the accumulator local** — alongside the other `let` accumulators (near L114, after `let escalated = false;`):

```ts
  let runRequest: BrainResult['runRequest'] = null;
```

- [ ] **Step 3: Handle the `run_nodes` tool_call** — insert a new branch in the `tool_call` switch, AFTER the `escalate` branch (which ends at L427) and BEFORE the `if (name !== 'add_node' && ...)` unknown-tool guard (L429):

```ts
            if (name === 'run_nodes') {
              // run_nodes records execution INTENT only — it NEVER mutates the
              // workflow. The model may call it in the same turn it built nodes
              // (add_node then run_nodes), so resolve any temp ids the model
              // created this turn through the idMap. First valid call wins.
              // We satisfy the tool and DO NOT mark it terminal, so the
              // continuation turn stays valid if the model called build tools too.
              const rawIds = Array.isArray(event.args?.nodeIds) ? event.args.nodeIds : [];
              const resolved = rawIds
                .filter((x: unknown): x is string => typeof x === 'string' && x.trim().length > 0)
                .map((x: string) => state.idMap.get(x) ?? x);
              if (resolved.length > 0 && !runRequest) {
                runRequest = { nodeIds: resolved };
                input.encoder.send({ type: 'runRequest', nodeIds: resolved });
              }
              pendingTools.push({ id: event.id, success: true });
              break;
            }
```

- [ ] **Step 4: Return `runRequest`** — add it to the return object (L541):

```ts
  return { finalText, finalThinking, finalWorkflow, accumulatedPatch, hadAnyOutput, usage, clarification, plan, model: modelKey, escalated, runRequest };
```

- [ ] **Step 5: tsc check**

Run: `npx tsc --noEmit`
Expected: PASS. (`state` and `pendingTools` and `input.encoder` are already in scope in this switch — confirmed by the adjacent `escalate`/`propose_plan` branches.)

- [ ] **Step 6: Commit**

```bash
git add lib/chat/brain.ts
git commit -m "feat(chat): record run_nodes intent and stream runRequest"
```

Note: the route (`app/api/chat/stream/route.ts`) forwards every brain `encoder` event verbatim, so the `runRequest` event reaches the client with no route change. The resulting run decision (Task 1.7) writes a `runProposal`, which is already persisted via `persistRunProposal`, so no message-metadata persistence of `runRequest` is needed.

---

### Task 1.5: Decode `runRequest` on the client

**Files:**
- Modify: `lib/hooks/use-chat-messages.ts` (stream-var declarations ~L522; decoder chain L559-749)

- [ ] **Step 1: Declare a capture variable** — next to where `finalWorkflow` is declared for the stream (~L522), add:

```ts
            let runRequestIds: string[] | null = null;
```

- [ ] **Step 2: Decode the event** — add a branch to the `processStreamLine` `if/else if` chain, next to the `tool`/`patch` branch (after the block ending at L720):

```ts
                else if (parsed.type === 'runRequest') {
                    runRequestIds = Array.isArray(parsed.nodeIds)
                        ? parsed.nodeIds.filter((x: unknown): x is string => typeof x === 'string')
                        : null;
                }
```

- [ ] **Step 3: tsc check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/hooks/use-chat-messages.ts
git commit -m "feat(chat): decode runRequest stream event on the client"
```

---

### Task 1.6: Seed the run decision from `runRequest` (delete the touchedNodeIds inference)

**Files:**
- Modify: `lib/hooks/use-chat-messages.ts` (run-decision block L784-870)

This is the behavioral core: the run is now driven by the brain's explicit request, not by which nodes were touched. The rest of the block (cost gate, auto-run, run-proposal card, persistence) is unchanged — only the seed id set changes.

- [ ] **Step 1: Replace the seed** — change the `touched` source (L791) from the aiTurn inference to the runRequest capture:

Replace:
```ts
                const store = useAppStore.getState();
                const touched = store.aiTurn?.touchedNodeIds ?? [];
                const workflow = store.currentWorkflow;
                if (streamDone && touched.length > 0 && workflow) {
```

With:
```ts
                const store = useAppStore.getState();
                // Run intent now comes EXCLUSIVELY from the brain's run_nodes tool
                // (runRequestIds). If the brain didn't request a run, nothing runs —
                // adding/editing nodes no longer auto-runs them.
                const touched = runRequestIds ?? [];
                const workflow = store.currentWorkflow;
                if (streamDone && touched.length > 0 && workflow) {
```

Everything downstream (`buildRunPlan(workflow, touched, modelsById)` at L796, the `isPaidKnown`/`shouldAutoRun`/`runErr` gates, the `runProposal` writes, `triggerRunSelection`, `persistRunProposal`) stays exactly as-is. When `shouldAutoRun` is false (auto-run off or over the cap), the existing code already writes `runProposal: { status: 'ready', ... }`, which renders the existing "Run · N credits" button — satisfying the "button in the chat message" design with no new component.

- [ ] **Step 2: tsc check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Manual E2E (dev)** — `npm run dev`, then in the app:
  - Type "add a prompt node connected to an image node". Expected: nodes are added, **nothing runs**, no run-proposal card appears.
  - Type "generate an image of a red bicycle". Expected: the brain calls `run_nodes`; with auto-run on and under the cap, it runs; with auto-run off (or over cap), a "Run · N credits" card appears and runs on click.

- [ ] **Step 4: Commit**

```bash
git add lib/hooks/use-chat-messages.ts
git commit -m "feat(chat): drive runs from run_nodes intent, not touchedNodeIds"
```

---

### Task 1.7: Prompt — teach the brain about `run_nodes` + the minimal-graph rule

**Files:**
- Modify: `lib/chat/prompt/system.ts` (`CAPABILITIES` L26-28; `USE_CASE_ARCHETYPES` L123; `CRITICAL_RULES` L184-193)

All three consts are in the cached **stable** block — correct per CLAUDE.md (registry/rules stay stable; per-turn data stays dynamic).

- [ ] **Step 1: Update CAPABILITIES** (L26-28). Replace the "You cannot: run workflows yourself" clause so the model knows it can request a run:

Replace:
```ts
You cannot: run workflows yourself (the user clicks Run), see runtime outputs from past runs unless they are in the conversation history, access files outside of the user's attachments.`;
```

With:
```ts
You can request a run via the run_nodes tool — but ONLY when the user explicitly asks to generate/run/make a result this turn (otherwise the user clicks Run themselves).
You cannot: see runtime outputs from past runs unless they are in the conversation history, access files outside of the user's attachments.`;
```

- [ ] **Step 2: Qualify the compositor archetype** (L123). Replace:
```ts
- Compose the final cut with a compositor task that stitches the scene outputs into one clip.
```
With:
```ts
- ONLY when the user wants a single combined output (e.g. a multi-scene video stitched into one clip), compose the final cut with a compositor task. Do NOT add a compositor for a single image or a single scene the user just wants generated.
```

- [ ] **Step 3: Add two CRITICAL_RULES** (after item 9, L193, before the closing backtick):

```ts
10. RUN INTENT: Adding or editing nodes NEVER means "run them." Call run_nodes ONLY when the user explicitly asks to generate/run/make/produce a result this turn, passing the node ids whose output they want. If they only asked to add/build/connect/change nodes, do NOT call run_nodes.
11. MINIMAL GRAPH: Build exactly what the user asked for. Do NOT append output sinks (compositor, extra "final" nodes, "show on screen" nodes) they did not request. A request to "add a prompt connected to an image node" means exactly those two nodes and one edge — nothing more.
```

- [ ] **Step 4: tsc check**

Run: `npx tsc --noEmit`
Expected: PASS (string-only edits).

- [ ] **Step 5: Manual E2E (dev)** — repeat Task 1.6's two prompts and confirm: the simple "add" request produces exactly a prompt + image node (no compositor), and "generate an image of X" triggers a `run_nodes` call (visible as a run/auto-run in the chat).

- [ ] **Step 6: Commit**

```bash
git add lib/chat/prompt/system.ts
git commit -m "feat(chat): prompt rules for run_nodes intent + minimal graph"
```

---

## Phase 2 — Leaf-only running indicator

### Task 2.1: Gate the running border on leaf nodes

**Files:**
- Modify: `lib/nodes/core/canvas/BaseNode.tsx` (memo near L446; render L662)

A node shows the travelling-light running border only if it is a graph **leaf** (no outgoing edge). This matches the user's cases exactly: a prompt always feeds something (never a leaf, no border); an `ai_generator` feeding a compositor is not a leaf (no border); the compositor — or a standalone `ai_generator` — is a leaf (border shows). `edges` is already available via `useEdges()` (L229).

- [ ] **Step 1: Compute the leaf flag** — add a memo near the existing `connectedTargetHandles` memo (~L446):

```ts
    // Leaf = no outgoing edge to any other node. The running border only shows
    // on leaves: intermediate nodes (prompt, an ai_generator feeding a
    // compositor, blur/levels feeding downstream) stay border-free while running;
    // the run's terminal node carries the indicator.
    const isLeafNode = useMemo(() => !edges.some((e) => e.source === id), [edges, id]);
```

- [ ] **Step 2: Gate the border** (L662). Replace:
```ts
            {status === 'running' && <GeneratingBorder />}
```
With:
```ts
            {status === 'running' && isLeafNode && <GeneratingBorder />}
```

- [ ] **Step 3: tsc check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Manual E2E (dev)** — run a `prompt → ai_generator → compositor` chain: the border appears only on the compositor while running, not on the prompt or the ai_generator. Run a standalone `ai_generator` (no downstream): the border appears (it is a leaf).

- [ ] **Step 5: Commit**

```bash
git add lib/nodes/core/canvas/BaseNode.tsx
git commit -m "fix(nodes): show running border only on leaf nodes"
```

---

## Phase 3 — Layout flash

### Task 3.1: Accurate registry fallback sizes

**Files:**
- Modify: `lib/workflow/layout-utils.ts` (NODE_DIMENSIONS L7-18)

The server-side ELK pass has no DOM measurements and falls back to these. The old `prompt: 185×100` vs its real ~440px width packed nodes tight. Bump the most-wrong entries closer to real rendered sizes. These are approximations; the measured client re-layout (Task 3.2) is the source of truth — this just reduces first-pass tightness and improves the during-stream camera fit.

- [ ] **Step 1: Update the dimensions** — replace the `prompt` and `ai_generator` entries:

```ts
    prompt:       { width: 440, height: 200 },
    media_input:  { width: 240, height: 200 },
    compositor:   { width: 260, height: 300 },
    blur:         { width: 240, height: 260 },
    ai_generator: { width: 320, height: 420 },
```

- [ ] **Step 2: tsc check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/workflow/layout-utils.ts
git commit -m "fix(layout): bump registry fallback sizes toward real rendered sizes"
```

---

### Task 3.2: Reveal AI-added nodes only after the measured re-layout

**Files:**
- Modify: `lib/store/slices/ui-slice.ts` (aiTurn shape + actions L58-90)
- Modify: `lib/store/types.ts` (the slice interface for `aiTurn` + `revealAddedNodes`)
- Modify: `lib/nodes/core/canvas/BaseNode.tsx` (root style ~L625)
- Modify: `components/editor/AiAddedZoom.tsx` (end-of-turn effect L157-203)
- Verify: `lib/store/app-store.ts` (persist partialize — aiTurn must NOT be persisted)

Hide newly added nodes until the end-of-turn measured re-layout finishes, then reveal them in place — so the user never sees the tight first pass.

- [ ] **Step 1: Add `hiddenAddedIds` + `revealAddedNodes` to the store state.** In `lib/store/types.ts`, find the `aiTurn` field type and add `hiddenAddedIds: string[]` to its shape, and add the action signature `revealAddedNodes: () => void;` to the same slice interface. (The aiTurn shape currently is `{ active: boolean; touchedNodeIds: string[]; addedNodeIds: string[]; patchTick: number }` — add `hiddenAddedIds: string[]`.)

- [ ] **Step 2: Implement in `ui-slice.ts`.** Replace `beginAiTurn` (L59-60) and `recordAiPatch` (L61-85), and add `revealAddedNodes` after `endAiTurn`:

```ts
    beginAiTurn: () =>
        set({ aiTurn: { active: true, touchedNodeIds: [], addedNodeIds: [], hiddenAddedIds: [], patchTick: 0 } }),
    recordAiPatch: (patch) => {
        if (!patch) return;
        const current = get().aiTurn;
        if (!current || !current.active) return;

        const next = new Set(current.touchedNodeIds);
        // addedNodeIds tracks ONLY created nodes — the re-layout must reposition
        // these and leave updated/endpoint (existing) nodes anchored in place.
        const added = new Set(current.addedNodeIds);
        // hiddenAddedIds mirrors addedNodeIds: new nodes render invisible until
        // the end-of-turn measured re-layout reveals them in place.
        const hidden = new Set(current.hiddenAddedIds);
        for (const n of patch.addedNodes || []) { next.add(n.id); added.add(n.id); hidden.add(n.id); }
        for (const u of patch.updatedNodes || []) next.add(u.id);
        for (const e of patch.addedEdges || []) {
            if (e.source) next.add(e.source);
            if (e.target) next.add(e.target);
        }

        set({
            aiTurn: {
                active: true,
                touchedNodeIds: Array.from(next),
                addedNodeIds: Array.from(added),
                hiddenAddedIds: Array.from(hidden),
                patchTick: current.patchTick + 1,
            },
        });
    },
    endAiTurn: () => {
        const current = get().aiTurn;
        if (!current) return;
        set({ aiTurn: { ...current, active: false } });
    },
    revealAddedNodes: () => {
        const current = get().aiTurn;
        if (!current || current.hiddenAddedIds.length === 0) return;
        set({ aiTurn: { ...current, hiddenAddedIds: [] } });
    },
```

- [ ] **Step 3: Hide hidden nodes in `BaseNode`.** Add a narrow store subscription near the other store reads (after `const edges = useEdges();`, ~L229):

```ts
    // True while this node was just added by the AI and is awaiting the
    // end-of-turn measured re-layout. Selector returns a primitive boolean, so
    // unrelated nodes don't re-render when the hidden set changes.
    const isHiddenForReveal = useAppStore((s) => !!s.aiTurn?.hiddenAddedIds?.includes(id));
```

Then add opacity/pointer-events to the root element's inline `style` object (inside the `style={{ ... }}` at L625, alongside the existing entries):

```ts
                // Reveal-on-settle: AI-added nodes stay invisible until the
                // measured re-layout repositions them, then fade in at the
                // correct spot — no "tight then re-space" flash.
                opacity: isHiddenForReveal ? 0 : undefined,
                pointerEvents: isHiddenForReveal ? 'none' : undefined,
                transition: 'opacity 160ms ease-out',
```

- [ ] **Step 4: Reveal after the re-layout in `AiAddedZoom`.** Replace the end-of-turn effect body (L157-203). The key change: reveal ALWAYS happens at end of turn (even when the camera fit is suppressed), and only AFTER `relayoutAddedNodes` has repositioned the nodes:

```ts
    // End-of-turn settle. Triggered when active flips true → false.
    useEffect(() => {
        const isActive = !!aiTurn?.active;
        const wasActive = endTurnPrevActiveRef.current;
        endTurnPrevActiveRef.current = isActive;

        // Only run on the active → inactive transition.
        if (!(wasActive && !isActive)) return;
        if (!aiTurn) return;

        const touchedIds = aiTurn.touchedNodeIds;
        const addedIds = aiTurn.addedNodeIds;
        const reveal = () => useAppStore.getState().revealAddedNodes();
        let cancelled = false;

        // Cancel any pending during-stream fit — the settle is the canonical move.
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
        }

        // One rAF so React Flow has measured nodes added in the last patch. THEN
        // re-run the incremental ELK layout on just the new nodes with their real
        // measured sizes (the server pass only had registry fallbacks), reveal
        // them in their corrected positions, and finally settle the camera.
        const raf = requestAnimationFrame(() => {
            if (cancelled) { reveal(); return; }
            void relayoutAddedNodes(addedIds).then(() => {
                // A second frame so the position write propagates before we
                // reveal and read bounds for the fit.
                requestAnimationFrame(() => {
                    // Reveal unconditionally — even if the camera fit below is
                    // suppressed — so hidden nodes can never get stuck invisible.
                    reveal();
                    if (cancelled || userOverrodeViewportRef.current) return;
                    if (aiTurn.patchTick === 0) return;
                    if (touchedIds.length === 0) return;
                    const bbox = computeBbox(getNodes(), touchedIds);
                    if (!bbox) return;
                    runProgrammaticFit(bbox, END_OF_TURN_DURATION, END_OF_TURN_PADDING);
                });
            });
        });
        return () => {
            cancelled = true;
            cancelAnimationFrame(raf);
            // Safety net: if the effect tears down before reveal ran, reveal now.
            reveal();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [aiTurn?.active]);
```

- [ ] **Step 5: Verify aiTurn is NOT persisted.** Open `lib/store/app-store.ts` and confirm the persist `partialize` does not include `aiTurn` (it's transient — including it would rehydrate `hiddenAddedIds` after a refresh and hide nodes permanently). If `aiTurn` is persisted, add it to the exclusion list alongside `runFromNodeId`/`runMode`.

Run: `grep -n "aiTurn" lib/store/app-store.ts`
Expected: aiTurn does not appear in the persisted partialize (or is explicitly excluded).

- [ ] **Step 6: tsc check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Manual E2E (dev)** — ask the AI to add several connected nodes. Expected: nodes do NOT appear tight-then-spread; they appear once, already correctly spaced (a brief beat while hidden, then a fade-in at the final layout). Existing nodes never flicker or move. Refresh the page mid-thought and confirm no nodes are stuck invisible.

- [ ] **Step 8: Commit**

```bash
git add lib/store/slices/ui-slice.ts lib/store/types.ts lib/nodes/core/canvas/BaseNode.tsx components/editor/AiAddedZoom.tsx
git commit -m "fix(layout): reveal AI-added nodes only after measured re-layout"
```

---

## Self-Review

**Spec coverage:**
- #4 prod stuck-loading → Phase 0 (shipped, `780a9bec`). ✓
- #1/#5 run-intent + compositor over-build → Phase 1 (Tasks 1.1–1.7). ✓
- #3 leaf-only running indicator → Phase 2 (Task 2.1). ✓
- #2 layout flash → Phase 3 (Tasks 3.1–3.2). ✓

**Type consistency:** `run_nodes` (tool), `runRequest` (stream event + `BrainResult.runRequest`), `runRequestIds` (client capture), `hiddenAddedIds` / `revealAddedNodes` (store) are used consistently across tasks. `buildRunPlan` is called with the same `(workflow, touched, modelsById)` signature — only the seed source changes.

**Known assumptions to verify during execution:**
- Task 1.4 assumes `state`, `pendingTools`, `input.encoder` are in scope in the `tool_call` switch — confirmed against the adjacent `escalate`/`propose_plan` branches (brain.ts L411-448).
- Task 3.2 Step 5 explicitly verifies the persistence assumption rather than assuming it.
- Registry sizes in Task 3.1 are approximations; the measured re-layout corrects any residual, so exact values are non-critical (they only affect the during-stream camera fit and the rare relayout-failure fallback).

**Operator item (outside this plan):** confirm `node_predictions` realtime objects exist in the **prod** Supabase project to restore the per-iteration streaming animation (the Phase 0 code fix already prevents the hang without it).
