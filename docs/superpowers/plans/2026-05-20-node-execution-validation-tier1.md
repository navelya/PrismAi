# Node Execution Validation — Tier 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add pre-flight wiring validation that catches missing required inputs, no-upstream-data on solo/chain runs, and type-mismatch edges — surfaced via per-node badges on the canvas and a hover popover on the Run Workflow button, plus server-side enforcement.

**Architecture:** A single pure validator (`lib/workflow/validate-execution.ts`) is imported by both a reactive client hook (`lib/hooks/use-execution-validation.ts`) and the server start route. The client surfaces errors as a red badge on every offending node (in `BaseNode.tsx`) and a count + hover-popover on the Run Workflow button (in `EditorToolbar.tsx`); clicking a popover entry smooth-pans the canvas to that node. `commitExecution` short-circuits when errors > 0. `/api/executions/start` calls the same validator before any DB write and returns `400 { error: 'VALIDATION_FAILED', errors: [...] }` if non-empty.

**Tech Stack:** TypeScript, Next.js 14 App Router, React + React Flow, Zustand, Supabase (server-side only — no schema changes). No new dependencies.

**Note on testing:** This codebase has no test runner — `npm run lint` and `npm run build` are unreliable here (per project memory). Verification is done via:
- `npx tsc --noEmit` after every code change (must pass with zero new errors).
- Tiny ad-hoc Node scripts in `scripts/` that exercise the pure validator with hand-built workflows.
- Manual canvas testing for the UI pieces — explicit scenarios listed in the final task.

---

## File Structure

### New files

| Path | Responsibility |
|---|---|
| `lib/workflow/validate-execution.ts` | Pure validator. Takes workflow + runMode + targetNodeId + completedNodeIds, returns `ValidationError[]`. No I/O, no store reads, no React. |
| `lib/workflow/validate-execution-messages.ts` | Maps `ValidationError` to human-readable string. Single source of truth for error wording. |
| `lib/hooks/use-execution-validation.ts` | React hook that reads workflow + ui + execution slices, derives `completedNodeIds`, calls the validator, returns `{ errors, errorsByNode }`. Memoized. |
| `scripts/validate-execution-smoke.mjs` | Ad-hoc verification — builds 4–5 hand-crafted workflows and asserts the validator emits the expected error kinds. Run with `node scripts/validate-execution-smoke.mjs` after the validator is in place. |

### Modified files

| Path | Change |
|---|---|
| `lib/nodes/core/canvas/BaseNode.tsx` | Add red-exclamation badge in the node corner when the validation hook reports errors for this node id; tooltip lists messages. |
| `components/editor/EditorToolbar.tsx` | Add red count badge on the Run Workflow button + hover popover listing errors; clicking an entry pans + selects the offending node. |
| `components/editor/SharedWorkflowEditor.tsx` | In `commitExecution`, short-circuit when errors > 0; show toast for non-solo runs. Also handle the server's 400 `VALIDATION_FAILED` response. |
| `app/api/executions/start/route.ts` | After the target set + preseedInputs are built (around line 244), call the validator. If errors, return 400 before the execution record is created. |
| `lib/store/slices/workflow-slice.ts` | Add `selectNodeAndCenter(nodeId: string): void` action — sets `selectedNodes` to `[nodeId]` and stores a one-shot `pendingCenterNodeId` field. `EditorCanvas` already has React Flow's `useReactFlow` in scope (or `SharedWorkflowEditor` does); it watches `pendingCenterNodeId` and calls `setCenter` with a 500ms duration, then clears the pending field. |

---

## Task 1: Pure validator + message formatter

**Files:**
- Create: `lib/workflow/validate-execution.ts`
- Create: `lib/workflow/validate-execution-messages.ts`

- [ ] **Step 1.1: Create the validator file**

```ts
// lib/workflow/validate-execution.ts
import type { Workflow, WorkflowNode, WorkflowEdge, AiModel } from '@/lib/nodes/types';
import type { NodeSharedDef, NodeDataType } from '@/lib/nodes/core/types';
import { typesAreCompatible } from '@/lib/editor/handle-compatibility';

export type ValidationError =
    | {
          kind: 'missing-required-input';
          nodeId: string;
          nodeLabel: string;
          inputId: string;
          inputLabel: string;
      }
    | {
          kind: 'no-upstream-data';
          nodeId: string;
          nodeLabel: string;
          inputId: string;
          inputLabel: string;
          sourceNodeId: string;
          sourceNodeLabel: string;
      }
    | {
          kind: 'type-mismatch';
          nodeId: string;
          nodeLabel: string;
          inputId: string;
          inputLabel: string;
          sourceNodeId: string;
          sourceHandleId: string;
          expectedType: string;
          actualType: string;
      };

type ResolvedInput = {
    id: string;
    label: string;
    expectedType: NodeDataType | NodeDataType[];
    isMandatory: boolean;
};

type ResolvedOutput = {
    id: string;
    dataType: NodeDataType | NodeDataType[];
};

export type ValidationContext = {
    workflow: Workflow;
    runMode: 'all' | 'solo' | 'chain';
    targetNodeId: string | null;
    /** Node ids that have a usable cached completed result (for solo/chain runs). */
    completedNodeIds: Set<string>;
    sharedRegistry: Record<string, NodeSharedDef<any>>;
    /** Used to resolve the dynamic ai_generator handles. */
    models: AiModel[];
};

export function validateExecution(ctx: ValidationContext): ValidationError[] {
    const { workflow, runMode, targetNodeId, completedNodeIds, sharedRegistry, models } = ctx;
    const errors: ValidationError[] = [];

    const executing = computeExecutingNodes(workflow, runMode, targetNodeId);
    const executingIds = new Set(executing.map((n) => n.id));
    const nodeById = new Map(workflow.nodes.map((n) => [n.id, n]));

    for (const node of executing) {
        if (node.type === 'group_container') continue;

        const inputs = resolveNodeInputs(node, sharedRegistry, models);
        const incomingEdges = workflow.edges.filter((e) => e.target === node.id);

        for (const input of inputs) {
            const edge = findEdgeForInput(node, input, incomingEdges);

            if (!edge) {
                if (input.isMandatory) {
                    errors.push({
                        kind: 'missing-required-input',
                        nodeId: node.id,
                        nodeLabel: nodeLabelOf(node),
                        inputId: input.id,
                        inputLabel: input.label,
                    });
                }
                continue;
            }

            const sourceNode = nodeById.get(edge.source);
            if (!sourceNode) continue; // dangling edge — graph corruption, skip

            const sourceOutput = resolveSourceOutput(sourceNode, edge.sourceHandle, sharedRegistry, models);
            if (sourceOutput && !typesAreCompatible(sourceOutput.dataType as any, input.expectedType as any)) {
                errors.push({
                    kind: 'type-mismatch',
                    nodeId: node.id,
                    nodeLabel: nodeLabelOf(node),
                    inputId: input.id,
                    inputLabel: input.label,
                    sourceNodeId: sourceNode.id,
                    sourceHandleId: edge.sourceHandle ?? '',
                    expectedType: typeToString(input.expectedType),
                    actualType: typeToString(sourceOutput.dataType),
                });
            }

            if (!executingIds.has(sourceNode.id) && !completedNodeIds.has(sourceNode.id)) {
                errors.push({
                    kind: 'no-upstream-data',
                    nodeId: node.id,
                    nodeLabel: nodeLabelOf(node),
                    inputId: input.id,
                    inputLabel: input.label,
                    sourceNodeId: sourceNode.id,
                    sourceNodeLabel: nodeLabelOf(sourceNode),
                });
            }
        }
    }

    return errors;
}

function computeExecutingNodes(
    workflow: Workflow,
    runMode: 'all' | 'solo' | 'chain',
    targetNodeId: string | null,
): WorkflowNode[] {
    if (runMode === 'all') {
        return workflow.nodes.filter((n) => n.type !== 'group_container');
    }
    if (!targetNodeId) return [];
    const target = workflow.nodes.find((n) => n.id === targetNodeId);
    if (!target) return [];
    if (runMode === 'solo') return [target];

    // chain — BFS forward from target through edges
    const adj = new Map<string, string[]>();
    for (const e of workflow.edges) {
        if (!adj.has(e.source)) adj.set(e.source, []);
        adj.get(e.source)!.push(e.target);
    }
    const seen = new Set<string>([targetNodeId]);
    const queue = [targetNodeId];
    while (queue.length) {
        const id = queue.shift()!;
        for (const child of adj.get(id) ?? []) {
            if (seen.has(child)) continue;
            seen.add(child);
            queue.push(child);
        }
    }
    return workflow.nodes.filter((n) => seen.has(n.id) && n.type !== 'group_container');
}

function resolveNodeInputs(
    node: WorkflowNode,
    sharedRegistry: Record<string, NodeSharedDef<any>>,
    models: AiModel[],
): ResolvedInput[] {
    if (node.type === 'ai_generator') {
        const modelId = (node.data as any)?.config?.model_id ?? (node.data as any)?.model_id;
        const model = modelId ? models.find((m) => m.id === Number(modelId)) : null;
        if (!model) return [];
        return (model.inputs_schema?.handles ?? [])
            .filter((h) => h.is_visible !== false)
            .map((h) => ({
                id: h.api_mapping_key || h.name,
                label: h.name,
                expectedType: h.type as NodeDataType,
                isMandatory: !!h.is_mandatory,
            }));
    }

    const def = sharedRegistry[node.type];
    if (!def) return [];
    return (def.handles?.inputs ?? []).map((h: any) => ({
        id: h.id,
        label: h.label,
        expectedType: h.expectedType,
        isMandatory: !!h.isMandatory,
    }));
}

function resolveSourceOutput(
    node: WorkflowNode,
    sourceHandle: string | null | undefined,
    sharedRegistry: Record<string, NodeSharedDef<any>>,
    models: AiModel[],
): ResolvedOutput | null {
    if (node.type === 'ai_generator') {
        const modelId = (node.data as any)?.config?.model_id ?? (node.data as any)?.model_id;
        const model = modelId ? models.find((m) => m.id === Number(modelId)) : null;
        const handles = model?.outputs_schema?.handles ?? [];
        const visible = handles.filter((h) => h.is_visible !== false);
        const match =
            visible.find((h) => (h.api_mapping_key || h.name || 'output') === sourceHandle) ?? visible[0];
        if (!match) return null;
        return { id: match.api_mapping_key || match.name || 'output', dataType: match.type as NodeDataType };
    }

    const def = sharedRegistry[node.type];
    if (!def) return null;
    const outputs = def.handles?.outputs ?? [];
    const match = (outputs as any[]).find((o) => o.id === sourceHandle) ?? outputs[0];
    if (!match) return null;
    return { id: match.id, dataType: match.dataType };
}

function findEdgeForInput(
    node: WorkflowNode,
    input: ResolvedInput,
    incomingEdges: WorkflowEdge[],
): WorkflowEdge | null {
    // Compositor's layer edges all target `layers` (or no targetHandle). The
    // per-layer sourceHandleId references the edge id, so we look up by that.
    if (node.type === 'compositor' && input.id === 'layers') {
        const layers: any[] = (node.data as any)?.config?.layers ?? [];
        const layerEdgeIds = new Set(layers.map((l) => l?.sourceHandleId).filter(Boolean));
        const layerEdges = incomingEdges.filter(
            (e) => (e.targetHandle === 'layers' || !e.targetHandle) && layerEdgeIds.has(e.id),
        );
        // For compositor we treat it as a single input slot — if ANY layer edge
        // exists return the first; per-layer validation is out of scope here.
        return layerEdges[0] ?? null;
    }

    return (
        incomingEdges.find((e) => (e.targetHandle ?? '') === input.id) ??
        incomingEdges.find((e) => !e.targetHandle && input.id === defaultInputIdForNodeType(node.type)) ??
        null
    );
}

function defaultInputIdForNodeType(nodeType: string): string | null {
    // Mirrors the existing "no targetHandle means the only / canonical input"
    // convention used by handle-compatibility.ts (blur → 'image', compositor → 'layers').
    if (nodeType === 'blur') return 'image';
    if (nodeType === 'compositor') return 'layers';
    return null;
}

function nodeLabelOf(node: WorkflowNode): string {
    const label = (node.data as any)?.label;
    return typeof label === 'string' && label.length > 0 ? label : node.type;
}

function typeToString(t: NodeDataType | NodeDataType[] | string | string[]): string {
    if (Array.isArray(t)) return t.join(' | ');
    return String(t);
}
```

- [ ] **Step 1.2: Create the message formatter**

```ts
// lib/workflow/validate-execution-messages.ts
import type { ValidationError } from './validate-execution';

export function formatValidationError(e: ValidationError): string {
    switch (e.kind) {
        case 'missing-required-input':
            return `Input '${e.inputLabel}' is required`;
        case 'no-upstream-data':
            return `Input '${e.inputLabel}' needs ${e.sourceNodeLabel} to run first`;
        case 'type-mismatch':
            return `Input '${e.inputLabel}' expects ${e.expectedType}, got ${e.actualType}`;
    }
}
```

- [ ] **Step 1.3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: zero new errors (existing errors, if any, are unchanged).

- [ ] **Step 1.4: Write a smoke script**

Create `scripts/validate-execution-smoke.mjs`:

```js
// scripts/validate-execution-smoke.mjs
// Hand-crafted workflows that exercise each ValidationError kind.
// Run: node scripts/validate-execution-smoke.mjs
//
// Why this lives in scripts/: the repo has no test runner, but the validator
// is pure TS — we transpile on the fly via tsx so this stays a one-liner.
//
// Requires: npx tsx (already a transient dep of Next.js' toolchain — if
// missing, run `npm i -D tsx` or call with `node --experimental-loader ts-node/esm`).
import { execSync } from 'node:child_process';
execSync('npx tsx scripts/validate-execution-smoke.ts', { stdio: 'inherit' });
```

Create `scripts/validate-execution-smoke.ts`:

```ts
// scripts/validate-execution-smoke.ts
import { validateExecution } from '../lib/workflow/validate-execution';
import { sharedRegistry } from '../lib/nodes/core/shared-registry';

function assert(cond: any, msg: string) {
    if (!cond) {
        console.error('FAIL:', msg);
        process.exit(1);
    }
    console.log('PASS:', msg);
}

const baseModels: any[] = [];

// 1) missing-required-input: AI generator with required image input, no edge
{
    const wf = {
        name: 'mri',
        nodes: [
            {
                id: 'gen1',
                type: 'ai_generator',
                position: { x: 0, y: 0 },
                data: { label: 'Gen', config: { model_id: 1 } },
            },
        ],
        edges: [],
    } as any;
    const models = [
        {
            id: 1,
            inputs_schema: {
                handles: [
                    { api_mapping_key: 'image', name: 'image', type: 'image', is_mandatory: true, is_visible: true, is_array: false },
                ],
            },
            outputs_schema: { handles: [{ api_mapping_key: 'output', name: 'output', type: 'image', is_visible: true, is_array: false }] },
        },
    ];
    const errs = validateExecution({
        workflow: wf, runMode: 'all', targetNodeId: null,
        completedNodeIds: new Set(), sharedRegistry, models: models as any,
    });
    assert(errs.length === 1 && errs[0].kind === 'missing-required-input', 'missing-required-input case');
}

// 2) no-upstream-data: solo run on Blur, upstream MediaInput never executed
{
    const wf = {
        name: 'nud',
        nodes: [
            { id: 'm1', type: 'media_input', position: { x: 0, y: 0 }, data: { label: 'Media' } },
            { id: 'b1', type: 'blur', position: { x: 200, y: 0 }, data: { label: 'Blur' } },
        ],
        edges: [{ id: 'e1', source: 'm1', target: 'b1', sourceHandle: 'output', targetHandle: 'image' }],
    } as any;
    const errs = validateExecution({
        workflow: wf, runMode: 'solo', targetNodeId: 'b1',
        completedNodeIds: new Set(), sharedRegistry, models: baseModels as any,
    });
    assert(errs.some((e) => e.kind === 'no-upstream-data'), 'no-upstream-data case');
}

// 3) no-upstream-data does NOT fire for runMode=all (everything will run)
{
    const wf = {
        name: 'all',
        nodes: [
            { id: 'm1', type: 'media_input', position: { x: 0, y: 0 }, data: { label: 'Media' } },
            { id: 'b1', type: 'blur', position: { x: 200, y: 0 }, data: { label: 'Blur' } },
        ],
        edges: [{ id: 'e1', source: 'm1', target: 'b1', sourceHandle: 'output', targetHandle: 'image' }],
    } as any;
    const errs = validateExecution({
        workflow: wf, runMode: 'all', targetNodeId: null,
        completedNodeIds: new Set(), sharedRegistry, models: baseModels as any,
    });
    assert(errs.every((e) => e.kind !== 'no-upstream-data'), 'no-upstream-data not fired for runMode=all');
}

// 4) type-mismatch: text → image
{
    const wf = {
        name: 'tm',
        nodes: [
            { id: 'p1', type: 'prompt', position: { x: 0, y: 0 }, data: { label: 'Prompt', config: { text: 'hi' } } },
            { id: 'b1', type: 'blur', position: { x: 200, y: 0 }, data: { label: 'Blur' } },
        ],
        edges: [{ id: 'e1', source: 'p1', target: 'b1', sourceHandle: 'text_out', targetHandle: 'image' }],
    } as any;
    const errs = validateExecution({
        workflow: wf, runMode: 'all', targetNodeId: null,
        completedNodeIds: new Set(), sharedRegistry, models: baseModels as any,
    });
    assert(errs.some((e) => e.kind === 'type-mismatch'), 'type-mismatch case');
}

console.log('\nAll smoke cases passed.');
```

- [ ] **Step 1.5: Run the smoke script**

Run: `node scripts/validate-execution-smoke.mjs`
Expected output ends with `All smoke cases passed.`

If any case fails, fix the validator before continuing — every later task depends on it being correct.

- [ ] **Step 1.6: Commit**

```bash
git add lib/workflow/validate-execution.ts lib/workflow/validate-execution-messages.ts scripts/validate-execution-smoke.mjs scripts/validate-execution-smoke.ts
git commit -m "$(cat <<'EOF'
feat(workflow): pure pre-flight validator + smoke script

Detects missing-required-input, no-upstream-data, and type-mismatch on a
workflow scoped by runMode. Used by the upcoming client hook and server start
route. Smoke script exercises the four core cases.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Reactive client hook

**Files:**
- Create: `lib/hooks/use-execution-validation.ts`

- [ ] **Step 2.1: Inspect existing store slices for the data shape**

Run: `npx tsc --noEmit` (sanity check before touching anything) and open:
- `lib/store/slices/ui-slice.ts` — exports `runFromNodeId`, `runMode`.
- `lib/store/slices/execution-slice.ts` — exports `nodeStatuses` (map id → `NodeStatus`) and the node-output map.
- `lib/store/slices/workflow-slice.ts` — exports `currentWorkflow`, `nodeOutputs`.
- `lib/store/app-store.ts` — root `useAppStore`.

You're not modifying these — just confirming the property names used in the hook below match. If any name differs (e.g. `nodeOutputs` lives somewhere else), update the property reads in step 2.2.

- [ ] **Step 2.2: Create the hook**

```ts
// lib/hooks/use-execution-validation.ts
import { useMemo } from 'react';
import { useAppStore } from '@/lib/store/app-store';
import { sharedRegistry } from '@/lib/nodes/core/shared-registry';
import { validateExecution, type ValidationError } from '@/lib/workflow/validate-execution';

export function useExecutionValidation(): {
    errors: ValidationError[];
    errorsByNode: Record<string, ValidationError[]>;
} {
    const workflow = useAppStore((s) => s.currentWorkflow);
    const runFromNodeId = useAppStore((s) => s.runFromNodeId);
    const runMode = useAppStore((s) => s.runMode);
    const nodeStatuses = useAppStore((s) => s.nodeStatuses);
    const nodeOutputs = useAppStore((s) => s.nodeOutputs);
    const models = useAppStore((s) => s.models);

    // A node is "complete with usable data" if status is 'success' AND
    // we have a non-null cached output for it. We accept either the live
    // nodeOutputs map OR a persisted `data.output` on the workflow node —
    // both are produced by the same execution path.
    const completedNodeIds = useMemo(() => {
        const ids = new Set<string>();
        if (!workflow) return ids;
        for (const n of workflow.nodes) {
            const status = nodeStatuses[n.id];
            const liveOut = nodeOutputs?.[n.id];
            const persistedOut = (n.data as any)?.output;
            if ((status === 'success' || liveOut != null || persistedOut != null) && (liveOut != null || persistedOut != null)) {
                ids.add(n.id);
            }
        }
        return ids;
    }, [workflow, nodeStatuses, nodeOutputs]);

    // Decide which runMode to validate against. When the user has set a
    // runFromNodeId we mirror the Run Workflow vs Solo distinction the editor
    // makes: if runFromNodeId is null we'd be running 'all'; otherwise the
    // explicit runMode applies.
    const effectiveMode: 'all' | 'solo' | 'chain' = runFromNodeId ? (runMode as any) : 'all';
    const targetNodeId = runFromNodeId ?? null;

    const errors = useMemo(() => {
        if (!workflow) return [] as ValidationError[];
        return validateExecution({
            workflow,
            runMode: effectiveMode,
            targetNodeId,
            completedNodeIds,
            sharedRegistry,
            models: (models as any) ?? [],
        });
    }, [workflow, effectiveMode, targetNodeId, completedNodeIds, models]);

    const errorsByNode = useMemo(() => {
        const map: Record<string, ValidationError[]> = {};
        for (const e of errors) {
            (map[e.nodeId] ||= []).push(e);
        }
        return map;
    }, [errors]);

    return { errors, errorsByNode };
}
```

- [ ] **Step 2.3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: zero new errors. If a property name is wrong (`nodeOutputs`, `models`, etc.), fix it now — the actual property names take precedence over what's written above.

- [ ] **Step 2.4: Commit**

```bash
git add lib/hooks/use-execution-validation.ts
git commit -m "$(cat <<'EOF'
feat(workflow): reactive useExecutionValidation hook

Subscribes to workflow + ui + execution slices, derives completedNodeIds,
returns ValidationError[] and errorsByNode keyed by node id.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Per-node error badge in BaseNode

**Files:**
- Modify: `lib/nodes/core/canvas/BaseNode.tsx`

- [ ] **Step 3.1: Add imports + hook call**

Inside `BaseNode.tsx`, add to the existing imports at the top:

```ts
import { AlertCircle } from 'lucide-react';
import { useExecutionValidation } from '@/lib/hooks/use-execution-validation';
import { formatValidationError } from '@/lib/workflow/validate-execution-messages';
```

Inside the `BaseNode` component body, near the other store hooks, add:

```ts
const { errorsByNode } = useExecutionValidation();
const validationErrors = errorsByNode[id] ?? [];
```

- [ ] **Step 3.2: Render the badge**

Inside the node's main visual container — alongside the existing `badgeCount` chip and status indicator (look for where `<NodeHeader>` is rendered or where the status circle lives) — add the badge. The exact JSX depends on the existing layout; the snippet below is the pattern, wire it into wherever per-node corner indicators currently render:

```tsx
{validationErrors.length > 0 && (
    <Tooltip
        position="top"
        content={
            <div className="flex flex-col gap-0.5 text-left">
                {validationErrors.map((e, i) => (
                    <span key={i}>{formatValidationError(e)}</span>
                ))}
            </div>
        }
    >
        <div
            className="absolute -top-1.5 -right-1.5 z-20 flex items-center justify-center w-5 h-5 rounded-full bg-accent-error border-2 border-surface-elevated shadow-md"
            aria-label={`${validationErrors.length} validation error(s)`}
        >
            <AlertCircle className="w-3 h-3 text-white" strokeWidth={2.5} />
        </div>
    </Tooltip>
)}
```

`accent-error` already exists in the design tokens (used by the Stop button on the toolbar). `surface-elevated` is the canvas card background, also already in use.

- [ ] **Step 3.3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: zero new errors.

- [ ] **Step 3.4: Manual canvas check**

`npm run dev`, open the editor, create a workflow with one Blur node whose `image` input has no edge. Confirm the red badge appears in the corner of the Blur node and hovering shows `Input 'Media' is required` (or similar — depends on the actual handle label).

Delete the badge by connecting a Media Input to it; the badge should disappear without a page reload (the hook is reactive).

- [ ] **Step 3.5: Commit**

```bash
git add lib/nodes/core/canvas/BaseNode.tsx
git commit -m "$(cat <<'EOF'
feat(canvas): per-node validation badge in BaseNode

Red exclamation badge with tooltip listing pre-flight validation errors for
this node, driven by useExecutionValidation. Reactive — appears/disappears as
the user edits.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: workflow-slice `selectNodeAndCenter` action + EditorCanvas wiring

Selection in this codebase is React Flow's own state (each node has a `selected: boolean`), not a store field. The Run-button popover needs to call something from outside the React Flow provider, so we add a one-shot `pendingCenterNodeId` field to the store; `EditorCanvas` (already inside the provider) watches it, calls React Flow's `setCenter` to smooth-pan, and uses `setNodes` to mark that one node `selected` (so the existing selection outline highlights it).

**Files:**
- Modify: `lib/store/slices/workflow-slice.ts`
- Modify: `lib/store/types.ts` (to add the new slice field/action to the typed interface)
- Modify: `components/editor/EditorCanvas.tsx`

- [ ] **Step 4.1: Confirm the slice + action signatures**

Open `lib/store/slices/workflow-slice.ts` and look at one existing action (any `setX` will do) to confirm the zustand `set(...)` style in use (vanilla `set({...})` vs immer's `set(state => { state.x = y })`). Mirror that style in Step 4.2.

- [ ] **Step 4.2: Add the pending-center field and action**

In `lib/store/types.ts`, add to the workflow slice interface (somewhere near the other workflow-slice fields):

```ts
pendingCenterNodeId: string | null;
selectNodeAndCenter: (nodeId: string) => void;
clearPendingCenterNodeId: () => void;
```

In `lib/store/slices/workflow-slice.ts`, in the initial-state block add:

```ts
pendingCenterNodeId: null,
```

And add the actions (rewrite to immer style if the file uses immer — mirror an existing action exactly):

```ts
selectNodeAndCenter: (nodeId: string) => {
    set({ pendingCenterNodeId: nodeId });
},
clearPendingCenterNodeId: () => {
    set({ pendingCenterNodeId: null });
},
```

Note: this action does NOT touch any `selectedNodes` field, because selection lives entirely in React Flow state. The selection update happens in `EditorCanvas` in Step 4.3.

- [ ] **Step 4.3: Wire EditorCanvas to react to it**

In `components/editor/EditorCanvas.tsx`, find the existing `useReactFlow()` usage (search for `reactFlowInstance` or `useReactFlow` in the file). Pull `setCenter` and `setNodes` out of it (or off the existing instance):

```ts
const { setCenter, setNodes, getViewport } = useReactFlow();
```

(If `useReactFlow` isn't imported yet on a top line, add `import { useReactFlow } from 'reactflow';` to the existing imports — it's almost certainly already there.)

Add store reads near the other `useAppStore` selectors at the top of the component body:

```ts
const pendingCenterNodeId = useAppStore((s) => s.pendingCenterNodeId);
const clearPendingCenterNodeId = useAppStore((s) => s.clearPendingCenterNodeId);
const currentWorkflowNodes = useAppStore((s) => s.currentWorkflow?.nodes);
```

Then add a `useEffect` (place it alongside other effects, AFTER all other hooks per the rules of hooks — do NOT put it inside a conditional or callback):

```ts
useEffect(() => {
    if (!pendingCenterNodeId) return;
    const node = (currentWorkflowNodes ?? []).find((n) => n.id === pendingCenterNodeId);
    if (!node) {
        clearPendingCenterNodeId();
        return;
    }
    const w = node.width ?? node.measured?.width ?? 200;
    const h = node.height ?? node.measured?.height ?? 100;
    const currentZoom = getViewport().zoom;
    setCenter(node.position.x + w / 2, node.position.y + h / 2, { duration: 500, zoom: currentZoom });
    // Mirror React Flow's own click-to-select behaviour: clear all other
    // selections and select the target. Existing selection outline picks this up.
    setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === pendingCenterNodeId })));
    clearPendingCenterNodeId();
}, [pendingCenterNodeId, currentWorkflowNodes, setCenter, setNodes, getViewport, clearPendingCenterNodeId]);
```

`getViewport().zoom` preserves the user's current zoom — we only pan, we don't reset zoom.

- [ ] **Step 4.4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: zero new errors.

- [ ] **Step 4.5: Commit**

```bash
git add lib/store/slices/workflow-slice.ts lib/store/types.ts components/editor/EditorCanvas.tsx
git commit -m "$(cat <<'EOF'
feat(editor): selectNodeAndCenter action + EditorCanvas smooth-pan handler

Adds a one-shot pendingCenterNodeId field to the workflow slice; EditorCanvas
watches it, calls React Flow setCenter with a 500ms duration and selects the
target node, then clears the pending field. Used by the upcoming Run-button
error popover.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Run-Workflow button count badge + hover popover

**Files:**
- Modify: `components/editor/EditorToolbar.tsx`

- [ ] **Step 5.1: Add imports + hook call**

Near the top of `EditorToolbar.tsx`:

```ts
import { AlertCircle } from 'lucide-react';
import { useExecutionValidation } from '@/lib/hooks/use-execution-validation';
import { formatValidationError } from '@/lib/workflow/validate-execution-messages';
```

Inside the component body, near the other store reads:

```ts
const { errors: validationErrors } = useExecutionValidation();
const selectNodeAndCenter = useAppStore((s) => s.selectNodeAndCenter);
const [showErrorPopover, setShowErrorPopover] = useState(false);
```

- [ ] **Step 5.2: Replace the Run-button block with a wrapper that hosts the badge + popover**

The existing Run button (the `<button onClick={onRun}>` block when `!isRunning`) gets wrapped in a `<div className="relative">` and a count badge + popover are mounted as siblings. Full replacement for the `!isRunning` branch:

```tsx
<div
    className="relative"
    onMouseEnter={() => validationErrors.length > 0 && setShowErrorPopover(true)}
    onMouseLeave={() => setShowErrorPopover(false)}
>
    <button
        onClick={onRun}
        className="h-8 px-3 bg-accent-primary hover:bg-accent-primary/90 text-white rounded-lg flex items-center gap-1.5 font-bold uppercase tracking-wider text-[11px] shadow-md shadow-accent-primary/20 active:scale-95 transition-colors"
    >
        <Play className="w-3 h-3 fill-current" />
        Run workflow
    </button>

    {validationErrors.length > 0 && (
        <div
            className="absolute -top-1.5 -right-1.5 z-20 flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-accent-error text-white text-[10px] font-bold border-2 border-surface-elevated shadow-md tabular-nums"
            aria-label={`${validationErrors.length} validation errors`}
        >
            {validationErrors.length}
        </div>
    )}

    {showErrorPopover && validationErrors.length > 0 && (
        <div className="absolute top-full right-0 mt-2 w-80 max-h-96 overflow-y-auto bg-surface-elevated/95 backdrop-blur-md border border-stroke-subtle rounded-xl shadow-xl shadow-black/20 z-30 p-2">
            <div className="px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider text-content-tertiary">
                Can't run — {validationErrors.length} issue{validationErrors.length === 1 ? '' : 's'}
            </div>
            <div className="flex flex-col gap-0.5">
                {validationErrors.map((e, i) => (
                    <button
                        key={i}
                        onClick={() => {
                            selectNodeAndCenter(e.nodeId);
                            setShowErrorPopover(false);
                        }}
                        className="text-left px-2 py-1.5 rounded-md hover:bg-white/5 transition-colors flex items-start gap-2"
                    >
                        <AlertCircle className="w-3.5 h-3.5 mt-0.5 text-accent-error flex-shrink-0" />
                        <div className="min-w-0 flex-1">
                            <div className="text-xs font-semibold text-content-primary truncate">{e.nodeLabel}</div>
                            <div className="text-[11px] text-content-secondary">{formatValidationError(e)}</div>
                        </div>
                    </button>
                ))}
            </div>
        </div>
    )}
</div>
```

The Stop branch (`isRunning === true`) is unchanged.

- [ ] **Step 5.3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: zero new errors.

- [ ] **Step 5.4: Manual check**

`npm run dev`, build a workflow with two issues (e.g. AI generator with no model selected leading to no required inputs, plus a Blur with no Media Input edge). Confirm:
- The Run Workflow button shows a red "2" badge in the corner.
- Hovering opens the popover; both rows visible with node label + message.
- Clicking a row smooth-pans the canvas to that node and highlights it.
- The popover closes on click.

- [ ] **Step 5.5: Commit**

```bash
git add components/editor/EditorToolbar.tsx
git commit -m "$(cat <<'EOF'
feat(editor): Run Workflow button shows validation error count + popover

Red count badge appears when useExecutionValidation has errors. Hovering opens
a list of errors with node label + human message; clicking jumps to and
highlights the offending node via selectNodeAndCenter.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Block commitExecution + handle server 400

**Files:**
- Modify: `components/editor/SharedWorkflowEditor.tsx`

- [ ] **Step 6.1: Locate the existing toast mechanism**

Use Grep: `Toast` and `showToast` across `components/`. Most likely the file imports a toast utility already — if not, find how `executionError` is rendered (look for an existing toast or banner in `SharedWorkflowEditor.tsx` rendering). The block-toast does NOT need a new toast component — it can either:
- Reuse the existing `executionError` state to render an inline banner (preferred — no new UI).
- Or call whatever toast utility is already imported.

Pick the existing pattern. If neither exists and the editor has no quick toast, set `setExecutionError(message)` and let the existing error UI display it for a few seconds (find the timeout in the file).

- [ ] **Step 6.2: Insert the validation gate at the top of commitExecution**

In `commitExecution` (around line 283), add this BEFORE `activeRunCountRef.current += 1`:

```ts
// Pre-flight validation. Reads the same hook output by pulling fresh from
// the store via useAppStore.getState() — we can't call the hook here, but
// the validator is pure, so we re-run it with current state.
{
    const state = useAppStore.getState();
    const wf = state.currentWorkflow;
    if (wf) {
        const completedNodeIds = new Set<string>();
        for (const n of wf.nodes) {
            const status = state.nodeStatuses[n.id];
            const liveOut = state.nodeOutputs?.[n.id];
            const persistedOut = (n.data as any)?.output;
            if ((status === 'success' || liveOut != null || persistedOut != null) && (liveOut != null || persistedOut != null)) {
                completedNodeIds.add(n.id);
            }
        }
        const errors = validateExecution({
            workflow: wf,
            runMode: mode as any,
            targetNodeId,
            completedNodeIds,
            sharedRegistry,
            models: (state.models as any) ?? [],
        });
        if (errors.length > 0) {
            if (mode !== 'solo') {
                setExecutionError(`Can't run — ${errors.length} issue${errors.length === 1 ? '' : 's'}. Hover the Run Workflow button to see them.`);
            }
            // Solo: the per-node badge on the single offending node is already
            // loud enough; no toast.
            return;
        }
    }
}
```

Add imports at the top of the file:

```ts
import { validateExecution } from '@/lib/workflow/validate-execution';
import { formatValidationError } from '@/lib/workflow/validate-execution-messages';
import { sharedRegistry } from '@/lib/nodes/core/shared-registry';
```

- [ ] **Step 6.3: Handle the server 400 response**

In the existing `catch (err: any)` block (around line 374), the current code just sets `executionError` from `err.message`. Replace that branch with one that checks for `VALIDATION_FAILED`:

In the `try { ... }` block, replace:

```ts
if (!res.ok) {
    const data = await res.json();
    throw new Error(data.error || 'Execution request failed');
}
```

with:

```ts
if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    if (data?.error === 'VALIDATION_FAILED' && Array.isArray(data.errors)) {
        const msgs = (data.errors as any[])
            .slice(0, 3)
            .map((e) => formatValidationError(e))
            .join('; ');
        const more = data.errors.length > 3 ? `; +${data.errors.length - 3} more` : '';
        throw new Error(`Validation failed — ${msgs}${more}`);
    }
    throw new Error(data?.error || 'Execution request failed');
}
```

- [ ] **Step 6.4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: zero new errors.

- [ ] **Step 6.5: Manual check**

In dev mode, click Run Workflow on a graph with at least one validation error. The execution must NOT start — `commitExecution` returns early before any POST. The `executionError` (or whatever banner) should display the "hover the Run button" nudge for non-solo runs.

Click Run (solo button on a node with errors) — no banner appears, but the per-node badge is already visible.

- [ ] **Step 6.6: Commit**

```bash
git add components/editor/SharedWorkflowEditor.tsx
git commit -m "$(cat <<'EOF'
feat(editor): block commitExecution on pre-flight validation errors

Adds a validateExecution gate at the top of commitExecution; non-solo runs
also set executionError so the user sees a nudge toward the Run-button
popover. Also handles server-side VALIDATION_FAILED responses by formatting
the returned errors back through the same messages.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Server-side enforcement in start route

**Files:**
- Modify: `app/api/executions/start/route.ts`

- [ ] **Step 7.1: Add imports**

Near the top of the file with the other imports:

```ts
import { validateExecution } from '@/lib/workflow/validate-execution';
import { sharedRegistry } from '@/lib/nodes/core/shared-registry';
```

- [ ] **Step 7.2: Insert the validation block**

After the `console.log` at line 244 (`[Execution/Start] Target Set: ...`) and BEFORE the `STEP 4: Create an immutable execution record in the DB.` block at line ~247, add:

```ts
// ─────────────────────────────────────────────────────────────────────────
// Pre-flight wiring validation (defense in depth — client should already
// have caught these and shown the user a per-node badge / popover).
// Done after the target set + preseedInputs are built so we can use them
// as the source of "completed upstream" truth, and BEFORE the executions
// row is created so a rejected POST writes nothing to the DB and burns
// no credits.
// ─────────────────────────────────────────────────────────────────────────
{
    // Models needed for ai_generator dynamic handles. Pull only the ids we
    // see referenced as ai_generator nodes in the target set.
    const aiGenModelIds = nodesToExecute
        .filter((n: any) => n.type === 'ai_generator')
        .map((n: any) => Number((n.data?.config?.model_id) ?? (n.data?.model_id)))
        .filter((id: number) => Number.isFinite(id));
    let modelsForValidation: any[] = [];
    if (aiGenModelIds.length > 0) {
        const { data: modelRows } = await supabase
            .from('ai_models')
            .select('id, inputs_schema, outputs_schema')
            .in('id', aiGenModelIds);
        modelsForValidation = modelRows ?? [];
    }

    const completedNodeIds = new Set<string>(preseedInputs.keys());
    const errors = validateExecution({
        workflow: { name: '', nodes: nodesToExecute as any, edges: edgesToInclude as any },
        runMode: (mode as any) ?? 'all',
        targetNodeId: targetNodeId ?? null,
        completedNodeIds,
        sharedRegistry,
        models: modelsForValidation as any,
    });
    if (errors.length > 0) {
        console.warn(`[Execution/Start] Validation failed (${errors.length} error(s)) — rejecting before DB write.`);
        return NextResponse.json(
            { error: 'VALIDATION_FAILED', errors },
            { status: 400 }
        );
    }
}
```

Notes:
- The variable names `nodesToExecute`, `edgesToInclude`, `preseedInputs`, `mode`, `targetNodeId`, `supabase` are already in scope at line 244 — confirm via Read of the file.
- `sharedRegistry` is safe to import server-side (it's shared-bundle, no `sharp`).

- [ ] **Step 7.3: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: zero new errors.

- [ ] **Step 7.4: Manual check via the smoke path**

Easiest: temporarily break the client gate (comment out the early `return` in `commitExecution`'s validation block), then click Run on a graph with errors. Server should return 400 with `VALIDATION_FAILED`; the catch handler from Task 6 should surface the formatted errors. Un-comment the early return when done.

Or with curl:
```bash
curl -X POST http://localhost:3000/api/executions/start \
  -H "Content-Type: application/json" \
  --cookie "<your auth cookie>" \
  -d '{"session_id":"...","user_id":"...","workflow":{"nodes":[{"id":"b1","type":"blur","position":{"x":0,"y":0},"data":{"label":"Blur","config":{}}}],"edges":[]},"mode":"all"}'
```
Expected: HTTP 400, body contains `{"error":"VALIDATION_FAILED","errors":[{"kind":"missing-required-input",...}]}`.

- [ ] **Step 7.5: Commit**

```bash
git add app/api/executions/start/route.ts
git commit -m "$(cat <<'EOF'
feat(api): pre-flight wiring validation in /api/executions/start

Returns 400 VALIDATION_FAILED with the typed error list before any DB write
or credit debit if missing-required-input / no-upstream-data / type-mismatch
is detected. Defense in depth against a client that skipped its own gate.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: End-to-end manual verification

**Files:** None (manual testing only).

- [ ] **Step 8.1: Full type-check sweep**

Run: `npx tsc --noEmit`
Expected: zero errors anywhere in the project (or at least, zero new errors compared to a fresh checkout of `main`).

- [ ] **Step 8.2: Smoke script re-run**

Run: `node scripts/validate-execution-smoke.mjs`
Expected: `All smoke cases passed.`

- [ ] **Step 8.3: Manual canvas scenarios**

Start the dev server (`npm run dev`) and walk through each scenario:

**Scenario A — missing required input, workflow run:**
1. New workflow. Drop one AI Generator. Don't select a model.
2. (If your AI Generator definition emits required handles even without a model, skip ahead. If not, select a model that has a required `image` input but don't wire anything to it.)
3. Run Workflow button shows red "1" badge. AI Generator has red badge in corner.
4. Hover Run button → popover shows one entry. Click it → canvas pans to the AI Generator.
5. Click Run Workflow anyway → execution does NOT start. Inline banner says "Can't run — 1 issue. Hover the Run Workflow button to see them."

**Scenario B — no upstream data, solo run:**
1. New workflow. Media Input + Blur, wired. Don't run anything.
2. Solo-run the Blur (whatever UI triggers that — right-click "Run only this node" or similar).
3. Blur node shows red badge with tooltip "Input 'Media' needs Media Input to run first" (or matching label).
4. Solo-run is blocked; no inline banner (per design).

**Scenario C — type mismatch:**
1. The editor's wire-drop UI already prevents incompatible connections, so to exercise this you'll need to hand-craft a saved workflow JSON with a `text → image` edge OR temporarily bypass the connection validator.
2. Quickest: edit the workflow JSON via a `scripts/` file or the Supabase SQL editor to insert an edge from a Prompt node's `text_out` to a Blur node's `image` input.
3. Reload the editor. Blur node shows red badge with "Input 'Media' expects image | video, got text".

**Scenario D — clears reactively:**
1. With any scenario above active and badges visible, fix the issue by wiring the missing input / removing the bad edge.
2. Badges and Run-button counter disappear without a page reload.

**Scenario E — server-side enforcement:**
1. Already done in Task 7.4. Re-run only if Task 6's client gate was changed since.

- [ ] **Step 8.4: Commit the plan completion (no code change — this is just a marker)**

Skip if there's nothing to commit. Otherwise, if you tweaked anything during manual testing, commit those fixes individually with descriptive messages — don't bundle them.

---

## Non-goals (DO NOT IMPLEMENT)

Per the spec, this plan covers Tier 1 only. The following are explicitly out of scope:

- **Tier 2** — required config field checks (empty Prompt text, AI Generator with no model selected, Compositor with zero layers, Media Input with no asset). The validator's `resolveNodeInputs` will return `[]` for an AI Generator without a model — that's correct; it falls through to Tier 2 territory which is deferred.
- **Tier 3** — cycle detection, broken-chain / disconnected-target. The codebase already has `wouldCreateCycle` at wire-drop time; pre-flight cycle detection is not added here.
- **Live "as-you-edit" *blocking*** — the badges appear reactively, but we are NOT adding edit-time dialogs or wire rejection beyond what the editor already does.
- **Per-layer validation on the compositor** — for Tier 1 we treat the `layers` input as a single slot. Individual layer-level missing-asset checks come in Tier 2.
- **New toast component** — reuse the existing `executionError` banner or whatever toast utility is already in use; don't add a new dependency or design primitive.

---

## Verification checklist (run at end)

- [ ] `npx tsc --noEmit` — zero new errors.
- [ ] `node scripts/validate-execution-smoke.mjs` — all assertions pass.
- [ ] Scenario A passes manually.
- [ ] Scenario B passes manually.
- [ ] Scenario C passes manually.
- [ ] Scenario D passes manually.
- [ ] Scenario E passes manually.
- [ ] No new files outside the list in **File Structure**.
- [ ] No schema migrations.
- [ ] No new npm dependencies (the smoke script uses `tsx` which is already transitively present, or fall back to plain JS).
