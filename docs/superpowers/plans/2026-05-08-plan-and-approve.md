# Plan-and-Approve Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship sub-project B-2 from `docs/superpowers/specs/2026-05-07-chat-brain-rework-design.md` per the design at `docs/superpowers/specs/2026-05-08-plan-and-approve-design.md` (commit 29eece38). The chat brain gains a `propose_plan` tool that emits a structured plan card with prose + apply-ready blueprint; the user approves (server applies the blueprint without a model call) or sends feedback (model emits a revised plan).

**Architecture:** New Anthropic tool `propose_plan` (input: title/summary/arrows/models/detail + a structured blueprint matching `add_node`'s nodes/edges schema). Brain validates the blueprint via a dry-run `validateBlueprint` helper, then emits a new `plan` NDJSON event. Approve hits the same `/api/chat/stream` endpoint with a `planAnswer` sidecar; the route detects approve, runs an idempotency check, dispatches `add_node` against the stored blueprint, and emits `tool` + `usage`(zero) + `done` without invoking the model. Feedback is a normal streaming turn with the feedback text as the user message and a sidecar marking the relationship. UI is a new `PlanCard` rendered inside `Message`, mirroring B-1's ChipCard pattern.

**Tech Stack:** Next.js (App Router), TypeScript, Anthropic SDK (`@anthropic-ai/sdk`), Supabase (Postgres + service-role client), Zustand store, Tailwind CSS, lucide-react icons. **No test runner** per `CLAUDE.md` — verification is `npm run lint` + `npm run build` for type-check gates and manual smoke testing against a live `npm run dev` server. Optional ad-hoc Node scripts in `scripts/` for pure-function units (per repo convention).

---

## Testing strategy (read this before starting)

This repo has **no test runner**. The plan does not write Jest/Vitest unit tests — they would be discarded. Instead, every task ends with one or more of:

1. **Type-check gate:** `npm run lint` (Next.js's lint includes TypeScript checks). After changes, this MUST pass before commit.
2. **Build gate:** `npm run build` after changes that affect imports or types — verifies the bundle still compiles.
3. **Manual smoke:** when the change has runtime behavior, verify by running `npm run dev` and exercising the relevant flow per the spec's manual test checklist.
4. **Ad-hoc script (optional):** for `validateBlueprint` (Task 3), a small Node script in `scripts/` exercises the validator with a known-bad blueprint to confirm error paths fire. Optional but recommended.

When a step says "Verify the change," it means at minimum `npm run lint` AND the manual or scripted check listed in that step. Don't skip the manual check for UI work — types compiling does not mean buttons work.

## File Structure

**New files (3):**
```
components/chat/PlanCard.tsx                       Plan card UI: prose, detail toggle,
                                                   feedback toggle, locked states.
                                                   Self-contained component.
scripts/test-validate-blueprint.js                 Optional ad-hoc validator smoke test.
docs/superpowers/plans/2026-05-08-plan-and-approve.md   This plan (already exists).
```

**Modified files (10), in dependency order:**
```
lib/chat/streaming/protocol.ts                     Add 'plan' StreamEvent variant + PlanPayload type.
                                                   Pure type — no logic.
lib/chat/tools/definitions.ts                      Extract shared nodesEdgesSchema. Add propose_plan
                                                   tool. Widen ToolName.
lib/chat/tools/handlers.ts                         Add validateBlueprint() helper (dry-run).
                                                   No changes to existing dispatchTool / runAddNode.
lib/chat/brain.ts                                  Recognize propose_plan in tool_call switch.
                                                   Validate via dry-run. Emit plan event.
                                                   Extend BrainResult with plan field.
lib/chat/prompt/system.ts                          Add PLAN PROPOSAL subsection in TOOL_RULES.
                                                   Extend CAPABILITIES line. Add CRITICAL_RULES rule 7.
lib/chat/prompt/examples.ts                        Add fourth few-shot (plan + revision).
lib/store/types.ts                                 Extend Message interface with plan + planAnswer.
lib/hooks/use-chat-messages.ts                     Add 'plan' branch in processStreamLine.
                                                   Resolve planAnswer (sidecar) in handleSend.
                                                   Pass planAnswer in request body.
                                                   Optimistic transition for approve clicks.
components/chat/Message.tsx                        Conditionally render <PlanCard>. Suppress
                                                   'Approved' user bubble when
                                                   plan_answer.action === 'approve'.
app/api/chat/stream/route.ts                       Parse planAnswer sidecar. Approve-branch
                                                   handler (idempotency check, blueprint apply via
                                                   dispatchTool, persist, emit). Filter synthetic
                                                   'Approved' from chatWindow on feedback/normal
                                                   turns. Persist metadata.plan on assistant
                                                   insert. Persist metadata.plan_answer on user
                                                   insert.
```

Build order is bottom-up: types and pure functions first (Tasks 1-3), then brain (Task 4), then prompt (Tasks 5-6), then client store + hook (Tasks 7-8), then UI component (Task 9), then UI wiring (Task 10), then route handler (Tasks 11-13). Each task ends in a commit. Final task (14) is the end-to-end smoke pass.

---

## Task 1: Add `plan` StreamEvent variant and `PlanPayload` type

**Files:**
- Modify: `lib/chat/streaming/protocol.ts`

This is pure types. No runtime change. Locks in the wire format that downstream tasks consume.

- [ ] **Step 1: Open `lib/chat/streaming/protocol.ts` and inspect current shape**

Confirm the file matches what's expected: a `StreamEvent` discriminated union with variants `thinking_start | thinking_delta | thinking_end | text | tool | clarification | usage | error | done`. The `tool` variant has `name: 'add_node' | 'update_node' | 'remove_node'`.

- [ ] **Step 2: Add `PlanPayload` type and `plan` event variant**

Replace the entire file contents with:

```ts
import type { WorkflowPatch } from '@/lib/workflow/workflow-patch';

/**
 * Wire-format shape of a workflow plan proposed by the model. Mirrors
 * the `propose_plan` tool's input schema one-to-one.
 *
 * blueprint mirrors the existing `add_node` tool input — when the user
 * approves, the route applies it via dispatchTool('add_node', blueprint).
 */
export interface PlanPayload {
  title: string;
  summary: string;
  arrows: string;
  models: string[];
  detail: string;
  blueprint: {
    nodes?: any[];  // shape matches add_node.nodes[] item — kept loose here
    edges?: any[];  // shape matches add_node.edges[] item — kept loose here
  };
}

/**
 * NDJSON stream events emitted by the new chat brain.
 * One JSON object per line, terminated by '\n'.
 *
 * Order guarantee per turn:
 *   [thinking_start] [thinking_delta]* [thinking_end]
 *   [text]*
 *   [tool]*
 *   [clarification?]
 *   [plan?]            ← B-2; never coexists with [tool] or [clarification]
 *                        in same turn (prompt-enforced, not protocol-enforced)
 *   [usage]
 *   [done]
 */
export type StreamEvent =
  | { type: 'thinking_start' }
  | { type: 'thinking_delta'; text: string }
  | { type: 'thinking_end' }
  | { type: 'text'; text: string }
  | { type: 'tool'; name: 'add_node' | 'update_node' | 'remove_node'; patch: WorkflowPatch }
  | { type: 'clarification'; options: string[] }
  | { type: 'plan'; plan: PlanPayload }
  | { type: 'usage'; inputTokens: number; outputTokens: number; thinkingTokens: number; costUsd: number }
  | { type: 'error'; message: string; recoverable: boolean }
  | { type: 'done' };

export type StreamEventType = StreamEvent['type'];
```

- [ ] **Step 3: Verify the change**

Run: `npm run lint`
Expected: PASS (no new TypeScript errors). The `PlanPayload.blueprint` uses `any[]` deliberately — the schema is enforced at the tool input layer, not at the streaming protocol layer.

- [ ] **Step 4: Commit**

```bash
git add lib/chat/streaming/protocol.ts
git commit -m "feat(chat): add plan StreamEvent + PlanPayload type for B-2"
```

---

## Task 2: Extract `nodesEdgesSchema` and add `propose_plan` tool

**Files:**
- Modify: `lib/chat/tools/definitions.ts`

The existing `add_node` tool inlines the nodes/edges schema. We extract it into a shared constant so `propose_plan.blueprint` can reference it — single source of truth.

- [ ] **Step 1: Read the current `definitions.ts` carefully**

Confirm: `inputEdgeSchema` and `topLevelEdgeSchema` are defined; `add_node` has inline `nodes[]` items and `edges` referencing `topLevelEdgeSchema`; `ToolName` is `'add_node' | 'update_node' | 'remove_node' | 'ask_clarification'`.

- [ ] **Step 2: Extract a shared `nodesEdgesSchema`**

After the existing `topLevelEdgeSchema` constant and BEFORE the `TOOLS` array, add:

```ts
/**
 * Shared schema fragment for nodes[] and edges[] arrays. Used by both
 * add_node (the live tool) and propose_plan.blueprint (the structured
 * payload approved into add_node verbatim). Keeping these in one place
 * prevents drift between the proposing-time validator and the apply-time
 * dispatch.
 */
const nodesEdgesSchema = {
  nodes: {
    type: 'array' as const,
    description: 'All nodes — same item shape as add_node.nodes[].',
    items: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'Simple temporary node ID (e.g. "n1", "prompt_1").' },
        type: { type: 'string', enum: NODE_TYPE_ENUM, description: 'Base node type.' },
        node_type_id: { type: 'string', description: 'Required when type is ai_generator.' },
        model_id: { type: 'number', description: 'Optional model ID when relevant.' },
        position: {
          type: 'object',
          properties: { x: { type: 'number' }, y: { type: 'number' } },
          required: ['x', 'y'],
          description: 'Position hint — auto-calculated, any value is fine.'
        },
        data: {
          type: 'object',
          properties: { config: { type: 'object', additionalProperties: true } },
          required: ['config'],
          description: 'Node config matching the registry aiSchema for this type.'
        },
        inputs: {
          type: 'array',
          items: inputEdgeSchema,
          default: [],
          description: 'Legacy per-node edge list. Prefer top-level edges[].'
        }
      },
      required: ['id', 'type', 'position', 'data']
    },
    default: []
  },
  edges: {
    type: 'array' as const,
    items: topLevelEdgeSchema,
    default: [],
    description: 'Edges to add. Source/target may be temp ids or existing canvas UUIDs.'
  }
} as const;
```

- [ ] **Step 3: Refactor `add_node` to use `nodesEdgesSchema`**

Replace the existing `add_node` entry in the `TOOLS` array with:

```ts
{
  name: 'add_node',
  description: `Add one or more nodes AND/OR edges to the canvas in a single call. Always batch every node for a workflow into ONE call.
Edges can connect any pair of nodes — new ones added here, existing canvas nodes by UUID, or a mix (new→existing, existing→new, existing→existing).
Either side of an edge can be a temp id used in this same call's nodes[] array, or an existing canvas UUID.
Topological order is mandatory for nodes: a node's inputs may only reference IDs that appear earlier in this array or that already exist on the canvas.`,
  input_schema: {
    type: 'object',
    properties: {
      nodes: nodesEdgesSchema.nodes,
      edges: nodesEdgesSchema.edges
    },
    required: []
  }
},
```

This is a structural refactor — same JSON the model sees, just sourced from the shared constant.

- [ ] **Step 4: Add `propose_plan` to `TOOLS`**

After the `ask_clarification` entry, add:

```ts
{
  name: 'propose_plan',
  description:
    'Propose a workflow plan for the user to approve before building. ' +
    'Use ONLY for genuinely complex requests where guessing wrong would ' +
    'waste real work — multi-section pipelines, large rewrites, or builds ' +
    'with multiple model choices that affect creative direction. Do NOT ' +
    'use for simple single-node updates, trivial changes, or anything where ' +
    'the right answer is obvious. Do NOT use in the same turn as ' +
    'ask_clarification — clarify first, plan next turn. Do NOT also call ' +
    'add_node / update_node / remove_node in the same turn — the blueprint ' +
    'IS the build; the user approves it to apply.',
  input_schema: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        maxLength: 60,
        description: 'Short title naming the workflow.'
      },
      summary: {
        type: 'string',
        maxLength: 240,
        description: 'One- or two-sentence "what it does" — plain prose, no list.'
      },
      arrows: {
        type: 'string',
        maxLength: 240,
        description: 'Compact arrow-style overview, one line.'
      },
      models: {
        type: 'array',
        items: { type: 'string', maxLength: 60 },
        maxItems: 6,
        description: 'Model names used. Empty array if none.'
      },
      detail: {
        type: 'string',
        maxLength: 1200,
        description:
          'Detailed plan: nodes used, creative direction, scene/look description, ' +
          'inputs, expected output appearance. Match length to plan complexity. ' +
          'Plain prose, no markdown headers.'
      },
      blueprint: {
        type: 'object',
        description: 'Structured workflow patch applied verbatim if user approves. Same shape as add_node input.',
        properties: {
          nodes: nodesEdgesSchema.nodes,
          edges: nodesEdgesSchema.edges
        },
        required: []
      }
    },
    required: ['title', 'summary', 'arrows', 'models', 'detail', 'blueprint']
  }
},
```

- [ ] **Step 5: Widen `ToolName`**

Change the `ToolName` export at the bottom of the file from:

```ts
export type ToolName = 'add_node' | 'update_node' | 'remove_node' | 'ask_clarification';
```

to:

```ts
export type ToolName = 'add_node' | 'update_node' | 'remove_node' | 'ask_clarification' | 'propose_plan';
```

- [ ] **Step 6: Verify the change**

Run: `npm run lint`
Expected: PASS. If any of `dispatchTool`'s callers complain about exhaustiveness in a switch, that's a downstream task (Task 4 handles brain.ts; `dispatchTool` itself in handlers.ts already has a `default` branch and the `ask_clarification` no-op case so adding `propose_plan` to the type widens the input but the existing default branch catches it).

Run: `npm run build`
Expected: PASS — confirms the wider `ToolName` type doesn't break any consumer.

- [ ] **Step 7: Commit**

```bash
git add lib/chat/tools/definitions.ts
git commit -m "feat(chat): extract nodesEdgesSchema; add propose_plan tool"
```

---

## Task 3: Add `validateBlueprint` helper to `handlers.ts`

**Files:**
- Modify: `lib/chat/tools/handlers.ts`
- Create (optional): `scripts/test-validate-blueprint.js`

The brain needs to validate a `propose_plan` blueprint at emit time so an unapplyable plan never reaches the user. This is a dry-run version of `runAddNode` — same checks, no state mutation.

- [ ] **Step 1: Read `handlers.ts` and identify the validation helpers**

Locate `validateNodeConfigAgainstRegistry` (lightweight aiSchema check) and `validateEdgeHandles` (target-handle existence). These are the two validators we'll reuse.

- [ ] **Step 2: Add `validateBlueprint` function**

At the end of `handlers.ts`, after `dispatchTool`, append:

```ts
/**
 * Dry-run validation of a propose_plan blueprint. Runs the same checks
 * runAddNode does (config schema, edge handle validity) WITHOUT mutating
 * state. Returns { ok: true } if the blueprint would apply cleanly, or
 * { ok: false, error } with a specific failure reason.
 *
 * Why we re-validate here: the brain emits the plan event BEFORE any
 * apply happens. If the model produces an invalid blueprint, we want to
 * surface the error immediately so the model self-corrects on the next
 * turn — instead of letting the user click Approve and then hit a
 * confusing apply-time failure.
 *
 * What we deliberately do NOT validate here: top-level edge endpoints
 * (whether `source` and `target` resolve to real nodes). Those checks
 * live inside runAddNode because they require building the temp-id
 * resolution map as nodes are applied. Approve-time dispatchTool catches
 * those — the proposing-time validation is a fast-fail for the easy
 * stuff. This is acceptable because per-node config + per-node edge-
 * handle checks are the most common model errors.
 */
export function validateBlueprint(
  state: ToolHandlerState,
  blueprint: { nodes?: any[]; edges?: any[] } | null | undefined,
): { ok: true } | { ok: false; error: string } {
  if (!blueprint || (typeof blueprint !== 'object')) {
    return { ok: false, error: 'Blueprint missing or not an object.' };
  }
  const nodes = Array.isArray(blueprint.nodes) ? blueprint.nodes : [];
  const edges = Array.isArray(blueprint.edges) ? blueprint.edges : [];

  if (nodes.length === 0 && edges.length === 0) {
    return { ok: false, error: 'Blueprint must contain at least one node or one edge.' };
  }

  // Same per-node aiSchema check runAddNode runs.
  for (const node of nodes) {
    const err = validateNodeConfigAgainstRegistry(node);
    if (err) return { ok: false, error: err };
  }

  // Same per-node edge-handle check runAddNode runs.
  for (const node of nodes) {
    const err = validateEdgeHandles(node, state.aiModelHandles);
    if (err) return { ok: false, error: err };
  }

  return { ok: true };
}
```

Note: `validateNodeConfigAgainstRegistry` and `validateEdgeHandles` are currently `function` (not `export function`). They stay file-private. `validateBlueprint` is the only exported addition.

- [ ] **Step 3: Verify the change with type-check**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 4 (optional but recommended): Add ad-hoc smoke script**

Create `scripts/test-validate-blueprint.js`:

```js
// Smoke-test the validateBlueprint helper. Run with `node scripts/test-validate-blueprint.js`.
// Requires that the project is built (`npm run build`) so the compiled
// helpers are importable.
//
// Note: this script imports from the compiled .next bundle is brittle.
// Simpler approach: import from source via tsx if available. The repo
// uses Node directly per CLAUDE.md so we use a thin TS-aware approach:
// require the source file via a tsconfig-paths alias if configured, or
// just exit with a hand-coded shape check.
//
// Pragmatic path: this script verifies the EXPORTED FUNCTION SHAPE only.
// Real semantics are validated via the manual smoke test in Task 14.

const path = require('path');
const fs = require('fs');

const handlersPath = path.join(__dirname, '..', 'lib', 'chat', 'tools', 'handlers.ts');
const src = fs.readFileSync(handlersPath, 'utf8');

if (!/export function validateBlueprint/.test(src)) {
  console.error('FAIL: validateBlueprint not exported from handlers.ts');
  process.exit(1);
}
if (!/return \{ ok: true \}/.test(src)) {
  console.error('FAIL: validateBlueprint missing ok-success return');
  process.exit(1);
}
if (!/return \{ ok: false, error/.test(src)) {
  console.error('FAIL: validateBlueprint missing error return');
  process.exit(1);
}
console.log('OK: validateBlueprint shape looks right.');
```

This is a shape-check rather than a behavioral test — runtime semantics will be verified manually in Task 14. Skipping is acceptable; the script exists as a tripwire for grossly broken refactors.

Run: `node scripts/test-validate-blueprint.js`
Expected: `OK: validateBlueprint shape looks right.`

- [ ] **Step 5: Commit**

```bash
git add lib/chat/tools/handlers.ts scripts/test-validate-blueprint.js
git commit -m "feat(chat): add validateBlueprint dry-run helper for B-2"
```

(If the script wasn't created, just stage the handlers.ts change.)

---

## Task 4: Wire `propose_plan` in `brain.ts`

**Files:**
- Modify: `lib/chat/brain.ts`

The brain recognizes `propose_plan` in the tool-call path, runs `validateBlueprint`, and emits the `plan` event on success. `BrainResult` gains a `plan` field for the route to persist.

- [ ] **Step 1: Re-read the existing `brain.ts` tool_call switch**

Confirm the structure: `case 'tool_call':` at lib/chat/brain.ts:108-147 has `name = event.name as ToolName`, then a special-case branch for `ask_clarification`, then a guard `if (name !== 'add_node' && name !== 'update_node' && name !== 'remove_node')`, then the dispatch.

- [ ] **Step 2: Update import to include `validateBlueprint`**

Find the existing import:

```ts
import { dispatchTool, type ToolHandlerState } from './tools/handlers';
```

Change it to:

```ts
import { dispatchTool, validateBlueprint, type ToolHandlerState } from './tools/handlers';
```

- [ ] **Step 3: Update the `PlanPayload` import in brain.ts**

Add a type-only import after the existing imports:

```ts
import type { PlanPayload } from './streaming/protocol';
```

Place it grouped with the other type imports near the top.

- [ ] **Step 4: Extend `BrainResult` interface**

Find the existing `BrainResult` interface (lib/chat/brain.ts:10-18). Add a `plan` field at the end:

```ts
export interface BrainResult {
  finalText: string;
  finalThinking: string;
  finalWorkflow: Workflow;
  accumulatedPatch: WorkflowPatch | null;
  hadAnyOutput: boolean;
  usage: { inputTokens: number; outputTokens: number; thinkingTokens: number; costUsd: number } | null;
  clarification: { options: string[] } | null;
  plan: PlanPayload | null;
}
```

- [ ] **Step 5: Add `plan` accumulator inside `runBrain`**

Find the existing accumulator block:

```ts
let usage: BrainResult['usage'] = null;
let clarification: BrainResult['clarification'] = null;
```

Add directly after:

```ts
let plan: BrainResult['plan'] = null;
```

- [ ] **Step 6: Add the `propose_plan` branch in the tool_call switch**

Inside `case 'tool_call': { ... }`, after the existing `ask_clarification` branch and BEFORE the workflow-tools guard, insert:

```ts
if (name === 'propose_plan') {
  const args = (event.args ?? {}) as Record<string, unknown>;

  // Required-prose check: each must be a non-empty string after trim.
  const requireString = (key: string): string | null => {
    const v = args[key];
    if (typeof v !== 'string' || v.trim().length === 0) {
      return `propose_plan requires non-empty string field "${key}".`;
    }
    return null;
  };
  for (const key of ['title', 'summary', 'arrows', 'detail']) {
    const err = requireString(key);
    if (err) {
      input.encoder.send({ type: 'error', message: err, recoverable: true });
      break;
    }
  }
  // models: array of strings (may be empty).
  const rawModels = args.models;
  if (!Array.isArray(rawModels) || !rawModels.every(m => typeof m === 'string')) {
    input.encoder.send({
      type: 'error',
      message: 'propose_plan.models must be an array of strings (may be empty).',
      recoverable: true
    });
    break;
  }

  // Blueprint dry-run validation — same checks dispatchTool('add_node') runs.
  const blueprint = (args.blueprint ?? null) as { nodes?: any[]; edges?: any[] } | null;
  const validation = validateBlueprint(state, blueprint);
  if (!validation.ok) {
    input.encoder.send({
      type: 'error',
      message: `propose_plan blueprint invalid: ${validation.error}`,
      recoverable: true
    });
    break;
  }

  // First valid plan per turn wins. Subsequent propose_plan calls are ignored.
  if (!plan) {
    plan = {
      title: String(args.title).trim(),
      summary: String(args.summary).trim(),
      arrows: String(args.arrows).trim(),
      models: rawModels as string[],
      detail: String(args.detail).trim(),
      blueprint: {
        nodes: Array.isArray(blueprint?.nodes) ? blueprint.nodes : [],
        edges: Array.isArray(blueprint?.edges) ? blueprint.edges : [],
      },
    };
    input.encoder.send({ type: 'plan', plan });
  }
  break;
}
```

- [ ] **Step 7: Add `plan` to the brain's return value**

At the bottom of `runBrain`, find:

```ts
return { finalText, finalThinking, finalWorkflow, accumulatedPatch, hadAnyOutput, usage, clarification };
```

Change to:

```ts
return { finalText, finalThinking, finalWorkflow, accumulatedPatch, hadAnyOutput, usage, clarification, plan };
```

- [ ] **Step 8: Verify the change**

Run: `npm run lint`
Expected: PASS. The `dispatchTool` exhaustiveness check inside `handlers.ts` already has a `default` branch via the `_exhaustive: never` pattern; widening `ToolName` to include `'propose_plan'` will trip that check IF dispatchTool itself sees `'propose_plan'`. But brain.ts NEVER passes `'propose_plan'` through `dispatchTool` (the propose_plan branch breaks before the dispatch call). So dispatchTool's runtime never sees it. However, at compile time, the `_exhaustive: never` line would fail because `'propose_plan'` is now part of `ToolName` and the switch doesn't handle it.

Look at `lib/chat/tools/handlers.ts` `dispatchTool` switch. The current `default` branch is:

```ts
default: {
  const _exhaustive: never = name;
  return { success: false, error: `Unknown tool: ${_exhaustive}` };
}
```

With `ToolName` now widened to include `'propose_plan'`, this WILL fail TypeScript exhaustiveness checking. Add a no-op case for `'propose_plan'` directly above the default:

```ts
case 'propose_plan':
  // Handled directly by the brain (see brain.ts) — never patches the workflow.
  // Reached only if the brain forwards it here by mistake; treat as a no-op,
  // mirroring the ask_clarification handling above.
  return { success: true };
default: {
  const _exhaustive: never = name;
  return { success: false, error: `Unknown tool: ${_exhaustive}` };
}
```

(This is a small handlers.ts edit done in this task because it's tightly coupled to the type widening from Task 2 + the brain.ts wiring here. Single commit makes it reviewable.)

Run again: `npm run lint`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add lib/chat/brain.ts lib/chat/tools/handlers.ts
git commit -m "feat(chat): wire propose_plan in brain — validate + emit plan event"
```

---

## Task 5: Extend system prompt with PLAN PROPOSAL rules

**Files:**
- Modify: `lib/chat/prompt/system.ts`

Three additions: a `PLAN PROPOSAL` subsection in `TOOL_RULES`, one line in `CAPABILITIES`, and a new `CRITICAL_RULES` rule.

- [ ] **Step 1: Re-read `system.ts` to confirm the current structure**

Confirm: `IDENTITY`, `CAPABILITIES`, `TOOL_RULES` (with subsection `CLARIFYING QUESTIONS`), `RESPONSE_FORMAT`, `CRITICAL_RULES` are all named constants assembled in `buildSystemPrompt`. The prompt ends with `FEWSHOT_EXAMPLES` (imported from `examples.ts`).

- [ ] **Step 2: Update `CAPABILITIES`**

Find the existing `CAPABILITIES` constant (lib/chat/prompt/system.ts:19-21). Replace its body's `You can:` line so the constant becomes:

```ts
const CAPABILITIES = `CAPABILITIES:
You can: build new workflows, modify existing ones, answer questions about the system, see images attached to the conversation, reason about the current canvas state, ask short clarifying questions with chip options when a request is genuinely ambiguous, propose a workflow plan for the user to approve before complex builds.
You cannot: run workflows yourself (the user clicks Run), see runtime outputs from past runs unless they are in the conversation history, access files outside of the user's attachments.`;
```

(Only the `You can:` line is altered — added the `propose a workflow plan…` clause.)

- [ ] **Step 3: Append PLAN PROPOSAL subsection to `TOOL_RULES`**

The current `TOOL_RULES` constant ends with `If the user replies just "Skip" (or its equivalent in their language) to a clarification, treat it as permission to proceed with your best-judgment default. Do NOT re-ask — pick what you think is best and continue.`;

Add a new section AFTER that closing line, BEFORE the closing backtick. The full `TOOL_RULES` constant becomes:

```ts
const TOOL_RULES = `TOOL USAGE RULES:
- Use tools whenever the user asks for a workflow change. Don't use them for pure questions or explanations.
- Explain in 1-2 sentences before the tool call. Do not output numbered plans before tool calls.
- BATCHING: For any workflow creation, include ALL new nodes in a SINGLE add_node call.
- TOPOLOGICAL ORDER (mandatory): a node may only be added after every node it lists in inputs already exists in the same call (earlier in the array) or in the existing canvas.
- ID rules: for new nodes generate simple IDs like "n1", "n2", "prompt_1"; reuse those IDs in later tool calls in the same turn.
- Positions: pass any position — they are auto-calculated. Focus on types, connections, config.
- After tool calls, do not restate every node added — the UI shows the diff.

CLARIFYING QUESTIONS:
- Use ask_clarification ONLY when the request is genuinely ambiguous and guessing wrong would likely require redoing work. Do not ask for trivial defaults — pick a sensible one and proceed.
- ALWAYS call ask_clarification when you write a choice-question. The chip card UI is the ONLY way the user can answer with chips; if you write the question without the tool call, the chips never appear and the user is stuck. No exceptions.
- When you ask, write ONE short forward-question as the last line of your text body (this becomes the bubble's text). Then call ask_clarification with 2-4 options in the SAME turn.
- Each option must be a complete, fully-formed answer the user could send as their next message. Keep each ≤ 40 chars. Make them mutually exclusive.
- Pure question turn: when you call ask_clarification, do NOT also call add_node / update_node / remove_node in the same turn. If you have a question, ask it first; act on the answer next turn.
- Phrase the question and the options in the user's language (if they wrote in Hebrew, the chips are in Hebrew).
- Do not re-ask something the user already answered earlier in this session.
- If the user replies just "Skip" (or its equivalent in their language) to a clarification, treat it as permission to proceed with your best-judgment default. Do NOT re-ask — pick what you think is best and continue.

PLAN PROPOSAL:
- Use propose_plan ONLY for genuinely complex builds where guessing wrong would waste real work: multi-section pipelines, large rewrites, builds with multiple model choices that affect creative direction, or workflows that combine 4+ nodes spanning different functional roles (input → generation → composition → post-process).
- Do NOT use propose_plan for: single-node updates, swapping one model for another, trivial config edits, or anything where the right answer is obvious from the user's request.
- Do NOT use propose_plan in the same turn as ask_clarification — clarify first, plan next turn after the answer.
- Do NOT call add_node / update_node / remove_node in the same turn as propose_plan. The blueprint IS the build; the user approves it to apply.
- The blueprint must be complete and apply-ready: every node fully configured per its aiSchema, every edge valid. The same validation that runs on add_node runs on the blueprint when the user approves — an invalid blueprint surfaces as an error after Approve, which is a poor UX.
- Phrase title, summary, arrows, models, and detail in the user's language (Hebrew request → Hebrew plan content).
- Match detail length to plan complexity. Short pipeline → short detail. Complex pipeline → fuller detail. Do not pad.
- Detail should cover: what each node contributes, the creative direction (look, feel, scene), the inputs the workflow consumes, and what the user can expect to see at the end. Plain prose, no markdown headers.
- After feedback, emit a NEW propose_plan that ADDRESSES the feedback. Do not just re-emit the same plan. Acknowledge the change in the new summary or detail so the user can see what shifted.
- Do NOT propose_plan again immediately after the user approves a plan — approval means the build happened; the next user message starts a fresh exchange.`;
```

- [ ] **Step 4: Append rule 7 to `CRITICAL_RULES`**

The current `CRITICAL_RULES` constant lists rules 1 through 6. Append rule 7 inside the template-literal so the constant becomes:

```ts
const CRITICAL_RULES = `CRITICAL RULES — MUST follow:
1. Every node you add MUST have its config fully populated. NEVER emit \`data.config: {}\` — empty config corrupts the canvas. Read the REQUIRED CONFIG block for each node type below.
2. For ai_generator, model_id is MANDATORY. Pick from "AI GENERATOR MODELS" and set both top-level model_id AND data.config.model_id. Handles are DYNAMIC per model — targetHandle MUST match one of the input handle ids listed for the chosen model.
3. For compositor, edges into it use targetHandle: "layers". Leave config.layers as []; the canvas auto-creates layers from incoming edges.
4. When you call a tool, emit at least one short sentence of confirmation text before the tool call.
5. Respond in the same language the user wrote in.
6. NEVER end a turn with a question that asks the user to choose between alternatives unless you ALSO call ask_clarification with 2-4 options in the same turn. The chip card UI cannot render without the tool call — without it the user sees the question but no way to answer except free text. If you write the question, you MUST call the tool.
7. When you call propose_plan, the blueprint must be a complete, apply-ready workflow patch — same node/edge structure rules as add_node, same fully-populated configs, same model_id requirements. The blueprint is what builds the canvas after Approve; an invalid blueprint becomes a user-visible error.`;
```

- [ ] **Step 5: Verify the change**

Run: `npm run lint`
Expected: PASS — pure string changes.

Run: `npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/chat/prompt/system.ts
git commit -m "feat(chat): add PLAN PROPOSAL prompt rules + CRITICAL_RULES rule 7"
```

---

## Task 6: Add fourth few-shot example (plan + revision)

**Files:**
- Modify: `lib/chat/prompt/examples.ts`

One example showing: when to propose, plan-and-blueprint structure together, voice tone, and the no-other-tools rule. Plus one feedback round-trip.

- [ ] **Step 1: Re-read `examples.ts`**

Confirm the current shape: a single exported `FEWSHOT_EXAMPLES` constant with 3 examples.

- [ ] **Step 2: Replace `FEWSHOT_EXAMPLES` with the four-example version**

Replace the entire content of `lib/chat/prompt/examples.ts` with:

```ts
/**
 * Four short few-shot examples included unconditionally. Total ~400 tokens.
 * Sonnet 4.6 follows tone instructions well without heavy fewshot — keep
 * this minimal. If voice consistency drifts in real traffic, tune here.
 */
export const FEWSHOT_EXAMPLES = `EXAMPLES OF VOICE:

User: make me a workflow that puts a person on a beach
Assistant: Got it. I'll use Imagen 4 for the beach (strong photographic backgrounds), background-removal on your photo, then composite.
[calls add_node with 3 nodes (input, generator, compositor) and 2 edges in the same call]
Workflow ready. Run it or tweak first?

User: what does the background_remover node do?
Assistant: It runs your input image through a segmentation model and outputs the subject as a transparent PNG. Useful before compositing.

User: edit the photo so it looks more cinematic
Assistant: Cinematic can lean a few directions — which feel are you going for?
[calls ask_clarification with options=["Warm, golden-hour color grade", "Cool, teal-and-orange contrast", "Moody low-key with film grain"]]
(no other tools in this turn — wait for the answer)

User: build a workflow that takes my photo, puts me in a cyberpunk neon-lit Tokyo street at night, plus add color grading
Assistant: Here's how I'd build the cyberpunk Tokyo composite.
[calls propose_plan with:
  title="Cyberpunk Tokyo composite"
  summary="Drops your portrait into an AI-generated neon-lit Tokyo street, then runs a teal-orange color grade over the result."
  arrows="photo → bg-remove → composite ← flux-pro ← prompt → grade → output"
  models=["Flux Pro", "BG-remover", "Color grade"]
  detail="The photo gets background-removed to isolate you. Flux Pro generates a wide cyberpunk Tokyo scene — wet streets, neon signage, vapor, shallow depth-of-field — sized to match. The compositor places you in the foreground at street level. A color-grade pass tunes the whole frame teal-and-orange for the cinematic neon feel. Inputs: your portrait. Output: a 1024×1024 photographic composite."
  blueprint={ ... apply-ready nodes + edges, every config populated ... }]
(no add_node / update_node / remove_node in this turn — the blueprint IS the build; the user approves it next.)

[next turn — user clicked Approve, server applied blueprint, no model call]

[separate revision example]
User (next turn after a similar plan, with feedback "Use Imagen 4 instead of Flux and skip the color grade"):
Assistant: Switched to Imagen 4 and dropped the grade pass.
[calls propose_plan with:
  title="Cyberpunk Tokyo composite"
  summary="Drops your portrait into an Imagen 4-generated cyberpunk Tokyo street. Color grading removed per your feedback."
  arrows="photo → bg-remove → composite ← imagen-4 ← prompt → output"
  models=["Imagen 4", "BG-remover"]
  detail="..."
  blueprint={ ... revised nodes + edges ... }]`;
```

- [ ] **Step 3: Verify the change**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/chat/prompt/examples.ts
git commit -m "feat(chat): add propose_plan few-shot example + revision example"
```

---

## Task 7: Extend `Message` store type

**Files:**
- Modify: `lib/store/types.ts`

The store needs `plan` and `planAnswer` fields on `Message` so the reducer can store the plan event payload and the renderer can derive card state.

- [ ] **Step 1: Re-read `lib/store/types.ts` lines 1-33 to confirm the current Message shape**

- [ ] **Step 2: Add `plan` and `planAnswer` fields**

Find the `Message` interface (lib/store/types.ts:5-33). Replace its body so it becomes:

```ts
export interface Message {
    id: string;
    type: 'user' | 'assistant';
    content: string;
    result?: any;
    images?: string[];
    timestamp: Date;
    sessionId?: string;
    status?: 'running' | 'completed' | 'error';
    workflow?: any;
    // Thinking / extended-brain fields (new brain only)
    thinking?: string;
    isThinking?: boolean;
    thinkingStartedAt?: number;
    thinkingDurationMs?: number;
    usage?: {
        inputTokens: number;
        outputTokens: number;
        thinkingTokens: number;
        costUsd: number;
    };
    // Clarification chip card (assistant turn): set when the brain emits
    // a `clarification` stream event for this message.
    clarification?: { options: string[] };
    // Set on the assistant message once the user has answered the clarification
    // (either via chip click or by typing). chosenIndex is null for typed answers.
    // text mirrors the user's reply text; used to render the answered chip card.
    clarificationAnswer?: { chosenIndex: number | null; text: string };
    // Plan card (assistant turn): set when the brain emits a `plan`
    // stream event. The full PlanPayload from the propose_plan tool.
    plan?: {
        title: string;
        summary: string;
        arrows: string;
        models: string[];
        detail: string;
        blueprint: { nodes?: any[]; edges?: any[] };
    };
    // Set on the assistant plan message once the user has approved it
    // or sent feedback. chosenAction === 'approve' renders the locked
    // approved state; 'feedback' renders the feedback-given state with
    // the feedback text shown.
    planAnswer?: {
        action: 'approve' | 'feedback';
        feedbackText?: string;
    };
    // Transient client-only error from the most-recent approve attempt.
    // NOT persisted. Reverts to undefined after the user submits feedback
    // or reloads the page.
    planApproveError?: string;
}
```

- [ ] **Step 3: Verify the change**

Run: `npm run lint`
Expected: PASS.

Run: `npm run build`
Expected: PASS — confirms no consumer broke from the wider type.

- [ ] **Step 4: Commit**

```bash
git add lib/store/types.ts
git commit -m "feat(chat): add plan + planAnswer fields to Message store type"
```

---

## Task 8: Wire `plan` event in `useChatMessages`; resolve `planAnswer` sidecar; optimistic approve

**Files:**
- Modify: `lib/hooks/use-chat-messages.ts`

Three changes to this hook:
1. Add a `plan` branch in `processStreamLine` that writes the payload onto the assistant message.
2. Extend `handleSend` to resolve a `planAnswer` sidecar — explicit (passed in) OR implicit (typed in main input while a plan is pending).
3. Pass `planAnswer` in the request body.
4. Add an `onPlanApprove` / `onPlanFeedback` pair the UI can call. (Approve uses a synthetic 'Approved' user message + sidecar action 'approve'.)

This is the biggest task in the plan; split into careful steps.

- [ ] **Step 1: Re-read the current `handleSend` signature and the clarification-resolution block (lines 120-150)**

Confirm: clarification answer resolves either from an explicit `clarificationAnswerOverride` param or by scanning back from `messages` for a pending `clarification` without `clarificationAnswer`.

- [ ] **Step 2: Add `planAnswer` sidecar resolution to `handleSend`**

Find the `handleSend` function signature:

```ts
const handleSend = async (
    trimmedInput: string,
    attachedBlobs: Blob[],
    attachedImages: string[],
    clearAttachments: () => void,
    setInput: (val: string) => void,
    clarificationAnswerOverride?: { questionMessageId: string; chosenIndex: number | null }
) => {
```

Extend it with a `planAnswerOverride` parameter:

```ts
const handleSend = async (
    trimmedInput: string,
    attachedBlobs: Blob[],
    attachedImages: string[],
    clearAttachments: () => void,
    setInput: (val: string) => void,
    clarificationAnswerOverride?: { questionMessageId: string; chosenIndex: number | null },
    planAnswerOverride?: { planMessageId: string; action: 'approve' | 'feedback'; feedbackText?: string }
) => {
```

- [ ] **Step 3: Add plan-answer resolution next to the clarification block**

After the existing clarification-resolution block (the `for (let i = messages.length - 1; ...)` loop), add a parallel block:

```ts
// Resolve plan answer: explicit override (from approve / feedback button) OR
// implicit (the most recent assistant message has a pending plan and the
// user is responding via the main chat input — treated as feedback).
let resolvedPlanAnswer: { planMessageId: string; action: 'approve' | 'feedback'; feedbackText?: string } | undefined =
    planAnswerOverride;
if (!resolvedPlanAnswer) {
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m.type === 'assistant') {
            if (m.plan && !m.planAnswer) {
                resolvedPlanAnswer = {
                    planMessageId: m.id,
                    action: 'feedback',
                    feedbackText: trimmedInput,
                };
            }
            break; // only inspect the most recent assistant in this session
        }
    }
}
```

- [ ] **Step 4: Apply the resolved plan answer to the assistant plan message optimistically**

After the existing block:

```ts
if (resolvedClarificationAnswer) {
    useAppStore.getState().updateMessage(resolvedClarificationAnswer.questionMessageId, { ... });
}
```

Add a parallel block:

```ts
if (resolvedPlanAnswer) {
    useAppStore.getState().updateMessage(resolvedPlanAnswer.planMessageId, {
        planAnswer: {
            action: resolvedPlanAnswer.action,
            feedbackText: resolvedPlanAnswer.action === 'feedback' ? resolvedPlanAnswer.feedbackText : undefined,
        },
        planApproveError: undefined, // clear any prior approve-failed state
    });
}
```

- [ ] **Step 5: Pass `planAnswer` in the request body**

Find the existing `fetch('/api/chat/stream', { ... body: JSON.stringify({ ... }) })` block. Inside the body object, add a new field after `clarificationAnswer`:

```ts
body: JSON.stringify({
    messages: fullHistory,
    sessionId: activeSessionId,
    previousWorkflow: useAppStore.getState().currentWorkflow,
    attachedImages: imagesToSend,
    selectedModel: useAppStore.getState().selectedChatModel,
    clarificationAnswer: resolvedClarificationAnswer,
    planAnswer: resolvedPlanAnswer,
    userMessageId: userMsgId,
    assistantMessageId: assistantMsgId,
}),
```

- [ ] **Step 6: Add `plan` branch in `processStreamLine`**

Find the existing `else if (parsed.type === 'clarification')` branch in `processStreamLine`. Directly after it, add:

```ts
else if (parsed.type === 'plan') {
    const p = parsed.plan;
    if (p && typeof p === 'object') {
        useAppStore.getState().updateMessage(assistantMsgId, {
            plan: {
                title: typeof p.title === 'string' ? p.title : '',
                summary: typeof p.summary === 'string' ? p.summary : '',
                arrows: typeof p.arrows === 'string' ? p.arrows : '',
                models: Array.isArray(p.models) ? p.models.filter((s: any) => typeof s === 'string') : [],
                detail: typeof p.detail === 'string' ? p.detail : '',
                blueprint: {
                    nodes: Array.isArray(p.blueprint?.nodes) ? p.blueprint.nodes : [],
                    edges: Array.isArray(p.blueprint?.edges) ? p.blueprint.edges : [],
                },
            },
        });
    }
}
```

- [ ] **Step 7: Handle the approve-failed error case**

The current `else if (parsed.type === 'error')` branch appends the error text to `networkText`. For approve-failed errors specifically, we want the error to also surface on the plan card via `planApproveError`. The simplest approach: if there's a pending plan with `planAnswer.action === 'approve'` on this turn, write the error message to `planApproveError` and DO NOT append to `networkText` (so we don't double-render). Modify the existing branch:

Find:

```ts
else if (parsed.type === 'error') {
    // Accept either new-brain `message` field or legacy `content` field
    const errorText = parsed.message ?? parsed.content ?? 'Unknown error';
    networkText += (networkText ? '\n\n' : '') + `⚠️ ${errorText}`;
}
```

Replace with:

```ts
else if (parsed.type === 'error') {
    const errorText = parsed.message ?? parsed.content ?? 'Unknown error';
    // Special-case: if this turn is an approve attempt, route the error
    // to the plan card's planApproveError instead of the message body so
    // the user sees it in context (and the optimistic approved state
    // reverts to pending).
    if (resolvedPlanAnswer?.action === 'approve') {
        useAppStore.getState().updateMessage(resolvedPlanAnswer.planMessageId, {
            planAnswer: undefined, // revert optimistic approved transition
            planApproveError: errorText,
        });
    } else {
        networkText += (networkText ? '\n\n' : '') + `⚠️ ${errorText}`;
    }
}
```

- [ ] **Step 8: Add exported helpers for approve / feedback button clicks**

At the very end of the `useChatMessages` hook, BEFORE the final `return { ... }` statement, add two callbacks that wrap `handleSend`:

```ts
/** Called when the user clicks Approve & Build on a plan card. */
const handlePlanApprove = (planMessageId: string) => {
    handleSend('Approved', [], [], () => {}, () => {}, undefined, {
        planMessageId,
        action: 'approve',
    });
};

/** Called when the user submits feedback inside a plan card. */
const handlePlanFeedback = (planMessageId: string, feedbackText: string) => {
    handleSend(feedbackText, [], [], () => {}, () => {}, undefined, {
        planMessageId,
        action: 'feedback',
        feedbackText,
    });
};
```

Then update the final `return` statement to expose these:

```ts
return {
    editingMessageId,
    setEditingMessageId,
    saveMessageToDb,
    handleRevert,
    handleStop,
    handleSend,
    retryLast,
    handlePlanApprove,
    handlePlanFeedback,
};
```

- [ ] **Step 9: Verify the change**

Run: `npm run lint`
Expected: PASS. The `Message.plan` and `Message.planAnswer` fields exist (Task 7), so all writes are type-safe.

Run: `npm run build`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add lib/hooks/use-chat-messages.ts
git commit -m "feat(chat): wire plan event + planAnswer sidecar in useChatMessages"
```

---

## Task 9: Build `PlanCard` component

**Files:**
- Create: `components/chat/PlanCard.tsx`

A self-contained component matching the spec's Section 3 layout. Mirror the styling vocabulary used in `ChipCard.tsx` (rounded-xl, border-stroke-subtle, accent-primary, etc.).

- [ ] **Step 1: Re-read `ChipCard.tsx` to internalize styling conventions**

The card uses: `rounded-xl border border-stroke-subtle bg-surface-secondary/40 p-2.5`. Buttons use `rounded-lg`, accent fills via `bg-accent-primary/15 border-accent-primary/40`, hover states via `hover:bg-accent-primary/10`. Animation is `animate-fade-in`.

- [ ] **Step 2: Create `components/chat/PlanCard.tsx`**

```tsx
'use client';

import React, { useState } from 'react';
import { Check, ChevronDown, ChevronRight, AlertCircle, RotateCcw } from 'lucide-react';

export interface PlanCardProps {
    plan: {
        title: string;
        summary: string;
        arrows: string;
        models: string[];
        detail: string;
    };
    /**
     * Card state derived from history pairing in Message.tsx:
     * - 'pending'         : no answer yet; buttons clickable
     * - 'approved'        : answered with action 'approve'
     * - 'feedback-given'  : answered with action 'feedback' (feedbackText shown)
     * - 'approve-failed'  : transient client-only state after a failed approve
     */
    status: 'pending' | 'approved' | 'feedback-given' | 'approve-failed';
    /** Set when status === 'feedback-given'. The full feedback text. */
    feedbackText?: string;
    /** Set when status === 'approve-failed'. Error from server's dispatchTool. */
    approveError?: string;
    onApprove: () => void;
    onFeedback: (text: string) => void;
}

/**
 * Plan-and-approve card rendered inside the assistant bubble. Shows
 * title, summary, arrow overview, models, expandable detail, and either
 * the approve/feedback buttons or a locked status header.
 */
export function PlanCard({
    plan,
    status,
    feedbackText,
    approveError,
    onApprove,
    onFeedback,
}: PlanCardProps) {
    const [detailOpen, setDetailOpen] = useState(false);
    const [feedbackOpen, setFeedbackOpen] = useState(false);
    const [draft, setDraft] = useState('');

    const isLocked = status !== 'pending';

    const handleSendFeedback = () => {
        const trimmed = draft.trim();
        if (trimmed.length === 0 || isLocked) return;
        onFeedback(trimmed);
        setDraft('');
        setFeedbackOpen(false);
    };

    const handleCancelFeedback = () => {
        setFeedbackOpen(false);
        setDraft('');
    };

    return (
        <div className="mt-3 rounded-xl border border-stroke-subtle bg-surface-secondary/40 p-3 space-y-2 animate-fade-in">
            {/* Status header (only shown when locked) */}
            {status === 'approved' && (
                <div className="flex items-center gap-1.5 text-xs font-medium text-accent-primary">
                    <Check className="w-3.5 h-3.5" />
                    Approved &amp; built
                </div>
            )}
            {status === 'feedback-given' && (
                <div className="flex items-center gap-1.5 text-xs font-medium text-content-tertiary">
                    <RotateCcw className="w-3.5 h-3.5" />
                    Revising — see new plan below
                </div>
            )}
            {status === 'approve-failed' && (
                <div className="flex items-center gap-1.5 text-xs font-medium text-red-500">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Approve failed — try feedback
                </div>
            )}

            {/* Title */}
            <div className="font-medium text-sm text-content-primary">{plan.title}</div>

            {/* Summary */}
            <div className="text-sm text-content-secondary whitespace-pre-wrap">{plan.summary}</div>

            {/* Arrows */}
            {plan.arrows && (
                <div className="text-xs font-mono text-content-tertiary whitespace-pre-wrap break-words">
                    {plan.arrows}
                </div>
            )}

            {/* Models pills */}
            {plan.models.length > 0 && (
                <div className="flex flex-wrap gap-1.5 text-xs text-content-tertiary">
                    <span className="font-medium">Models:</span>
                    <span>{plan.models.join(' · ')}</span>
                </div>
            )}

            {/* Feedback excerpt (locked feedback-given state) */}
            {status === 'feedback-given' && feedbackText && (
                <div className="text-xs text-content-secondary italic border-l-2 border-stroke-subtle pl-2">
                    Your feedback: "{feedbackText}"
                </div>
            )}

            {/* Approve-failed error inline */}
            {status === 'approve-failed' && approveError && (
                <div className="text-xs text-red-500 border-l-2 border-red-500/40 pl-2">
                    {approveError}
                </div>
            )}

            {/* Detail toggle */}
            <button
                type="button"
                onClick={() => setDetailOpen(o => !o)}
                className="flex items-center gap-1 text-xs text-content-tertiary hover:text-content-primary transition-colors cursor-pointer"
            >
                {detailOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                {detailOpen ? 'Hide detailed plan' : 'Detailed plan'}
            </button>

            {detailOpen && (
                <div className="text-sm text-content-secondary whitespace-pre-wrap pl-4 border-l-2 border-stroke-subtle/50">
                    {plan.detail}
                </div>
            )}

            {/* Action buttons (only when pending) */}
            {!isLocked && !feedbackOpen && (
                <div className="flex gap-2 pt-1">
                    <button
                        type="button"
                        onClick={onApprove}
                        className="flex-1 px-3 py-2 rounded-lg text-sm font-medium bg-accent-primary text-white hover:bg-accent-primary/90 transition-colors cursor-pointer"
                    >
                        Approve &amp; Build
                    </button>
                    <button
                        type="button"
                        onClick={() => setFeedbackOpen(true)}
                        className="px-3 py-2 rounded-lg text-sm bg-surface-tertiary/60 border border-stroke-subtle text-content-primary hover:bg-accent-primary/10 hover:border-accent-primary/30 transition-colors cursor-pointer"
                    >
                        Provide feedback
                    </button>
                </div>
            )}

            {/* Feedback textarea (expanded when feedbackOpen + pending) */}
            {!isLocked && feedbackOpen && (
                <div className="space-y-2 pt-1">
                    <textarea
                        value={draft}
                        onChange={e => setDraft(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSendFeedback();
                            }
                        }}
                        placeholder="What should change?"
                        autoFocus
                        rows={3}
                        className="w-full px-3 py-2 rounded-lg text-sm bg-surface-tertiary/60 border border-stroke-subtle text-content-primary placeholder-content-tertiary focus:outline-none focus:border-accent-primary/50 resize-none"
                    />
                    <div className="flex justify-between items-center gap-2">
                        <button
                            type="button"
                            onClick={onApprove}
                            className="flex-1 px-3 py-2 rounded-lg text-sm font-medium bg-accent-primary text-white hover:bg-accent-primary/90 transition-colors cursor-pointer"
                        >
                            Approve &amp; Build
                        </button>
                        <button
                            type="button"
                            onClick={handleCancelFeedback}
                            className="px-3 py-2 rounded-lg text-sm text-content-tertiary hover:text-content-primary transition-colors cursor-pointer"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={handleSendFeedback}
                            disabled={draft.trim().length === 0}
                            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                                draft.trim().length > 0
                                    ? 'bg-accent-primary/15 border border-accent-primary/40 text-accent-primary hover:bg-accent-primary/25 cursor-pointer'
                                    : 'bg-surface-tertiary/30 border border-stroke-subtle/50 text-content-tertiary cursor-not-allowed'
                            }`}
                        >
                            Send
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
```

- [ ] **Step 3: Verify the change**

Run: `npm run lint`
Expected: PASS. (No consumers yet — Task 10 wires it in.)

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add components/chat/PlanCard.tsx
git commit -m "feat(chat): add PlanCard component with locked + feedback states"
```

---

## Task 10: Render `PlanCard` in `Message.tsx`; suppress synthetic 'Approved' bubbles

**Files:**
- Modify: `components/chat/Message.tsx`

Two changes: (1) conditionally render `<PlanCard>` next to the existing `<ChipCard>` rendering; (2) suppress the user-bubble render when the user message is a synthetic `'Approved'` with `planAnswer.action === 'approve'`.

- [ ] **Step 1: Re-read `components/chat/Message.tsx` for the ChipCard render block (lines 245-257) and props shape**

Confirm: `ChipCard` is imported at line 11 and rendered conditionally at line 245. The component receives `message` plus callback props.

- [ ] **Step 2: Identify the props the parent passes to `Message`**

Open `components/chat/Message.tsx` and find the props interface (around line 20-35). It includes `onClarificationAnswer`. We'll add `onPlanApprove` and `onPlanFeedback`.

Look for the existing props interface body. Add two new props:

```ts
onClarificationAnswer?: (payload: {
    questionMessageId: string;
    chosenIndex: number | null;
    text: string;
}) => void;
// ADD THESE:
onPlanApprove?: (planMessageId: string) => void;
onPlanFeedback?: (planMessageId: string, feedbackText: string) => void;
```

Note: the exact shape of the existing props interface in Message.tsx may differ slightly from the snippet above — adapt to what's already there. The two new optional callbacks are the only structural change.

- [ ] **Step 3: Add the `PlanCard` import**

At the top of `Message.tsx`, alongside the existing `import { ChipCard } from './ChipCard';`, add:

```ts
import { PlanCard } from './PlanCard';
```

- [ ] **Step 4: Render `<PlanCard>` next to `<ChipCard>`**

Locate the existing ChipCard render block:

```tsx
{message.type === 'assistant' && message.clarification && (
    <ChipCard
        options={message.clarification.options}
        answer={message.clarificationAnswer}
        onAnswer={(payload) =>
            onClarificationAnswer?.({
                questionMessageId: message.id,
                chosenIndex: payload.chosenIndex,
                text: payload.text,
            })
        }
    />
)}
```

Directly after this block, add:

```tsx
{message.type === 'assistant' && message.plan && (
    <PlanCard
        plan={{
            title: message.plan.title,
            summary: message.plan.summary,
            arrows: message.plan.arrows,
            models: message.plan.models,
            detail: message.plan.detail,
        }}
        status={
            message.planApproveError
                ? 'approve-failed'
                : message.planAnswer?.action === 'approve'
                    ? 'approved'
                    : message.planAnswer?.action === 'feedback'
                        ? 'feedback-given'
                        : 'pending'
        }
        feedbackText={
            message.planAnswer?.action === 'feedback'
                ? message.planAnswer.feedbackText
                : undefined
        }
        approveError={message.planApproveError}
        onApprove={() => onPlanApprove?.(message.id)}
        onFeedback={(text) => onPlanFeedback?.(message.id, text)}
    />
)}
```

- [ ] **Step 5: Suppress synthetic 'Approved' user bubbles**

Find the top of `Message`'s JSX (the outermost `return` statement). Just before the return, add an early-out guard. Specifically: the synthetic approve message has `type === 'user'`, `content === 'Approved'`, and `planAnswer.action === 'approve'`. Render `null` for these.

Locate the start of the component body (after `props` destructuring) and add:

```tsx
// Suppress synthetic 'Approved' user bubbles (created by the approve
// path on the chat-stream route). The locked plan card already shows
// "Approved & built", so a literal 'Approved' bubble below would be
// redundant noise. The DB row stays for reload-state derivation.
if (
    message.type === 'user' &&
    message.content === 'Approved' &&
    message.planAnswer?.action === 'approve'
) {
    return null;
}
```

Place this guard immediately before the existing `return (...)` JSX.

Note: the user message is the user's own row, NOT the assistant plan message. The assistant's `planAnswer` lives on the assistant message (set by Task 8's optimistic update). For the user-side suppression, we need to also set `planAnswer.action === 'approve'` on the user message. Update Task 8 retroactively? No — simpler: in the route handler (Task 13), we persist `metadata.plan_answer` on the user insert, and on reload that field becomes `Message.planAnswer`. So this guard works on reload. For optimistic in-flight: the synthetic 'Approved' user message is added by `handleSend` in Task 8, but Task 8 doesn't currently set `planAnswer` on the user message. We need a small addition.

Add to Task 8's Step 4 the line: when `resolvedPlanAnswer.action === 'approve'`, ALSO update the just-added `userMsgId` user message with the `planAnswer` so the suppression guard fires immediately:

We'll handle that here by editing `useChatMessages` directly since we need to verify that this guard fires before the first render. Open `lib/hooks/use-chat-messages.ts` again, find the optimistic-update block from Task 8 step 4, and extend it:

```ts
if (resolvedPlanAnswer) {
    useAppStore.getState().updateMessage(resolvedPlanAnswer.planMessageId, {
        planAnswer: {
            action: resolvedPlanAnswer.action,
            feedbackText: resolvedPlanAnswer.action === 'feedback' ? resolvedPlanAnswer.feedbackText : undefined,
        },
        planApproveError: undefined,
    });
    // Mirror planAnswer onto the synthetic user message so the
    // 'Approved' bubble is suppressed by Message.tsx's render guard.
    if (resolvedPlanAnswer.action === 'approve') {
        useAppStore.getState().updateMessage(userMsgId, {
            planAnswer: { action: 'approve' },
        });
    }
}
```

(This update lives in `useChatMessages.ts` — a one-line addition to the optimistic block. Make this edit now alongside the Message.tsx changes; it's a tightly coupled pair.)

- [ ] **Step 6: Verify the changes**

Run: `npm run lint`
Expected: PASS.

Run: `npm run build`
Expected: PASS.

- [ ] **Step 7: Manual smoke (UI render only — server changes come in Task 11+)**

Start: `npm run dev`

In a session, send a complex create request like "build a workflow that takes my photo, puts me in a cyberpunk Tokyo street, and adds color grading". The model should call `propose_plan` (rules from Task 5 + example from Task 6). Verify the PlanCard renders with title/summary/arrows/models/detail-toggle/buttons. Don't click Approve yet — the server-side approve handler doesn't exist until Task 11. Clicking Approve at this stage would round-trip with no special server handling and produce undefined behavior; leave that test for Task 14.

Verify visually: the card layout matches the spec mockup, the detail toggle expands/collapses, the feedback textarea expands/collapses, the buttons render correctly, no console errors.

If the model doesn't call `propose_plan` for the cyberpunk request, that's a prompt-quality issue (Task 5's rules) — iterate on the few-shot in Task 6 if needed. Acceptable for v1: try a different complex prompt that hits the threshold.

- [ ] **Step 8: Commit**

```bash
git add components/chat/Message.tsx lib/hooks/use-chat-messages.ts
git commit -m "feat(chat): render PlanCard in Message; suppress synthetic Approved bubbles"
```

---

## Task 11: Add approve-branch handler in `route.ts` (idempotency, dispatchTool, persist, emit)

**Files:**
- Modify: `app/api/chat/stream/route.ts`

The biggest server-side change. New `handlePlanApprove` function that bypasses the brain entirely.

- [ ] **Step 1: Re-read `app/api/chat/stream/route.ts`**

Confirm the structure: `handleWithNewBrain` parses body, resolves plan/model, builds chatWindow + turns, and pipes the stream from `runBrain`.

- [ ] **Step 2: Add `planAnswer` parsing alongside `clarificationAnswer`**

Find the existing `clarificationAnswer` parse block (around line 30-39). Directly after it, add:

```ts
const planAnswer: { planMessageId: string; action: 'approve' | 'feedback'; feedbackText?: string } | undefined =
    body?.planAnswer && typeof body.planAnswer === 'object'
        ? {
              planMessageId: String(body.planAnswer.planMessageId ?? ''),
              action:
                  body.planAnswer.action === 'approve' || body.planAnswer.action === 'feedback'
                      ? body.planAnswer.action
                      : 'feedback',
              feedbackText:
                  typeof body.planAnswer.feedbackText === 'string' ? body.planAnswer.feedbackText : undefined,
          }
        : undefined;
```

- [ ] **Step 3: Insert the approve-branch dispatch**

After the existing constants are parsed but BEFORE the rest of `handleWithNewBrain` (i.e., before the `const supabase = createServiceClient();` call OR right after, depending on what `handlePlanApprove` needs — it needs `supabase`, so place AFTER):

```ts
const supabase = createServiceClient();

// Approve-branch: short-circuit before ALL the brain plumbing. Skips
// runBrain entirely; applies the stored blueprint via dispatchTool;
// persists; emits tool + usage(zero) + done.
if (planAnswer?.action === 'approve' && planAnswer.planMessageId.length > 0 && sessionId) {
    return await handlePlanApprove({
        supabase,
        sessionId,
        planAnswer,
        userMessageId,
        lastUserContent:
            messages?.length > 0 ? String(messages[messages.length - 1]?.content ?? 'Approved') : 'Approved',
    });
}
```

- [ ] **Step 4: Add the `handlePlanApprove` helper function**

Define the helper above `handleWithNewBrain` (or below — wherever it reads cleanly). Using the existing `StreamEncoder` and `dispatchTool` patterns:

```ts
import { dispatchTool, type ToolHandlerState } from '@/lib/chat/tools/handlers';
import { getRegistryContext } from '@/lib/chat/registry-cache';
import { StreamEncoder } from '@/lib/chat';
// (these may already be imported at top — keep imports consolidated)

async function handlePlanApprove(opts: {
    supabase: ReturnType<typeof createServiceClient>;
    sessionId: string;
    planAnswer: { planMessageId: string; action: 'approve' | 'feedback'; feedbackText?: string };
    userMessageId?: string;
    lastUserContent: string;
}): Promise<Response> {
    const { supabase, sessionId, planAnswer, userMessageId, lastUserContent } = opts;
    const t0 = Date.now();

    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            const encoder = new StreamEncoder(controller);

            waitUntil((async () => {
                try {
                    // 1. Read the assistant plan row.
                    const { data: planRow, error: planErr } = await supabase
                        .from('messages')
                        .select('id, session_id, metadata')
                        .eq('id', planAnswer.planMessageId)
                        .single();
                    if (planErr || !planRow) {
                        encoder.send({
                            type: 'error',
                            message: 'Plan not found, please retry the request.',
                            recoverable: false,
                        });
                        encoder.send({ type: 'done' });
                        encoder.close();
                        return;
                    }
                    if (planRow.session_id !== sessionId) {
                        encoder.send({
                            type: 'error',
                            message: 'Plan does not belong to this session.',
                            recoverable: false,
                        });
                        encoder.send({ type: 'done' });
                        encoder.close();
                        return;
                    }

                    const blueprint = planRow.metadata?.plan?.blueprint;
                    if (!blueprint) {
                        encoder.send({
                            type: 'error',
                            message: 'Plan has no blueprint to apply.',
                            recoverable: false,
                        });
                        encoder.send({ type: 'done' });
                        encoder.close();
                        return;
                    }

                    // 2. Idempotency check: was this plan already approved?
                    const { data: priorApprovalRows } = await supabase
                        .from('messages')
                        .select('id, metadata')
                        .eq('session_id', sessionId)
                        .eq('role', 'user');
                    const alreadyApproved = (priorApprovalRows || []).some(
                        (r: any) =>
                            r?.metadata?.plan_answer?.planMessageId === planAnswer.planMessageId &&
                            r?.metadata?.plan_answer?.action === 'approve'
                    );
                    if (alreadyApproved) {
                        // Plan was already applied; client is showing approved state already.
                        encoder.send({ type: 'done' });
                        encoder.close();
                        return;
                    }

                    // 3. Load current canvas_state.
                    const { data: sessionRow } = await supabase
                        .from('sessions')
                        .select('canvas_state')
                        .eq('id', sessionId)
                        .single();
                    const baseWorkflow =
                        sessionRow?.canvas_state &&
                        Array.isArray(sessionRow.canvas_state.nodes) &&
                        Array.isArray(sessionRow.canvas_state.edges)
                            ? sessionRow.canvas_state
                            : { nodes: [], edges: [] };

                    // 4. Build aiModelHandles from a fresh registry lookup.
                    const registry = await getRegistryContext(supabase);
                    const aiModelHandles = new Map<number, string[]>();
                    for (const m of registry.models) {
                        const schema = (m as any).inputs_schema;
                        if (!schema || !Array.isArray(schema.handles)) continue;
                        const ids: string[] = [];
                        for (const h of schema.handles) {
                            const key = h?.api_mapping_key;
                            if (typeof key === 'string' && key.length > 0) ids.push(key);
                        }
                        if (ids.length > 0) aiModelHandles.set(m.id, ids);
                    }

                    const state: ToolHandlerState = {
                        workflow: baseWorkflow as any,
                        idMap: new Map(),
                        aiModelHandles,
                    };

                    // 5. Apply via dispatchTool('add_node', blueprint).
                    const result = dispatchTool(state, 'add_node', blueprint);
                    if (!result.success) {
                        encoder.send({
                            type: 'error',
                            message: result.error || 'Plan apply failed.',
                            recoverable: true,
                        });
                        encoder.send({ type: 'done' });
                        encoder.close();
                        return;
                    }

                    // 6. Persist user message + canvas_state.
                    const dbOps: Promise<any>[] = [];
                    dbOps.push(
                        Promise.resolve(supabase.from('messages').insert({
                            ...(userMessageId ? { id: userMessageId } : {}),
                            session_id: sessionId,
                            role: 'user',
                            content: lastUserContent || 'Approved',
                            status: 'completed',
                            metadata: {
                                plan_answer: {
                                    planMessageId: planAnswer.planMessageId,
                                    action: 'approve',
                                },
                            },
                            created_at: new Date().toISOString(),
                        }) as any)
                    );
                    if (result.patch) {
                        dbOps.push(
                            Promise.resolve(supabase.from('sessions').update({
                                canvas_state: { nodes: state.workflow.nodes, edges: state.workflow.edges },
                                updated_at: new Date().toISOString(),
                            }).eq('id', sessionId) as any)
                        );
                    }
                    await Promise.all(dbOps);

                    // 7. Emit tool + usage(zero) + done.
                    if (result.patch) {
                        encoder.send({ type: 'tool', name: 'add_node', patch: result.patch });
                    }
                    encoder.send({
                        type: 'usage',
                        inputTokens: 0,
                        outputTokens: 0,
                        thinkingTokens: 0,
                        costUsd: 0,
                    });
                    encoder.send({ type: 'done' });
                    encoder.close();

                    console.log('[chat] plan_approve', {
                        sessionId,
                        planMessageId: planAnswer.planMessageId,
                        blueprintNodeCount: Array.isArray(blueprint?.nodes) ? blueprint.nodes.length : 0,
                        latencyMs: Date.now() - t0,
                        status: 'ok',
                    });
                } catch (err: any) {
                    encoder.send({
                        type: 'error',
                        message: err?.message || 'plan_approve failed unexpectedly',
                        recoverable: false,
                    });
                    encoder.send({ type: 'done' });
                    encoder.close();
                    console.error('[chat] plan_approve error', err);
                }
            })());
        },
    });

    return new Response(stream, {
        headers: {
            'Content-Type': 'application/x-ndjson; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
        },
    });
}
```

- [ ] **Step 5: Verify the change**

Run: `npm run lint`
Expected: PASS.

Run: `npm run build`
Expected: PASS — the new function compiles with all types resolved.

- [ ] **Step 6: Commit**

```bash
git add app/api/chat/stream/route.ts
git commit -m "feat(chat): add approve-branch handler in chat stream route"
```

---

## Task 12: Filter synthetic 'Approved' user messages from the chat window

**Files:**
- Modify: `app/api/chat/stream/route.ts`

The synthetic `'Approved'` user messages persisted by Task 11 must NOT be sent to Anthropic on subsequent feedback or normal turns — they would create back-to-back user roles.

- [ ] **Step 1: Locate the chatWindow build**

Find this block in `handleWithNewBrain`:

```ts
const chatWindow = (messages || [])
    .filter((m: any) => m.content && m.content.trim().length > 0)
    .slice(-8);
```

- [ ] **Step 2: Add the synthetic-approve filter**

Replace the chatWindow build with:

```ts
const chatWindow = (messages || [])
    .filter((m: any) => m.content && m.content.trim().length > 0)
    // Filter out synthetic 'Approved' user messages — they're DB-only
    // markers for plan-card state derivation on reload. Sending them to
    // Anthropic would put two user roles back-to-back (the prior
    // 'Approved' plus the next real user message), which the API
    // rejects. Real user feedback messages are NOT filtered — they
    // carry meaningful content the model needs to see.
    .filter(
        (m: any) =>
            !(
                (m.role === 'user' || m.type === 'user') &&
                m.content === 'Approved' &&
                m.metadata?.plan_answer?.action === 'approve'
            ) &&
            // Same exclusion when the message arrives from the client store
            // shape (planAnswer rather than metadata.plan_answer).
            !(
                (m.role === 'user' || m.type === 'user') &&
                m.content === 'Approved' &&
                m.planAnswer?.action === 'approve'
            )
    )
    .slice(-8);
```

The double filter handles both shapes: messages coming from a fresh in-memory store (planAnswer at top level) and messages reloaded from DB (metadata.plan_answer).

- [ ] **Step 3: Verify the change**

Run: `npm run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add app/api/chat/stream/route.ts
git commit -m "feat(chat): filter synthetic Approved user messages from chat window"
```

---

## Task 13: Persist `metadata.plan` and `metadata.plan_answer` in `route.ts`

**Files:**
- Modify: `app/api/chat/stream/route.ts`

For the FEEDBACK path (the approve path's persistence is in Task 11). The route already persists assistant `metadata.clarification` on insert; we add `metadata.plan` next to it. Same for the user message — `metadata.plan_answer` for feedback turns.

- [ ] **Step 1: Locate the assistant insert (around lines 148-164)**

Find the existing insert:

```ts
if (result.finalText) {
    dbOps.push(
        Promise.resolve(supabase.from('messages').insert({
            ...(assistantMessageId ? { id: assistantMessageId } : {}),
            session_id: sessionId,
            role: 'assistant',
            content: result.finalText,
            metadata: {
                thinking: result.finalThinking || null,
                usage: result.usage || null,
                clarification: result.clarification || null,
            },
            status: 'completed',
            created_at: new Date(Date.now() + 1000).toISOString()
        }) as any)
    );
}
```

- [ ] **Step 2: Add `plan` to the assistant metadata**

Update the insert's metadata block:

```ts
metadata: {
    thinking: result.finalThinking || null,
    usage: result.usage || null,
    clarification: result.clarification || null,
    plan: result.plan || null,
},
```

- [ ] **Step 3: Add `plan_answer` to the user insert for feedback turns**

Find the user insert above (around lines 130-146):

```ts
if (lastUserMsg.role === 'user' || lastUserMsg.type === 'user') {
    const userMetadata =
        clarificationAnswer && clarificationAnswer.questionMessageId.length > 0
            ? { clarification_answer: clarificationAnswer }
            : null;
    dbOps.push(
        Promise.resolve(supabase.from('messages').insert({ ... metadata: userMetadata ... }))
    );
}
```

Replace the `userMetadata` build to also handle `planAnswer`:

```ts
if (lastUserMsg.role === 'user' || lastUserMsg.type === 'user') {
    const userMetadata: Record<string, any> = {};
    if (clarificationAnswer && clarificationAnswer.questionMessageId.length > 0) {
        userMetadata.clarification_answer = clarificationAnswer;
    }
    if (planAnswer && planAnswer.action === 'feedback' && planAnswer.planMessageId.length > 0) {
        userMetadata.plan_answer = {
            planMessageId: planAnswer.planMessageId,
            action: 'feedback',
            feedbackText: planAnswer.feedbackText,
        };
    }
    dbOps.push(
        Promise.resolve(supabase.from('messages').insert({
            ...(userMessageId ? { id: userMessageId } : {}),
            session_id: sessionId,
            role: 'user',
            content: lastUserMsg.content,
            status: 'completed',
            metadata: Object.keys(userMetadata).length > 0 ? userMetadata : null,
            created_at: new Date().toISOString()
        }) as any)
    );
}
```

(Note: approve-path persistence is fully handled inside `handlePlanApprove` in Task 11. This section handles only the feedback path; if `planAnswer.action === 'approve'`, control never reaches this code because the approve branch returned earlier.)

- [ ] **Step 4: Update the persist gate**

Currently the persist block runs only when `result.hadAnyOutput || result.clarification`:

```ts
if (sessionId && (result.hadAnyOutput || result.clarification) && messages?.length > 0) {
```

Update it to also persist when `result.plan` was emitted:

```ts
if (sessionId && (result.hadAnyOutput || result.clarification || result.plan) && messages?.length > 0) {
```

- [ ] **Step 5: Verify the change**

Run: `npm run lint`
Expected: PASS.

Run: `npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/chat/stream/route.ts
git commit -m "feat(chat): persist metadata.plan + metadata.plan_answer in route"
```

---

## Task 14: End-to-end manual smoke test pass

**Files:** none (verification only — runs against `npm run dev`).

Walks through every item in the spec's Section 5 manual test checklist. Each step is a discrete check; failures should be triaged inline (often a one-line fix in the relevant module) before proceeding.

- [ ] **Step 1: Start the dev server and confirm a baseline**

Run: `npm run dev`

Open the app at `http://localhost:3000`. Create a new session. Send a trivial message ("hi") and confirm a normal assistant reply renders without any plan card. (Validates that nothing in B-2 regresses the baseline turn.)

- [ ] **Step 2: Test 1 — Complex create → plan appears, Approve builds the workflow**

Send: "Build a workflow that takes my photo, puts me on a beach, and adds golden-hour lighting"

Verify:
- A plan card renders inline with title/summary/arrows/models.
- Click ▸ Detailed plan → detail prose appears.
- Click [Approve & Build] → card transitions to "✓ Approved & built" state. Canvas populates with the planned nodes. No "Approved" user bubble appears below the card.

If the model called `add_node` directly without proposing a plan, that's a prompt-quality miss. Iterate the few-shot example in `lib/chat/prompt/examples.ts` (Task 6) — make the trigger condition more concrete.

- [ ] **Step 3: Test 2 — Simple update → no plan**

Send: "Change Imagen to Flux" (in a session that has an existing workflow).

Verify: no plan card, the model calls `update_node` directly, the canvas updates instantly.

- [ ] **Step 4: Test 3 — Plan after clarification**

Send an ambiguous request that triggers `ask_clarification` (e.g., "make my photo more cinematic and dramatic"). Pick a chip. Then send a follow-up that's complex enough to trigger a plan (e.g., "now add an entire post-processing pipeline with grain, color grade, and a depth-of-field pass").

Verify: clarification card → answered → plan card appears next turn.

- [ ] **Step 5: Test 4 — Feedback round-trip**

In a fresh session, trigger a plan (use the cyberpunk Tokyo prompt from Task 6's example). Click [Provide feedback] → type "Use Imagen 4 not Flux" → Send.

Verify:
- First plan card locks to "↻ Revising — see new plan below" with the feedback text shown.
- A NEW plan card renders below with revised content (Imagen 4 in models, summary mentions the change).
- Clicking Approve on the new card builds the workflow with Imagen 4.

- [ ] **Step 6: Test 5 — Main-input feedback fallback**

In a fresh session, trigger a plan. Don't click [Provide feedback]; instead type "make it more dramatic" in the main chat input and send.

Verify: first card locks to feedback-given showing the typed text; new plan emits with the revision.

- [ ] **Step 7: Test 6 — Detail expand**

In any of the above states (pending, approved, feedback-given), click ▸ Detailed plan and verify expansion. Click again → collapses. Works in all states.

- [ ] **Step 8: Test 7 — Reload mid-pending**

Trigger a plan but don't approve. Refresh the page. Verify the card re-renders fully functional. Approve still works.

- [ ] **Step 9: Test 8 — Reload after approve**

Trigger and approve a plan. Refresh. Verify the card renders locked approved; canvas reflects the build.

- [ ] **Step 10: Test 9 — Reload after feedback chain**

Plan → feedback → new plan → feedback → new plan. Refresh. Verify all three cards render with the right states (feedback-given, feedback-given, pending).

- [ ] **Step 11: Test 10 — Revert to a plan**

Use the existing chat-revert UI to revert to a plan message. Verify card flips back to pending. Canvas is unchanged (revert is chat-history-only per existing behavior).

- [ ] **Step 12: Test 11 — Approve-time validation fail (force a corrupt blueprint)**

Hardest test to drive deterministically. One way: temporarily edit a node row in `ai_models` to delete a model that the proposed plan uses, then click Approve. The approve route's `dispatchTool` should fail validation; card should flip to "✗ Approve failed" with an inline error message; canvas unchanged.

Alternative: open Supabase studio, manually edit the assistant message's `metadata.plan.blueprint` to put `model_id: 99999` on the ai_generator node. Then click Approve.

Skip if hard to set up — the error path is well-typed and the optimistic-revert logic in Task 8 step 7 covers it.

- [ ] **Step 13: Test 12 — Stop button during plan turn**

Trigger a complex create. Mid-stream, before the `plan` event lands, click Stop. Verify no card. Try again, let the `plan` event land, then click Stop. Verify card renders pending; Approve still works.

- [ ] **Step 14: Test 13 — Multilingual**

Send the cyberpunk request in Hebrew or Spanish. Verify plan content (title/summary/arrows/models/detail) is in the user's language; UI button labels stay in English.

- [ ] **Step 15: Test 14 — Two-tab realtime**

Open the same session in two tabs. Trigger a plan in tab A. Click Approve in tab A. Verify tab B's PlanCard transitions to approved and canvas updates within the realtime debounce window.

- [ ] **Step 16: Test 15 — Suppressed approve user bubble**

After clicking Approve, scroll the chat. Confirm there is no "Approved" user bubble visible below the plan card.

- [ ] **Step 17: Test 16 — Double-click idempotency**

Trigger a plan. Click [Approve & Build] twice in quick succession (within 200ms — easier with a network throttle in DevTools). Verify the workflow is built once, NOT duplicated. Inspect the canvas node count — it should match the blueprint's node count exactly.

- [ ] **Step 18: Test 17 — Approve-then-next-message turn alternation**

Approve a plan. Then send a follow-up message ("now make it black-and-white"). Verify the model responds correctly. Specifically: the request must NOT 400 from Anthropic (back-to-back user roles). If it 400s, Task 12's filter is broken — debug there.

- [ ] **Step 19: Final sanity — type-check and build**

Run: `npm run lint && npm run build`
Expected: PASS. No type errors; production build succeeds.

- [ ] **Step 20: Commit (no functional changes; just a marker for completion)**

If any tests above required inline fixes, commit those as small dedicated commits along the way. If the smoke pass found no issues, no commit is needed for this task.

---

## Self-review

### Spec coverage check

- ✅ `propose_plan` tool with all six fields → Task 2.
- ✅ Shared `nodesEdgesSchema` → Task 2 step 2-3.
- ✅ `validateBlueprint` dry-run helper → Task 3.
- ✅ Brain emits `plan` event, first-valid-wins → Task 4.
- ✅ `BrainResult.plan` extension → Task 4.
- ✅ `plan` StreamEvent + `PlanPayload` type → Task 1.
- ✅ Approve-branch route handler with idempotency → Task 11.
- ✅ Feedback-path metadata persistence → Task 13.
- ✅ Synthetic 'Approved' user-message filter on chatWindow → Task 12.
- ✅ Prompt: PLAN PROPOSAL subsection + CAPABILITIES line + CRITICAL_RULES rule 7 → Task 5.
- ✅ Few-shot example (plan + revision) → Task 6.
- ✅ Message store `plan` + `planAnswer` + `planApproveError` → Task 7.
- ✅ `processStreamLine` plan branch → Task 8.
- ✅ `planAnswer` sidecar in request body → Task 8.
- ✅ Optimistic approve transition + error revert → Task 8 step 7 + Task 10 step 5.
- ✅ PlanCard component (pending/approved/feedback-given/approve-failed) → Task 9.
- ✅ Conditional `<PlanCard>` render in Message + 'Approved' bubble suppression → Task 10.
- ✅ Manual test checklist → Task 14.

No gaps.

### Type consistency check

- `Message.plan` shape (Task 7) matches `PlanPayload` (Task 1).
- `PlanCardProps.plan` (Task 9) is a subset of `Message.plan` — no `blueprint` field, since the card never renders the blueprint.
- `planAnswer.action` is exactly `'approve' | 'feedback'` everywhere (Task 7, Task 8, Task 11, Task 12, Task 13).
- `dispatchTool` receives `'add_node'` literally in `handlePlanApprove` (Task 11), not `'propose_plan'` — the propose_plan no-op case in handlers.ts (Task 4 step 8) only catches misroutes from the brain.
- `handlePlanApprove` and `handlePlanFeedback` exposed from `useChatMessages` (Task 8 step 8) match the props added to `Message.tsx` (Task 10 step 2).

### Placeholder scan

No "TBD"/"TODO" left. All steps have concrete code blocks. The `scripts/test-validate-blueprint.js` is intentionally a shape check (acknowledged as such); no behavioral test runner is available in this repo.

---

## Plan complete.

Plan saved to `docs/superpowers/plans/2026-05-08-plan-and-approve.md`.

**Two execution options:**

**1. Subagent-Driven (recommended)** — Dispatch a fresh subagent per task, review between tasks, fast iteration. Best when you want me to drive each task independently and you review the work between tasks.

**2. Inline Execution** — Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints. Best when you want continuous progress with periodic review.

Which approach?
