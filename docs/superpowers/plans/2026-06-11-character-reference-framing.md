# Character-Reference Framing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a `character` node is wired into an `ai_generator` node, automatically prepend hidden framing text to the prompt so the model treats each character sheet as one consistent person (not a group photo) — even with multiple characters connected.

**Architecture:** The count of distinct character nodes feeding an AI node is known where the graph + edges are available (orchestrator `buildInputsFromParents` and the start-route preseed/dispatch loop). We stash that count in the node's `inputs` bag under a reserved key `__characterRefCount` — the same loose bag that already carries non-schema keys like `inputs[edge.id]`. The `ai_generator` executor — the single point where the final prompt string is assembled — reads that count and, if ≥ 1, prepends the matching framing template to the prompt before dispatch. A new `lib/workflow/character-framing.ts` holds the framing templates and a shared count helper (DRY across the two dispatch paths).

**Tech Stack:** TypeScript, Next.js (server), the existing v2 execution engine (orchestrator + dispatch-v2 + start route). No new dependencies.

**Testing note:** This repo has **no test runner** (see CLAUDE.md and the `verification-commands` memory — `npm run lint`/`next build` are unreliable here; use `npx tsc --noEmit`). So each task verifies with `npx tsc --noEmit`, and the feature is validated end-to-end manually in Task 5. There are no unit-test steps because there is no harness to run them.

---

## File Structure

- **Create** `lib/workflow/character-framing.ts` — `CHARACTER_FRAMING_SINGLE`, `CHARACTER_FRAMING_MULTI` constants; `buildCharacterFraming(count)`; `countCharacterParents(edges, targetNodeId, nodeTypeById)`. One small, focused module owning both the wording and the counting rule.
- **Modify** `lib/nodes/plugins/ai_generator/executor.server.ts` — detect the prompt field key, read `input.__characterRefCount`, prepend framing before provider resolution.
- **Modify** `lib/workflow/orchestrator.ts` — set `inputs.__characterRefCount` in `buildInputsFromParents` (reuses the already-computed `characterParentIds`).
- **Modify** `app/api/executions/start/route.ts` — set `__characterRefCount` on each root node's inputs before dispatch (covers partial "run from this node" runs where the character is outside the execution set).

---

### Task 1: Create the character-framing module

**Files:**
- Create: `lib/workflow/character-framing.ts`

- [ ] **Step 1: Write the module**

Create `lib/workflow/character-framing.ts` with exactly this content:

```typescript
/**
 * Hidden prompt framing for character references.
 *
 * A `character` node outputs a photographic *character sheet* — one image that
 * usually shows the person across several angles, poses, and expressions. By the
 * time that sheet reaches a model it is just an opaque image URL, so the model
 * reads a sheet full of faces as a scene containing several different people and
 * applies the prompt to all of them. We prepend a short framing instruction so it
 * treats each sheet as ONE consistent character. The user never sees this text.
 *
 * No names and no descriptions are injected: the model has the image and can see
 * the character better than any sentence, and the user describes who they mean
 * ("the redhead") rather than naming them.
 */

export const CHARACTER_FRAMING_SINGLE =
  'The reference image is a character sheet showing ONE single person across ' +
  'multiple angles, poses, and expressions. Treat it as a single consistent ' +
  'character and apply the request to that one person.';

export const CHARACTER_FRAMING_MULTI =
  'The reference images are separate character sheets. Each sheet depicts ONE ' +
  'distinct person (shown across multiple angles/poses). These are different ' +
  'individuals — keep them distinct and apply the request to the people ' +
  'described below.';

/**
 * The framing text for a given number of connected character nodes.
 * Returns '' for 0 (nothing to frame), the single-character text for 1, and the
 * multi-character text for 2+.
 */
export function buildCharacterFraming(count: number): string {
  if (!count || count < 1) return '';
  return count === 1 ? CHARACTER_FRAMING_SINGLE : CHARACTER_FRAMING_MULTI;
}

/**
 * Count the distinct `character` nodes wired into `targetNodeId`.
 * `nodeTypeById` maps node id -> node type (e.g. 'character', 'ai_generator').
 * Used by both dispatch paths so the rule lives in exactly one place.
 */
export function countCharacterParents(
  edges: Array<{ source: string; target: string }>,
  targetNodeId: string,
  nodeTypeById: Map<string, string | undefined>
): number {
  const sources = new Set<string>();
  for (const e of edges) {
    if (e.target !== targetNodeId) continue;
    if (nodeTypeById.get(e.source) === 'character') sources.add(e.source);
  }
  return sources.size;
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: PASS (no errors). The module has no imports, so it cannot break anything else.

- [ ] **Step 3: Commit**

```bash
git add lib/workflow/character-framing.ts
git commit -m "feat(characters): add character-reference framing module"
```

---

### Task 2: Inject framing in the ai_generator executor

**Files:**
- Modify: `lib/nodes/plugins/ai_generator/executor.server.ts`

The executor builds the final model inputs in `replicateInputs`. Right before it resolves the provider (the line `const primary = await resolvePrimaryProvider(model_id);`, ~line 169), `replicateInputs[promptKey]` holds the final user prompt. We inject there.

- [ ] **Step 1: Add the import**

At the top of the file, alongside the other imports (after the `resolve-provider` import on line 7), add:

```typescript
import { buildCharacterFraming } from '@/lib/workflow/character-framing';
```

- [ ] **Step 2: Insert the injection block before provider resolution**

Find this existing block (~line 164-170):

```typescript
        // ── Resolve the model's primary provider binding (Phase B) ───────────
        // One ai_models row can be bound to several providers; the primary
        // (priority 0, active) decides who runs it and with which slug. Failover
        // over the rest is Phase C.
        const primary = await resolvePrimaryProvider(model_id);
```

Insert this block IMMEDIATELY BEFORE that comment/`const primary` line:

```typescript
        // ── Character-reference framing (hidden) ─────────────────────────────
        // When character node(s) are wired in, the orchestrator/start-route
        // stash the count under the reserved `__characterRefCount` key in the
        // inputs bag (never a model field). Prepend framing so the model reads
        // each character sheet as ONE consistent person, not a group photo.
        // Constraints-first: framing goes BEFORE the user's request.
        const characterRefCount =
            input && typeof input === 'object' && typeof input.__characterRefCount === 'number'
                ? input.__characterRefCount
                : 0;
        if (characterRefCount >= 1) {
            // Prefer the conventional `prompt` field; fall back to the first
            // text-like control if a model renamed it.
            const promptKey =
                controlByKey.has('prompt') || handleByKey.has('prompt')
                    ? 'prompt'
                    : (controls.find((c: any) =>
                          ['text', 'textarea', 'string', 'prompt'].includes(
                              (c.type || '').toLowerCase()
                          )
                      )?.api_mapping_key as string | undefined);
            if (promptKey) {
                const framing = buildCharacterFraming(characterRefCount);
                const existing = replicateInputs[promptKey];
                const userPrompt = typeof existing === 'string' ? existing.trim() : '';
                replicateInputs[promptKey] = userPrompt
                    ? `${framing}\n\n${userPrompt}`
                    : framing;
            }
        }

```

(`controlByKey`, `handleByKey`, and `controls` are already defined earlier in this function — lines 37-40.)

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: PASS. If it errors on `input.__characterRefCount`, confirm the access is guarded by the `typeof input === 'object'` check exactly as written above.

- [ ] **Step 4: Commit**

```bash
git add lib/nodes/plugins/ai_generator/executor.server.ts
git commit -m "feat(characters): prepend hidden character framing to ai_generator prompt"
```

---

### Task 3: Set the count in the orchestrator dispatch path

**Files:**
- Modify: `lib/workflow/orchestrator.ts`

`buildInputsFromParents` already computes `characterParentIds` (a `Set` of distinct character source ids) for its trim-to-base logic. We expose its size on the returned inputs bag. This covers every run where the character node is inside the execution set (the common full-run case).

- [ ] **Step 1: Stash the count before returning**

Find the end of `buildInputsFromParents` (~line 467-469):

```typescript
    if (targetNode?.type === 'collect' && edge.id && resultData.length > 0) {
      inputs[edge.id] = resultData;
    }
  }

  return inputs;
}
```

Change the tail to:

```typescript
    if (targetNode?.type === 'collect' && edge.id && resultData.length > 0) {
      inputs[edge.id] = resultData;
    }
  }

  // Hidden signal for the ai_generator executor: how many distinct character
  // nodes feed this node. The executor prepends framing so each character sheet
  // is read as one consistent person. Reserved key, never sent to the model.
  if (characterParentIds.size > 0) {
    inputs.__characterRefCount = characterParentIds.size;
  }

  return inputs;
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: PASS. `inputs` is typed `Record<string, any>`, so assigning `__characterRefCount` is allowed.

- [ ] **Step 3: Commit**

```bash
git add lib/workflow/orchestrator.ts
git commit -m "feat(characters): expose character parent count from buildInputsFromParents"
```

---

### Task 4: Set the count in the start-route dispatch path

**Files:**
- Modify: `app/api/executions/start/route.ts`

Root nodes are dispatched directly from the start route (line ~646-650), bypassing `buildInputsFromParents`. This is the partial "run from this node" case where a character may sit outside the execution set. The route has the FULL graph (`allNodes`, `allEdges`), so we count character parents there using the shared helper.

- [ ] **Step 1: Add the import**

At the top of the file with the other imports, add:

```typescript
import { countCharacterParents } from '@/lib/workflow/character-framing';
```

- [ ] **Step 2: Build a node-type map once, before the dispatch loop**

Find the dispatch loop (~line 646-650):

```typescript
    for (const node of rootNodes) {
      const inputs = preseedInputs.get(node.id) || {};
      console.log(`[Execution/Start] Dispatching root node ${node.id} (type: ${node.type}) with inputs: [${Object.keys(inputs).join(', ')}]`);
      await dispatchNode(execution.id, node.id, node, inputs, origin, session_id);
    }
```

Replace it with:

```typescript
    // Map id -> type across the FULL graph (not just the target set) so we can
    // detect character parents that live outside the execution set on a partial
    // "run from this node".
    const nodeTypeById = new Map<string, string | undefined>(
      allNodes.map((n: NodeConfig) => [n.id, n.type])
    );

    for (const node of rootNodes) {
      const inputs = preseedInputs.get(node.id) || {};
      // Hidden signal for the ai_generator executor (see character-framing.ts):
      // count distinct character nodes wired into this root node.
      const characterRefCount = countCharacterParents(allEdges, node.id, nodeTypeById);
      if (characterRefCount > 0) {
        inputs.__characterRefCount = characterRefCount;
      }
      console.log(`[Execution/Start] Dispatching root node ${node.id} (type: ${node.type}) with inputs: [${Object.keys(inputs).join(', ')}]`);
      await dispatchNode(execution.id, node.id, node, inputs, origin, session_id);
    }
```

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: PASS. `allNodes`, `allEdges`, and `NodeConfig` are already in scope in this file (lines 101-102 and the existing imports).

- [ ] **Step 4: Commit**

```bash
git add app/api/executions/start/route.ts
git commit -m "feat(characters): count character parents for root-node dispatch (partial runs)"
```

---

### Task 5: Full type-check and manual end-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full type-check**

Run: `npx tsc --noEmit`
Expected: PASS with no errors across the whole project.

- [ ] **Step 2: Start the dev server**

Run: `npm run dev`
Expected: server up on port 3000.

- [ ] **Step 3: Manual E2E — single character**

In the app: drop a `character` node, wire it into an `ai_generator` (an image/edit model with a `prompt` field), type a request like "make them wave", run.
Expected: the result edits the **single** person from the sheet; no extra/duplicated people, no "group photo" artifacts. (Compare against the pre-change behavior you described, where the edit hit every face on the sheet.)

- [ ] **Step 4: Manual E2E — multiple characters**

Wire **two** different `character` nodes into one `ai_generator`, type "put the redhead in a suit", run.
Expected: only the matching character changes; the two identities stay distinct (not blended into one person).

- [ ] **Step 5: Manual E2E — no character (regression)**

Wire a plain `media_input` image (no character) into an `ai_generator`, type any prompt, run.
Expected: behavior unchanged — no framing text added. (Optionally confirm in the server log line `[WorkflowExecutor] Starting AI model:` that the `prompt` in `replicateInputs` has NOT been prefixed with framing.)

- [ ] **Step 6: Final confirmation**

If all three behaviors are correct, the feature is complete. If any step fails, debug with the `systematic-debugging` skill before claiming completion (per `verification-before-completion`).

---

## Self-Review

**Spec coverage:**
- Fully hidden → framing lives only in `replicateInputs`, never surfaced in UI. ✓ (Task 2)
- No name / no description → templates contain neither. ✓ (Task 1)
- Single vs multi variants → `buildCharacterFraming` returns the right one. ✓ (Task 1)
- Always-on when a character is wired → count set in both dispatch paths, no toggle. ✓ (Tasks 3, 4)
- Framing before the user request → `${framing}\n\n${userPrompt}`. ✓ (Task 2)
- Templates as a code constant → `character-framing.ts`. ✓ (Task 1)
- Model with no prompt field → `promptKey` is `undefined`, injection skipped. ✓ (Task 2)
- Empty user prompt → framing alone becomes the prompt. ✓ (Task 2)
- Scope = `ai_generator` only → injection lives solely in its executor. ✓ (Task 2)
- Existing multi-character trim-to-base unchanged → Task 3 only adds a line, doesn't touch the trim. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. ✓

**Type consistency:** `buildCharacterFraming(count: number)` and `countCharacterParents(edges, targetNodeId, nodeTypeById)` are defined in Task 1 and called with matching signatures in Tasks 2 and 4. The reserved key `__characterRefCount` is written in Tasks 3/4 and read in Task 2 — identical spelling. ✓
