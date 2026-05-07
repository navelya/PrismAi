# Chat Brain Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** [`docs/superpowers/specs/2026-05-07-chat-brain-rework-design.md`](../specs/2026-05-07-chat-brain-rework-design.md)

**Goal:** Replace the Gemini-backed chat with an Anthropic Claude Sonnet 4.6 implementation, modularize the chat brain under `lib/chat/*`, fix real image vision (today the model never sees attached images), add a `ThinkingPanel`, and split the 1,436-line `ChatInterface.tsx` — all behind a `CHAT_USE_NEW_BRAIN` env flag with the existing Gemini path as fallback during rollout.

**Architecture:** Three layers — UI (`components/chat/*`) → API edge (`app/api/chat/stream/route.ts`, ~80 lines after refactor) → Brain (`lib/chat/*` containing `prompt/`, `provider/`, `tools/`, `streaming/`). Raw `@anthropic-ai/sdk` replaces `@ai-sdk/google`. NDJSON streaming protocol extended with `thinking_start` / `thinking_delta` / `thinking_end`, `usage`, and `done` events. Image vision via Anthropic content blocks. Thinking persisted in `messages.metadata.thinking`.

**Tech Stack:** Next.js 15 (Edge runtime), React 19, TypeScript, Supabase (service role for server inserts), `@anthropic-ai/sdk` (new), `zod` (existing), `zustand` (existing). No test runner per `CLAUDE.md` — verification is `npx tsc --noEmit` for type checks plus manual smoke tests against `npm run dev`.

**Conventions used in this plan:**
- Verification commands assume the repo root: `C:\Projects\Prisfol\PrismAi`.
- Type check command everywhere: `npx tsc --noEmit`. Use this after every code-writing step where it makes sense.
- The dev server (`npm run dev`) needs to be running for any browser smoke test.
- Commits are made on a feature branch — see Task 0.

---

## Task 0: Branch + dependency setup

**Files:**
- Modify: `package.json`
- Modify: `.env.local` (not in git; document keys you add)
- Modify: `CLAUDE.md` (env section)

- [ ] **Step 1: Create the feature branch**

```bash
git checkout -b feat/chat-brain-rework
git status
```

Expected: clean tree on `feat/chat-brain-rework` (any unstaged work like local `ChatInterface.tsx` edits stays unstaged for now — Task 19 handles them).

- [ ] **Step 2: Install Anthropic SDK**

```bash
npm install @anthropic-ai/sdk
```

Expected: `@anthropic-ai/sdk` appears in `package.json` `dependencies`, lockfile updated. Edge-compatible builds ship from this package by default — no `/edge` import path needed.

- [ ] **Step 3: Add `ANTHROPIC_API_KEY` to `.env.local`**

Add to `.env.local`:
```
ANTHROPIC_API_KEY=sk-ant-...
CHAT_USE_NEW_BRAIN=false
```

The flag starts at `false` so the existing Gemini path keeps serving until we flip it in Task 18.

- [ ] **Step 4: Document the new env vars in `CLAUDE.md`**

In `CLAUDE.md`, find the `Required env` line and replace:

```diff
-Required env (in `.env.local`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `REPLICATE_API_TOKEN`, `REPLICATE_WEBHOOK_SIGNING_SECRET`, `NEXT_PUBLIC_APP_URL` (used as the Replicate webhook base URL — must be publicly reachable), `CRON_SECRET`.
+Required env (in `.env.local`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY` (legacy chat path; removed after Task 26), `ANTHROPIC_API_KEY` (new chat brain), `CHAT_USE_NEW_BRAIN` ("true" to route chat through `lib/chat/*`; defaults to false), `REPLICATE_API_TOKEN`, `REPLICATE_WEBHOOK_SIGNING_SECRET`, `NEXT_PUBLIC_APP_URL` (used as the Replicate webhook base URL — must be publicly reachable), `CRON_SECRET`.
```

- [ ] **Step 5: Verify the build still passes**

```bash
npx tsc --noEmit
```

Expected: no errors. We haven't added any code yet.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json CLAUDE.md
git commit -m "chore: add @anthropic-ai/sdk and CHAT_USE_NEW_BRAIN flag"
```

---

## Task 1: Streaming protocol types

**Files:**
- Create: `lib/chat/streaming/protocol.ts`

- [ ] **Step 1: Write the protocol types**

Create `lib/chat/streaming/protocol.ts`:

```ts
import type { WorkflowPatch } from '@/lib/workflow/workflow-patch';

/**
 * NDJSON stream events emitted by the new chat brain.
 * One JSON object per line, terminated by '\n'.
 *
 * Order guarantee per turn:
 *   [thinking_start] [thinking_delta]* [thinking_end]
 *   [text]*
 *   [tool]*
 *   [usage]
 *   [done]
 */
export type StreamEvent =
  | { type: 'thinking_start' }
  | { type: 'thinking_delta'; text: string }
  | { type: 'thinking_end' }
  | { type: 'text'; text: string }
  | { type: 'tool'; name: 'add_node' | 'update_node' | 'remove_node'; patch: WorkflowPatch }
  | { type: 'usage'; inputTokens: number; outputTokens: number; thinkingTokens: number; costUsd: number }
  | { type: 'error'; message: string; recoverable: boolean }
  | { type: 'done' };

export type StreamEventType = StreamEvent['type'];
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/chat/streaming/protocol.ts
git commit -m "feat(chat): streaming protocol types"
```

---

## Task 2: Streaming encoder

**Files:**
- Create: `lib/chat/streaming/encoder.ts`

- [ ] **Step 1: Write the encoder**

Create `lib/chat/streaming/encoder.ts`:

```ts
import type { StreamEvent } from './protocol';

/**
 * Minimal NDJSON writer for StreamEvent. Wraps a ReadableStream controller
 * and exposes a single `send(event)` method. Tracks client disconnect so
 * callers can stop work early.
 */
export class StreamEncoder {
  private encoder = new TextEncoder();
  private connected = true;

  constructor(private controller: ReadableStreamDefaultController<Uint8Array>) {}

  send(event: StreamEvent): void {
    if (!this.connected) return;
    try {
      this.controller.enqueue(this.encoder.encode(JSON.stringify(event) + '\n'));
    } catch {
      this.connected = false;
    }
  }

  close(): void {
    if (!this.connected) return;
    try {
      this.controller.close();
    } catch {
      // already closed
    }
    this.connected = false;
  }

  disconnect(): void {
    this.connected = false;
  }

  isConnected(): boolean {
    return this.connected;
  }
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/chat/streaming/encoder.ts
git commit -m "feat(chat): NDJSON stream encoder"
```

---

## Task 3: Voice rules constants

**Files:**
- Create: `lib/chat/prompt/voice.ts`

- [ ] **Step 1: Write the voice rules**

Create `lib/chat/prompt/voice.ts`:

```ts
/**
 * Voice & tone rules for Prism. Keep the body short — the system prompt
 * is rebuilt every turn, so every line costs tokens forever.
 *
 * The voice target is "concise senior collaborator":
 *   direct, names tradeoffs out loud, recommends, asks only when
 *   the design actually moves.
 */
export const VOICE_RULES = `VOICE & TONE — concise senior collaborator:
- Open with the answer or the action. Never restate the user's request.
- Do not start replies with "Great question!", "Sure!", "Of course!", "I'd be happy to", or any acknowledgment filler.
- Do not end replies with "Let me know if there's anything else."
- One sentence of reasoning when there's a real tradeoff. Otherwise none.
- End with a single forward question ("Run it?", "Tweak first?"). Not a list of options.
- Match length to the question. Do not pad short answers.
- Use first person naturally ("I'll use Imagen 4..."). Never sound robotic.
- Plain prose. Markdown for emphasis only — no headers, no bullet lists unless genuinely a list.`;
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add lib/chat/prompt/voice.ts
git commit -m "feat(chat): voice/tone rules constant"
```

---

## Task 4: Few-shot examples

**Files:**
- Create: `lib/chat/prompt/examples.ts`

- [ ] **Step 1: Write the examples**

Create `lib/chat/prompt/examples.ts`:

```ts
/**
 * Two short few-shot examples included unconditionally. Total ~150 tokens.
 * Sonnet 4.6 follows tone instructions well without heavy fewshot — keep
 * this minimal. If voice consistency drifts in real traffic, tune here.
 */
export const FEWSHOT_EXAMPLES = `EXAMPLES OF VOICE:

User: make me a workflow that puts a person on a beach
Assistant: Got it. I'll use Imagen 4 for the beach (strong photographic backgrounds), background-removal on your photo, then composite.
[adds 3 nodes via add_node]
Adding 3 nodes — input, generator, compositor — wired left-to-right. Run it now or tweak first?

User: what does the background_remover node do?
Assistant: It runs your input image through a segmentation model and outputs the subject as a transparent PNG. Useful before compositing.`;
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add lib/chat/prompt/examples.ts
git commit -m "feat(chat): few-shot voice examples"
```

---

## Task 5: Workflow context formatter

**Files:**
- Create: `lib/chat/prompt/workflow-context.ts`

- [ ] **Step 1: Write the formatter**

Create `lib/chat/prompt/workflow-context.ts`:

```ts
import type { Workflow } from '@/lib/nodes/types';

/**
 * Formats the current canvas state as a compact text block for the system
 * prompt. We do NOT include the full JSON — that's 10x the tokens for the
 * same information. ~20 lines max even for big graphs.
 */
export function formatWorkflowContext(workflow: Workflow | null | undefined): string {
  if (!workflow || !Array.isArray(workflow.nodes) || workflow.nodes.length === 0) {
    return 'CURRENT CANVAS: empty.';
  }

  const nodes = workflow.nodes;
  const edges = Array.isArray(workflow.edges) ? workflow.edges : [];

  // Build a map of node id -> outgoing edge targets for the "→" arrows.
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) {
    const sourceId = (edge as any).source;
    const targetId = (edge as any).target;
    if (!sourceId || !targetId) continue;
    if (!outgoing.has(sourceId)) outgoing.set(sourceId, []);
    outgoing.get(sourceId)!.push(targetId);
  }

  const lines = nodes.map(n => {
    const id = (n as any).id;
    const type = (n as any).type;
    const label = (n as any).data?.config?.label || (n as any).data?.config?.name || '';
    const labelPart = label ? ` "${label}"` : '';
    const targets = outgoing.get(id) || [];
    const arrowPart = targets.length > 0 ? ` → ${targets.join(', ')}` : '';
    return `- ${type}${labelPart} (id: ${id})${arrowPart}`;
  });

  return `CURRENT CANVAS: ${nodes.length} node${nodes.length === 1 ? '' : 's'}\n${lines.join('\n')}`;
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add lib/chat/prompt/workflow-context.ts
git commit -m "feat(chat): workflow context formatter"
```

---

## Task 6: Registry context formatter

**Files:**
- Create: `lib/chat/prompt/registry-context.ts`
- Read for reference: `app/api/chat/stream/route.ts:19-44` (existing implementation)

- [ ] **Step 1: Write the formatter**

This formats both the static `sharedRegistry` (node types) and the dynamic `ai_models` table (live, fetched per request). Mirrors the existing logic in the route but moved into a module.

Create `lib/chat/prompt/registry-context.ts`:

```ts
import { sharedRegistry } from '@/lib/nodes/core/shared-registry';

export interface RegistryContextInput {
  models: Array<{
    id: number;
    display_name: string;
    node_type_id: string | null;
    providers?: { name: string } | null;
  }>;
  nodeTypes: Array<{
    id: string;
    display_name: string;
  }>;
}

/**
 * Formats the static node registry + live ai_models catalog as text for
 * the system prompt. Output is ~60-80 lines for the current registry.
 *
 * The static registry portion is stable across requests, so callers should
 * mark this slice as cacheable when constructing the Anthropic system
 * content blocks (see provider/anthropic.ts).
 */
export function formatRegistryContext(input: RegistryContextInput): string {
  const nodeDocs: string[] = [];

  for (const [type, def] of Object.entries(sharedRegistry)) {
    const inputs = def.handles?.inputs?.map((h: any) => {
      const t = Array.isArray(h.expectedType) ? h.expectedType.join('|') : h.expectedType || 'any';
      return `"${h.id}" (${t})`;
    }).join(', ') || 'none';

    const outputs = def.handles?.outputs?.map((h: any) => {
      return `"${h.id}" (${h.dataType || 'any'})`;
    }).join(', ') || 'none';

    let block = `\n--- Node Type: ${type} ---`;
    if (def.meta?.description) block += `\nDescription: ${def.meta.description}`;
    block += `\nInputs (use as targetHandle): ${inputs}`;
    block += `\nOutputs (use as sourceHandle): ${outputs}`;
    block += `\nConfig schema (populate strictly inside data.config):`;
    if (def.aiSchema && Object.keys(def.aiSchema).length > 0) {
      block += `\n${JSON.stringify(def.aiSchema, null, 2)}`;
    } else {
      block += `\n  {}`;
    }
    nodeDocs.push(block);
  }

  // Group ai_models by node_type_id so the model can pick the right
  // generator for each capability bucket.
  const modelLines: string[] = [];
  for (const nt of input.nodeTypes) {
    const modelsForType = input.models.filter(m => m.node_type_id === nt.id);
    if (modelsForType.length === 0) continue;
    modelLines.push(`  - "${nt.id}" (${nt.display_name}):`);
    for (const m of modelsForType) {
      const provider = m.providers?.name ? ` [${m.providers.name}]` : '';
      modelLines.push(`      • model_id ${m.id}: ${m.display_name}${provider}`);
    }
  }

  return `NODE REGISTRY (static):
${nodeDocs.join('\n')}

AI GENERATOR MODELS (live from ai_models):
${modelLines.length > 0 ? modelLines.join('\n') : '  (none active)'}`;
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add lib/chat/prompt/registry-context.ts
git commit -m "feat(chat): registry context formatter"
```

---

## Task 7: System prompt builder

**Files:**
- Create: `lib/chat/prompt/system.ts`

- [ ] **Step 1: Write the builder**

The builder returns Anthropic-shaped system content blocks (an array, not a string), so we can apply `cache_control` to the static portions for prompt caching.

Create `lib/chat/prompt/system.ts`:

```ts
import { VOICE_RULES } from './voice';
import { FEWSHOT_EXAMPLES } from './examples';
import { formatRegistryContext, type RegistryContextInput } from './registry-context';
import { formatWorkflowContext } from './workflow-context';
import type { Workflow } from '@/lib/nodes/types';

/**
 * Anthropic system content block shape (subset we use). We pass
 * cache_control on the stable parts to qualify for prompt caching.
 */
export interface SystemBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

const IDENTITY = `You are Prism, the AI workflow lead inside a visual node-based workflow builder. Users build image/media generation pipelines on a canvas; you build, modify, and explain those pipelines on their behalf.`;

const CAPABILITIES = `CAPABILITIES:
You can: build new workflows, modify existing ones, answer questions about the system, see images attached to the conversation, reason about the current canvas state.
You cannot: run workflows yourself (the user clicks Run), see runtime outputs from past runs unless they are in the conversation history, access files outside of the user's attachments.`;

const TOOL_RULES = `TOOL USAGE RULES:
- Use tools whenever the user asks for a workflow change. Don't use them for pure questions or explanations.
- Explain in 1-2 sentences before the tool call. Do not output numbered plans before tool calls.
- BATCHING: For any workflow creation, include ALL new nodes in a SINGLE add_node call.
- TOPOLOGICAL ORDER (mandatory): a node may only be added after every node it lists in inputs already exists in the same call (earlier in the array) or in the existing canvas.
- ID rules: for new nodes generate simple IDs like "n1", "n2", "prompt_1"; reuse those IDs in later tool calls in the same turn.
- Positions: pass any position — they are auto-calculated. Focus on types, connections, config.
- After tool calls, do not restate every node added — the UI shows the diff.`;

const RESPONSE_FORMAT = `RESPONSE FORMAT:
- Plain prose. Markdown for emphasis only.
- Mention cost or tokens only if the user asked.
- End with one forward question.`;

export interface BuildSystemInput {
  workflow: Workflow | null | undefined;
  registry: RegistryContextInput;
}

/**
 * Returns Anthropic-shaped system blocks. The first block bundles the
 * stable parts (identity, voice, capabilities, registry, tool rules,
 * format, examples) with cache_control. The second block is the dynamic
 * canvas summary, uncached.
 */
export function buildSystemPrompt(input: BuildSystemInput): SystemBlock[] {
  const stable = [
    IDENTITY,
    VOICE_RULES,
    CAPABILITIES,
    formatRegistryContext(input.registry),
    TOOL_RULES,
    RESPONSE_FORMAT,
    FEWSHOT_EXAMPLES,
  ].join('\n\n');

  const dynamic = formatWorkflowContext(input.workflow);

  return [
    { type: 'text', text: stable, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: dynamic },
  ];
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add lib/chat/prompt/system.ts
git commit -m "feat(chat): system prompt builder with cache_control"
```

---

## Task 8: Tool definitions

**Files:**
- Create: `lib/chat/tools/definitions.ts`

- [ ] **Step 1: Write the tool schemas**

Anthropic tools take JSON schema directly. We hand-write the schema (zod-to-json-schema would add a dep for one use) and validate inputs in the handler with zod for structural safety.

Create `lib/chat/tools/definitions.ts`:

```ts
import { sharedRegistry } from '@/lib/nodes/core/shared-registry';

const NODE_TYPE_ENUM = Object.keys(sharedRegistry);

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

const inputEdgeSchema = {
  type: 'object',
  properties: {
    source: { type: 'string', description: 'Source node ID (existing canvas ID, or an ID from earlier in this same array).' },
    sourceHandle: { type: 'string' },
    targetHandle: { type: 'string' }
  },
  required: ['source']
};

export const TOOLS: AnthropicTool[] = [
  {
    name: 'add_node',
    description: `Add one OR MORE nodes to the canvas in a single call. Always batch every node for a workflow into ONE call.
Each node may reference earlier nodes in the same array, OR existing canvas IDs.
Topological order is mandatory: a node's inputs may only reference IDs that appear earlier in this array or that already exist on the canvas.`,
    input_schema: {
      type: 'object',
      properties: {
        nodes: {
          type: 'array',
          minItems: 1,
          description: 'All nodes to add — include every node for the request here.',
          items: {
            type: 'object',
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
                default: []
              }
            },
            required: ['id', 'type', 'position', 'data']
          }
        }
      },
      required: ['nodes']
    }
  },
  {
    name: 'update_node',
    description: 'Update one existing node. Can also replace all inbound edges via replace_inputs.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Existing node ID (canvas UUID or previously used temporary ID).' },
        data: {
          type: 'object',
          properties: { config: { type: 'object', additionalProperties: true } }
        },
        position: {
          type: 'object',
          properties: { x: { type: 'number' }, y: { type: 'number' } },
          required: ['x', 'y']
        },
        replace_inputs: {
          type: 'array',
          items: inputEdgeSchema
        }
      },
      required: ['id']
    }
  },
  {
    name: 'remove_node',
    description: 'Remove one node and all connected edges.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Existing node ID (canvas UUID or previously used temporary ID).' }
      },
      required: ['id']
    }
  }
];

export type ToolName = 'add_node' | 'update_node' | 'remove_node';
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add lib/chat/tools/definitions.ts
git commit -m "feat(chat): Anthropic tool definitions for add/update/remove_node"
```

---

## Task 9: Tool handlers with aiSchema validation

**Files:**
- Create: `lib/chat/tools/handlers.ts`
- Read for reference: `lib/workflow/graph-ops.ts`, `lib/workflow/workflow-patch.ts`, `lib/nodes/core/shared-registry.ts`

- [ ] **Step 1: Write the handlers**

Mirrors the shape of the existing `prisfolTools.execute` callbacks in `route.ts`, plus an aiSchema pre-check that returns a structured error so the model can self-correct on the next turn rather than corrupting the canvas.

Create `lib/chat/tools/handlers.ts`:

```ts
import { applyAddNodeOp, applyRemoveNodeOp, applyUpdateNodeOp } from '@/lib/workflow/graph-ops';
import { mergeWorkflowPatches, type WorkflowPatch } from '@/lib/workflow/workflow-patch';
import { sharedRegistry } from '@/lib/nodes/core/shared-registry';
import type { Workflow } from '@/lib/nodes/types';
import type { ToolName } from './definitions';

export interface ToolHandlerState {
  workflow: Workflow;
  idMap: Map<string, string>;
}

export interface ToolResult {
  success: boolean;
  patch?: WorkflowPatch;
  error?: string;
}

/**
 * Lightweight aiSchema validator: checks that every required key listed in
 * the registry's aiSchema is present in the node's data.config. We don't
 * fully type-check values — applyAddNodeOp does deeper validation. The
 * goal here is to catch missing required fields before the patch lands so
 * the model sees a clean error and self-corrects.
 */
function validateNodeConfigAgainstRegistry(node: { type: string; data?: { config?: any } }): string | null {
  const def = (sharedRegistry as any)[node.type];
  if (!def) return `Unknown node type "${node.type}".`;
  const schema = def.aiSchema;
  if (!schema || typeof schema !== 'object') return null;

  const config = node.data?.config ?? {};
  const required: string[] = Array.isArray(schema.required) ? schema.required : [];
  const missing = required.filter(k => !(k in config));
  if (missing.length > 0) {
    return `Node "${node.type}" missing required config keys: ${missing.join(', ')}.`;
  }
  return null;
}

export function runAddNode(state: ToolHandlerState, args: any): ToolResult {
  if (!Array.isArray(args?.nodes) || args.nodes.length === 0) {
    return { success: false, error: 'add_node requires a non-empty "nodes" array.' };
  }

  // Pre-validate every node against the registry so a bad config gives one
  // clean error instead of corrupting the workflow halfway through.
  for (const node of args.nodes) {
    const err = validateNodeConfigAgainstRegistry(node);
    if (err) return { success: false, error: err };
  }

  const patches: WorkflowPatch[] = [];
  for (const node of args.nodes) {
    const result = applyAddNodeOp(state.workflow, node, state.idMap);
    if (!result.success) {
      return { success: false, error: result.error || 'add_node failed.' };
    }
    state.workflow = result.workflow;
    if (result.patch) patches.push(result.patch);
  }

  const merged = patches.reduce<WorkflowPatch | null>((acc, p) => mergeWorkflowPatches(acc, p), null);
  return { success: true, patch: merged ?? undefined };
}

export function runUpdateNode(state: ToolHandlerState, args: any): ToolResult {
  if (!args?.id || typeof args.id !== 'string') {
    return { success: false, error: 'update_node requires an "id" string.' };
  }
  const result = applyUpdateNodeOp(state.workflow, args, state.idMap);
  if (!result.success) return { success: false, error: result.error || 'update_node failed.' };
  state.workflow = result.workflow;
  return { success: true, patch: result.patch ?? undefined };
}

export function runRemoveNode(state: ToolHandlerState, args: any): ToolResult {
  if (!args?.id || typeof args.id !== 'string') {
    return { success: false, error: 'remove_node requires an "id" string.' };
  }
  const result = applyRemoveNodeOp(state.workflow, args, state.idMap);
  if (!result.success) return { success: false, error: result.error || 'remove_node failed.' };
  state.workflow = result.workflow;
  return { success: true, patch: result.patch ?? undefined };
}

export function dispatchTool(state: ToolHandlerState, name: ToolName, args: any): ToolResult {
  switch (name) {
    case 'add_node':    return runAddNode(state, args);
    case 'update_node': return runUpdateNode(state, args);
    case 'remove_node': return runRemoveNode(state, args);
    default: {
      const _exhaustive: never = name;
      return { success: false, error: `Unknown tool: ${_exhaustive}` };
    }
  }
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add lib/chat/tools/handlers.ts
git commit -m "feat(chat): tool handlers with aiSchema pre-validation"
```

---

## Task 10: Anthropic provider wrapper

**Files:**
- Create: `lib/chat/provider/anthropic.ts`

- [ ] **Step 1: Write the provider**

This wraps `@anthropic-ai/sdk`'s streaming API and exposes a single async generator that yields normalized events. Tool-input deltas (which arrive as JSON fragments) are accumulated per-block and parsed once each block stops.

Create `lib/chat/provider/anthropic.ts`:

```ts
import Anthropic from '@anthropic-ai/sdk';
import type { SystemBlock } from '../prompt/system';
import type { AnthropicTool } from '../tools/definitions';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 8192;
const THINKING_BUDGET = 2500;

// Sonnet 4.6 published pricing (USD per Mtok).
// Update if Anthropic changes pricing; only used for the usage event so
// downstream cost UI (sub-project C) doesn't have to recompute.
const PRICE_INPUT_PER_MTOK = 3;
const PRICE_OUTPUT_PER_MTOK = 15;
const PRICE_CACHE_READ_PER_MTOK = 0.3;

export interface ImageAttachment {
  /** base64 payload WITHOUT the "data:image/...;base64," prefix */
  data: string;
  mediaType: 'image/webp' | 'image/png' | 'image/jpeg' | 'image/gif';
}

export interface UserTurn {
  role: 'user';
  text: string;
  images?: ImageAttachment[];
}

export interface AssistantTurn {
  role: 'assistant';
  text: string;
}

export type ChatTurn = UserTurn | AssistantTurn;

export type ProviderEvent =
  | { kind: 'thinking_start' }
  | { kind: 'thinking_delta'; text: string }
  | { kind: 'thinking_end' }
  | { kind: 'text_delta'; text: string }
  | { kind: 'tool_call'; name: string; args: any }
  | { kind: 'usage'; inputTokens: number; outputTokens: number; thinkingTokens: number; cacheReadTokens: number; costUsd: number };

export interface StreamArgs {
  system: SystemBlock[];
  messages: ChatTurn[];
  tools: AnthropicTool[];
}

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set.');
    client = new Anthropic({ apiKey });
  }
  return client;
}

function toAnthropicMessages(turns: ChatTurn[]): Anthropic.MessageParam[] {
  return turns.map(turn => {
    if (turn.role === 'assistant') {
      return { role: 'assistant', content: turn.text };
    }
    const blocks: Anthropic.ContentBlockParam[] = [];
    for (const img of turn.images ?? []) {
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: img.mediaType, data: img.data }
      });
    }
    blocks.push({ type: 'text', text: turn.text });
    return { role: 'user', content: blocks };
  });
}

/**
 * Stream a Claude Sonnet 4.6 turn with extended thinking enabled.
 * Yields normalized ProviderEvents. Caller (brain.ts) maps these into
 * NDJSON StreamEvents.
 */
export async function* streamAnthropicTurn(args: StreamArgs): AsyncGenerator<ProviderEvent> {
  const c = getClient();

  const stream = c.messages.stream({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    thinking: { type: 'enabled', budget_tokens: THINKING_BUDGET },
    system: args.system as any,
    tools: args.tools as any,
    messages: toAnthropicMessages(args.messages)
  });

  /**
   * Per-block accumulator: index → { type, name?, jsonBuffer }
   * Tool calls arrive as input_json_delta strings; we concatenate then
   * JSON.parse on content_block_stop.
   */
  const blockState = new Map<number, { type: string; name?: string; jsonBuffer: string }>();

  for await (const event of stream) {
    if (event.type === 'content_block_start') {
      const block = event.content_block;
      const idx = event.index;

      if (block.type === 'thinking') {
        blockState.set(idx, { type: 'thinking', jsonBuffer: '' });
        yield { kind: 'thinking_start' };
      } else if (block.type === 'text') {
        blockState.set(idx, { type: 'text', jsonBuffer: '' });
      } else if (block.type === 'tool_use') {
        blockState.set(idx, { type: 'tool_use', name: block.name, jsonBuffer: '' });
      }
    } else if (event.type === 'content_block_delta') {
      const idx = event.index;
      const state = blockState.get(idx);
      if (!state) continue;

      const delta = event.delta;
      if (delta.type === 'thinking_delta') {
        yield { kind: 'thinking_delta', text: delta.thinking };
      } else if (delta.type === 'text_delta') {
        yield { kind: 'text_delta', text: delta.text };
      } else if (delta.type === 'input_json_delta') {
        state.jsonBuffer += delta.partial_json;
      }
    } else if (event.type === 'content_block_stop') {
      const idx = event.index;
      const state = blockState.get(idx);
      if (!state) continue;

      if (state.type === 'thinking') {
        yield { kind: 'thinking_end' };
      } else if (state.type === 'tool_use' && state.name) {
        let parsed: any = {};
        try {
          parsed = state.jsonBuffer ? JSON.parse(state.jsonBuffer) : {};
        } catch (err) {
          parsed = { __json_parse_error: String(err) };
        }
        yield { kind: 'tool_call', name: state.name, args: parsed };
      }

      blockState.delete(idx);
    }
  }

  const final = await stream.finalMessage();
  const usage = final.usage;
  const inputTokens = usage.input_tokens ?? 0;
  const outputTokens = usage.output_tokens ?? 0;
  const cacheReadTokens = (usage as any).cache_read_input_tokens ?? 0;
  // Anthropic counts thinking inside output_tokens. We don't get a separate
  // count from the API for thinking-only — we report 0 unless future SDK
  // versions expose it. The cost calc is still accurate.
  const thinkingTokens = 0;

  const costUsd =
    ((inputTokens - cacheReadTokens) * PRICE_INPUT_PER_MTOK) / 1_000_000 +
    (cacheReadTokens * PRICE_CACHE_READ_PER_MTOK) / 1_000_000 +
    (outputTokens * PRICE_OUTPUT_PER_MTOK) / 1_000_000;

  yield {
    kind: 'usage',
    inputTokens,
    outputTokens,
    thinkingTokens,
    cacheReadTokens,
    costUsd: Number(costUsd.toFixed(6))
  };
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors. If you see `Cannot find module '@anthropic-ai/sdk'` you missed Task 0 Step 2 — go back and `npm install @anthropic-ai/sdk`.

- [ ] **Step 3: Commit**

```bash
git add lib/chat/provider/anthropic.ts
git commit -m "feat(chat): Anthropic provider with extended thinking + cache"
```

---

## Task 11: Brain orchestrator

**Files:**
- Create: `lib/chat/brain.ts`
- Create: `lib/chat/index.ts`

- [ ] **Step 1: Write the orchestrator**

Brain accepts `(turns, workflow, registry, encoder)`, runs the provider stream, dispatches tool calls through handlers, and emits NDJSON events. Returns the final accumulated patch + assistant text + thinking text so the route can persist them.

Create `lib/chat/brain.ts`:

```ts
import type { Workflow } from '@/lib/nodes/types';
import { createEmptyWorkflow, applyWorkflowPatch, mergeWorkflowPatches, type WorkflowPatch } from '@/lib/workflow/workflow-patch';
import { buildSystemPrompt } from './prompt/system';
import type { RegistryContextInput } from './prompt/registry-context';
import { TOOLS, type ToolName } from './tools/definitions';
import { dispatchTool, type ToolHandlerState } from './tools/handlers';
import { streamAnthropicTurn, type ChatTurn } from './provider/anthropic';
import type { StreamEncoder } from './streaming/encoder';

export interface BrainResult {
  finalText: string;
  finalThinking: string;
  finalWorkflow: Workflow;
  accumulatedPatch: WorkflowPatch | null;
  hadAnyOutput: boolean;
  usage: { inputTokens: number; outputTokens: number; thinkingTokens: number; costUsd: number } | null;
}

export interface BrainInput {
  turns: ChatTurn[];
  workflow: Workflow | null | undefined;
  registry: RegistryContextInput;
  encoder: StreamEncoder;
}

export async function runBrain(input: BrainInput): Promise<BrainResult> {
  const baseWorkflow: Workflow =
    input.workflow && Array.isArray(input.workflow.nodes) && Array.isArray(input.workflow.edges)
      ? input.workflow
      : createEmptyWorkflow();

  const state: ToolHandlerState = { workflow: baseWorkflow, idMap: new Map() };

  const system = buildSystemPrompt({ workflow: baseWorkflow, registry: input.registry });

  let finalText = '';
  let finalThinking = '';
  let accumulatedPatch: WorkflowPatch | null = null;
  let hadAnyOutput = false;
  let usage: BrainResult['usage'] = null;

  try {
    const stream = streamAnthropicTurn({ system, messages: input.turns, tools: TOOLS });

    for await (const event of stream) {
      if (!input.encoder.isConnected()) break;
      hadAnyOutput = true;

      switch (event.kind) {
        case 'thinking_start':
          input.encoder.send({ type: 'thinking_start' });
          break;

        case 'thinking_delta':
          finalThinking += event.text;
          input.encoder.send({ type: 'thinking_delta', text: event.text });
          break;

        case 'thinking_end':
          input.encoder.send({ type: 'thinking_end' });
          break;

        case 'text_delta':
          finalText += event.text;
          input.encoder.send({ type: 'text', text: event.text });
          break;

        case 'tool_call': {
          const name = event.name as ToolName;
          if (name !== 'add_node' && name !== 'update_node' && name !== 'remove_node') {
            input.encoder.send({ type: 'error', message: `Unknown tool ${name}`, recoverable: true });
            break;
          }
          const result = dispatchTool(state, name, event.args);
          if (!result.success) {
            input.encoder.send({ type: 'error', message: result.error || `${name} failed`, recoverable: true });
            break;
          }
          if (result.patch) {
            accumulatedPatch = mergeWorkflowPatches(accumulatedPatch, result.patch);
            input.encoder.send({ type: 'tool', name, patch: result.patch });
          }
          break;
        }

        case 'usage':
          usage = {
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            thinkingTokens: event.thinkingTokens,
            costUsd: event.costUsd
          };
          input.encoder.send({
            type: 'usage',
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            thinkingTokens: event.thinkingTokens,
            costUsd: event.costUsd
          });
          break;
      }
    }
  } catch (err: any) {
    const message = err?.message || 'Anthropic stream failed.';
    const recoverable = !/auth|api[_ ]?key|invalid request/i.test(message);
    input.encoder.send({ type: 'error', message, recoverable });
  }

  const finalWorkflow = accumulatedPatch
    ? applyWorkflowPatch(baseWorkflow, accumulatedPatch)
    : baseWorkflow;

  return { finalText, finalThinking, finalWorkflow, accumulatedPatch, hadAnyOutput, usage };
}
```

- [ ] **Step 2: Write the barrel export**

Create `lib/chat/index.ts`:

```ts
export { runBrain } from './brain';
export type { BrainInput, BrainResult } from './brain';
export type { ChatTurn, UserTurn, AssistantTurn, ImageAttachment } from './provider/anthropic';
export { StreamEncoder } from './streaming/encoder';
export type { StreamEvent } from './streaming/protocol';
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add lib/chat/brain.ts lib/chat/index.ts
git commit -m "feat(chat): brain orchestrator + barrel export"
```

---

## Task 12: Wire route behind `CHAT_USE_NEW_BRAIN` flag

**Files:**
- Modify: `app/api/chat/stream/route.ts`

- [ ] **Step 1: Add the new-brain branch**

The route currently has one large POST handler. We extract the new path as a separate function and dispatch on the env flag at the top of the handler. The Gemini path is left fully intact for fallback.

Open `app/api/chat/stream/route.ts`. At the top of the file, after the existing imports, add:

```ts
import { runBrain, StreamEncoder, type ChatTurn, type ImageAttachment } from '@/lib/chat';
```

- [ ] **Step 2: Add the new-brain handler function**

In `app/api/chat/stream/route.ts`, immediately above the `export async function POST(req: Request)` line, add:

```ts
function parseImageAttachments(raw: any): ImageAttachment[] {
  if (!Array.isArray(raw)) return [];
  const out: ImageAttachment[] = [];
  for (const item of raw) {
    const url: string | undefined = typeof item === 'string' ? item : item?.dataUrl ?? item?.url;
    if (!url || typeof url !== 'string') continue;
    const match = url.match(/^data:(image\/(?:webp|png|jpeg|gif));base64,(.+)$/);
    if (!match) continue;
    out.push({ mediaType: match[1] as ImageAttachment['mediaType'], data: match[2] });
    if (out.length >= 4) break; // hard cap from spec
  }
  return out;
}

async function handleWithNewBrain(req: Request): Promise<Response> {
  const body = await req.json();
  const { messages, sessionId, previousWorkflow, attachedImages } = body ?? {};

  const supabase = createServiceClient();

  const [{ data: modelsData }, { data: nodeTypesData }] = await Promise.all([
    supabase.from('ai_models')
      .select('id, display_name, node_type_id, providers(name)')
      .eq('is_active', true)
      .order('display_name') as any,
    supabase.from('node_types')
      .select('id, display_name')
      .order('display_name') as any
  ]);

  const chatWindow = (messages || [])
    .filter((m: any) => m.content && m.content.trim().length > 0)
    .slice(-8);

  const images = parseImageAttachments(attachedImages);

  // The most recent user message gets the images attached as content blocks.
  const turns: ChatTurn[] = chatWindow.map((m: any, i: number, arr: any[]) => {
    const role = (m.role || m.type) === 'assistant' ? 'assistant' : 'user';
    if (role === 'assistant') return { role: 'assistant', text: m.content };
    const isLast = i === arr.length - 1;
    return { role: 'user', text: m.content, images: isLast ? images : undefined };
  });

  let connected = true;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new StreamEncoder(controller);

      waitUntil((async () => {
        const result = await runBrain({
          turns,
          workflow: previousWorkflow,
          registry: {
            models: (modelsData as any[]) || [],
            nodeTypes: (nodeTypesData as any[]) || []
          },
          encoder
        });

        if (sessionId && result.hadAnyOutput && messages?.length > 0) {
          const lastUserMsg = messages[messages.length - 1];
          const dbOps: Promise<any>[] = [];

          if (lastUserMsg.role === 'user' || lastUserMsg.type === 'user') {
            dbOps.push(
              Promise.resolve(supabase.from('messages').insert({
                session_id: sessionId,
                role: 'user',
                content: lastUserMsg.content,
                status: 'completed',
                created_at: new Date().toISOString()
              }) as any)
            );
          }

          if (result.finalText) {
            dbOps.push(
              Promise.resolve(supabase.from('messages').insert({
                session_id: sessionId,
                role: 'assistant',
                content: result.finalText,
                metadata: { thinking: result.finalThinking || null, usage: result.usage || null },
                status: 'completed',
                created_at: new Date(Date.now() + 1000).toISOString()
              }) as any)
            );
          }

          if (result.accumulatedPatch) {
            dbOps.push(
              Promise.resolve(supabase.from('sessions').update({
                canvas_state: { nodes: result.finalWorkflow.nodes, edges: result.finalWorkflow.edges },
                updated_at: new Date().toISOString()
              }).eq('id', sessionId) as any)
            );
          }

          if (dbOps.length > 0) await Promise.all(dbOps);
        }

        encoder.send({ type: 'done' });
        encoder.close();
      })());
    },
    cancel() {
      connected = false;
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform'
    }
  });
}
```

- [ ] **Step 3: Add the dispatch at the top of `POST`**

Find `export async function POST(req: Request) {` and immediately after the opening brace add:

```ts
    if (process.env.CHAT_USE_NEW_BRAIN === 'true') {
        try {
            return await handleWithNewBrain(req);
        } catch (error: any) {
            return new Response(JSON.stringify({ error: error.message }), { status: 500 });
        }
    }
```

The existing Gemini path runs unchanged when the flag is not `'true'`.

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Smoke test the legacy path is unaffected**

Make sure `CHAT_USE_NEW_BRAIN` is `false` (or unset) in `.env.local`. Then:

```bash
npm run dev
```

In the browser, open a chat session and send "hi". You should get a Gemini response exactly like before. Then stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add app/api/chat/stream/route.ts
git commit -m "feat(chat): wire new brain behind CHAT_USE_NEW_BRAIN flag"
```

---

## Task 13: Update client reducer for new event types

**Files:**
- Modify: `lib/hooks/use-chat-messages.ts` (or `components/chat/hooks/use-chat-messages.ts` — wherever the existing one lives; check first)

- [ ] **Step 1: Locate the current message-stream reducer**

Run:

```bash
grep -rn "type: 'text'" components/chat lib/hooks 2>/dev/null
grep -rn "JSON.parse" components/chat lib/hooks 2>/dev/null | grep -v node_modules
```

Note the file that handles incoming NDJSON lines from `/api/chat/stream`. The hook that reads `response.body` and parses each line is the one to modify.

- [ ] **Step 2: Add handlers for the new event types**

The new brain emits `{type: 'text', text: '...'}` while the legacy Gemini path emits `{type: 'text', content: '...'}`. We accept both during rollout.

In the reducer (whichever file it lives in), update the parser to handle:

```ts
// Pseudocode — adapt to the actual reducer in your repo. The key is:
// - Accept both `event.text` and `event.content` for text events.
// - Add cases for thinking_start, thinking_delta, thinking_end, usage, done.
// - Existing tool/error handling remains.

switch (event.type) {
  case 'text': {
    const chunk = (event as any).text ?? (event as any).content ?? '';
    draft.text += chunk;
    break;
  }
  case 'thinking_start': {
    draft.thinking = draft.thinking ?? '';
    draft.isThinking = true;
    draft.thinkingStartedAt = Date.now();
    break;
  }
  case 'thinking_delta': {
    draft.thinking = (draft.thinking ?? '') + (event as any).text;
    break;
  }
  case 'thinking_end': {
    draft.isThinking = false;
    draft.thinkingDurationMs = Date.now() - (draft.thinkingStartedAt ?? Date.now());
    break;
  }
  case 'usage': {
    draft.usage = {
      inputTokens: (event as any).inputTokens,
      outputTokens: (event as any).outputTokens,
      thinkingTokens: (event as any).thinkingTokens,
      costUsd: (event as any).costUsd
    };
    break;
  }
  case 'tool': {
    // existing logic — apply patch to the workflow store
    break;
  }
  case 'error': {
    // existing logic — surface the error
    break;
  }
  case 'done': {
    draft.status = 'completed';
    break;
  }
}
```

The exact edit depends on the current reducer shape — read the file first, mimic its style, add the new cases. Add the new fields (`thinking`, `isThinking`, `thinkingStartedAt`, `thinkingDurationMs`, `usage`) to whatever message type the hook stores.

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add <the file you modified>
git commit -m "feat(chat): client reducer handles thinking + usage + done events"
```

---

## Task 14: Persist thinking on rehydrate

**Files:**
- Modify: the message-loading code (likely `lib/api/client.ts` or wherever messages are fetched from Supabase and mapped to UI shape)

- [ ] **Step 1: Find the message hydrator**

```bash
grep -rn "from('messages')" lib app 2>/dev/null | grep -v node_modules
grep -rn "messages.metadata" lib app components 2>/dev/null | grep -v node_modules
```

Find the function that turns Supabase rows into the chat message shape.

- [ ] **Step 2: Map `metadata.thinking` and `metadata.usage` onto the message**

Where the row → chat-message mapping lives, add (style adapted to existing code):

```ts
const metadata = (row.metadata ?? {}) as { thinking?: string | null; usage?: any };
return {
  id: row.id,
  role: row.role,
  content: row.content,
  images: row.images ?? [],
  status: row.status,
  thinking: metadata.thinking ?? '',
  usage: metadata.usage ?? null,
  // ...existing fields
};
```

- [ ] **Step 3: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add <the file you modified>
git commit -m "feat(chat): rehydrate thinking + usage from messages.metadata"
```

---

## Task 15: ThinkingPanel component

**Files:**
- Create: `components/chat/ThinkingPanel.tsx`

- [ ] **Step 1: Write the component**

Create `components/chat/ThinkingPanel.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';

const VISIBILITY_CHAR_THRESHOLD = 100;
const VISIBILITY_TIME_THRESHOLD_MS = 500;

export interface ThinkingPanelProps {
  /** Streaming or persisted reasoning text. Empty string means no thinking happened. */
  thinking: string;
  /** True while the assistant is still thinking on this turn. */
  isStreaming: boolean;
  /** ms — durations under threshold suppress the panel entirely. */
  durationMs?: number;
}

/**
 * Collapsible reasoning display. Hidden until thinking exceeds 100 chars
 * OR 500ms — keeps the panel from flickering for trivial turns.
 *
 * After the turn ends, the panel collapses by default. Click the header
 * to re-expand. On history reload, the same rules apply.
 */
export function ThinkingPanel({ thinking, isStreaming, durationMs }: ThinkingPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [crossedThreshold, setCrossedThreshold] = useState(false);

  useEffect(() => {
    if (!isStreaming) {
      // After stream ends, visibility is based on final thinking length.
      setCrossedThreshold(thinking.length >= VISIBILITY_CHAR_THRESHOLD);
      return;
    }
    // While streaming, cross the threshold on length OR a 500ms timer.
    if (thinking.length >= VISIBILITY_CHAR_THRESHOLD) {
      setCrossedThreshold(true);
      return;
    }
    const t = setTimeout(() => setCrossedThreshold(true), VISIBILITY_TIME_THRESHOLD_MS);
    return () => clearTimeout(t);
  }, [thinking, isStreaming]);

  if (!crossedThreshold) return null;

  const headerLabel = isStreaming
    ? 'Thinking...'
    : `Thinking · ${formatDuration(durationMs)}`;

  return (
    <div className="my-2 rounded border border-zinc-200 bg-zinc-50 text-zinc-600 text-sm dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400">
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800/50"
      >
        <span className="text-xs">{expanded ? '▾' : '▸'}</span>
        <span className="font-medium">{headerLabel}</span>
      </button>
      {expanded && (
        <div className="px-3 pb-3 pt-1 italic whitespace-pre-wrap leading-relaxed">
          {thinking || '(no reasoning recorded)'}
        </div>
      )}
    </div>
  );
}

function formatDuration(ms?: number): string {
  if (!ms || ms < 0) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
```

- [ ] **Step 2: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Render the panel from `ChatInterface.tsx` for assistant messages**

Open `components/chat/ChatInterface.tsx`. Find where each assistant message is rendered. Above the existing message body, add:

```tsx
import { ThinkingPanel } from './ThinkingPanel';

// inside the assistant-message render block:
{message.thinking !== undefined && (
  <ThinkingPanel
    thinking={message.thinking ?? ''}
    isStreaming={message.isStreaming === true && message.isThinking === true}
    durationMs={message.thinkingDurationMs}
  />
)}
```

The exact placement depends on the current message-rendering structure. The intent is: panel appears *above* the assistant's text bubble, only when the message has thinking data (either streamed or persisted).

- [ ] **Step 4: Type-check + smoke test**

```bash
npx tsc --noEmit
```

In `.env.local`, set `CHAT_USE_NEW_BRAIN=true` for the next smoke test (we'll verify the panel appears in Task 18). Don't smoke-test yet — Task 16 finishes the request body shape.

- [ ] **Step 5: Commit**

```bash
git add components/chat/ThinkingPanel.tsx components/chat/ChatInterface.tsx
git commit -m "feat(chat): ThinkingPanel component with threshold-gated visibility"
```

---

## Task 16: Send images correctly to the route + 4-cap with eviction toast

**Files:**
- Modify: `components/chat/ChatInterface.tsx` (or wherever attachments are passed in the fetch body)
- Likely modify: `lib/hooks/use-file-upload.ts` (or wherever attachment state lives)

- [ ] **Step 1: Find the attachment state + send pipeline**

```bash
grep -rn "attachedImages" components lib app 2>/dev/null | grep -v node_modules
```

Locate (a) the state that holds attached images for the in-flight chat input, (b) the body construction in the fetch call that posts to `/api/chat/stream`.

- [ ] **Step 2: Enforce the 4-image cap with oldest-evicted-on-add**

Wherever attachments are added (likely in `use-file-upload.ts` or a `useState` in `ChatInterface.tsx`), change the add logic to:

```ts
const HARD_CAP = 4;

function addAttachment(prev: Attachment[], next: Attachment): { items: Attachment[]; evicted?: Attachment } {
  if (prev.length < HARD_CAP) {
    return { items: [...prev, next] };
  }
  const [evicted, ...rest] = prev;
  return { items: [...rest, next], evicted };
}
```

When `evicted` is returned, show a toast (use the existing toast util in this repo — `grep -rn "toast(" components | head -5` to find it). Toast text:

```
Removed earliest photo — chat keeps the 4 most recent images active.
```

- [ ] **Step 3: Verify the request body sends image data-URIs**

Find the fetch to `/api/chat/stream` and confirm it sends `attachedImages` as an array of `{ dataUrl, mediaType }` (or just the data-URI strings). The new route's `parseImageAttachments` (Task 12) accepts both shapes.

If the current code only sends URLs without the base64 prefix, change it to send the full data-URI like `data:image/webp;base64,...`.

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add <files modified>
git commit -m "feat(chat): 4-image cap with eviction toast + data-URI body"
```

---

## Task 17: Preserve existing local edits to ChatInterface.tsx

**Files:**
- Modify: `components/chat/ChatInterface.tsx`

- [ ] **Step 1: Check current state of local modifications**

```bash
git status components/chat/ChatInterface.tsx
git diff components/chat/ChatInterface.tsx
```

If the file has unstaged changes from before this branch was created, they need to be preserved as their own commit BEFORE the split tasks. This way the refactor diff in Tasks 19-23 is reviewable on its own.

- [ ] **Step 2: Commit the local edits as a preservation commit**

```bash
git add components/chat/ChatInterface.tsx
git commit -m "chore(chat): preserve local UI tweaks before component split"
```

If `git status` shows nothing to add, skip this task — the local edits were already absorbed into earlier task commits.

---

## Task 18: First smoke test of the new brain end-to-end

**Files:** none — verification only.

- [ ] **Step 1: Confirm env**

In `.env.local`:
```
CHAT_USE_NEW_BRAIN=true
ANTHROPIC_API_KEY=sk-ant-...
```

- [ ] **Step 2: Start dev server**

```bash
npm run dev
```

- [ ] **Step 3: Run the smoke checklist**

In the browser, against an empty chat session:

1. **Trivial turn:** type `hi`. Expected: short reply, no `ThinkingPanel` (under threshold). Assistant message persists on refresh with no thinking.
2. **Workflow create:** type `make me a workflow that puts a person on a beach`. Drop a person photo into the gallery first. Expected: `ThinkingPanel` appears mid-stream, collapses on completion; canvas gets ~3 nodes (input → generator → compositor); the model actually references the dropped photo (because it sees it). Run the workflow and verify it produces output.
3. **Q&A:** type `what does the background_remover node do?`. Expected: short reply, no tool calls, panel may briefly appear if thinking exceeds threshold.
4. **Modify:** with the workflow on canvas, type `change the model to imagen-4`. Expected: `update_node` patch applied; canvas updates; no rebuild.
5. **5-image eviction:** drop 5 images one at a time. Expected: oldest evicts on the 5th; toast shown; gallery has exactly 4.
6. **Multilingual:** type `מה זה הצומת הזה?` (Hebrew "what is this node?") pointing at a node. Expected: response in Hebrew; voice rules respected.
7. **Bad tool call self-correct:** harder to force directly — can be skipped here unless you can hand-craft a prompt that triggers it. The validation path is exercised in real traffic.
8. **Refresh persistence:** refresh the page on a session where thinking happened. Expected: panel stays collapsed by default, expands to show persisted thinking text from `metadata.thinking`.

- [ ] **Step 4: Note any issues found**

If a check fails, fix the relevant code and re-run only the failing checks. Use small fix-up commits per issue:

```bash
git commit -m "fix(chat): <issue>"
```

- [ ] **Step 5: Stop dev server, commit nothing else, move on**

If all checks pass, no commit is needed for this task — verification only.

---

## Task 19: Extract `MessageList` component

**Files:**
- Create: `components/chat/MessageList.tsx`
- Modify: `components/chat/ChatInterface.tsx`

- [ ] **Step 1: Identify the scroll/message-render block**

Open `components/chat/ChatInterface.tsx`. Locate the JSX block that renders the list of messages — typically a wrapping `<div ref={scrollRef}>` containing the `messages.map(...)` plus any `ResizeObserver` / scroll-pinning logic.

- [ ] **Step 2: Move it into `MessageList.tsx`**

Create `components/chat/MessageList.tsx`:

```tsx
'use client';

import { useEffect, useRef } from 'react';
// import the existing message render component, e.g.:
// import { MemoizedMessage } from './MemoizedMessage';
// import type { ChatMessage } from '@/lib/...';

export interface MessageListProps {
  messages: any[]; // replace `any` with the real ChatMessage type from your repo
  streamingMessageId?: string | null;
  onRevert?: (messageId: string) => void;
}

export function MessageList({ messages, streamingMessageId, onRevert }: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastUserMessageRef = useRef<HTMLDivElement>(null);

  // Move the existing ResizeObserver / scroll-pinning logic here verbatim.
  // It currently lives in ChatInterface.tsx around the streaming pin.

  useEffect(() => {
    // existing scroll pinning side-effect — copy from ChatInterface.tsx
  }, [messages, streamingMessageId]);

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto">
      {messages.map(msg => (
        // existing message render JSX, including <ThinkingPanel> for assistant messages
        <div key={msg.id} ref={msg.role === 'user' ? lastUserMessageRef : undefined}>
          {/* existing per-message render */}
        </div>
      ))}
    </div>
  );
}
```

Replace the `any` type with the real `ChatMessage` type from your repo (search for it). Keep all existing render logic; only change is the relocation.

- [ ] **Step 3: Use `<MessageList>` from `ChatInterface.tsx`**

In `ChatInterface.tsx`, replace the moved block with:

```tsx
<MessageList
  messages={messages}
  streamingMessageId={streamingMessageId}
  onRevert={handleRevert}
/>
```

Pass the same callbacks/state that the inline version used.

- [ ] **Step 4: Type-check**

```bash
npx tsc --noEmit
```

- [ ] **Step 5: Smoke test**

```bash
npm run dev
```

Send a few messages. Expected: scroll behavior identical to before (the user's last message stays pinned during streaming). Stop the dev server.

- [ ] **Step 6: Commit**

```bash
git add components/chat/MessageList.tsx components/chat/ChatInterface.tsx
git commit -m "refactor(chat): extract MessageList from ChatInterface"
```

---

## Task 20: Extract `ChatInput` component

**Files:**
- Create: `components/chat/ChatInput.tsx`
- Modify: `components/chat/ChatInterface.tsx`

- [ ] **Step 1: Identify the input block**

In `ChatInterface.tsx`, locate the JSX for: textarea, send button, voice toggle, drag-drop zone, and any local input state.

- [ ] **Step 2: Move into `ChatInput.tsx`**

Create `components/chat/ChatInput.tsx`:

```tsx
'use client';

import { useState } from 'react';

export interface ChatInputProps {
  disabled?: boolean;
  onSend: (text: string) => void;
  onAttachFiles: (files: File[]) => void;
  onToggleVoice?: () => void;
  isVoiceActive?: boolean;
}

export function ChatInput({ disabled, onSend, onAttachFiles, onToggleVoice, isVoiceActive }: ChatInputProps) {
  const [text, setText] = useState('');

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText('');
  };

  return (
    <div
      className="flex items-end gap-2 border-t p-2"
      onDragOver={e => e.preventDefault()}
      onDrop={e => {
        e.preventDefault();
        const files = Array.from(e.dataTransfer?.files ?? []);
        if (files.length > 0) onAttachFiles(files);
      }}
    >
      {/* existing send/voice/textarea JSX moved here verbatim, wired through props */}
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        disabled={disabled}
        className="flex-1 resize-none"
      />
      {/* preserve existing voice button + send button */}
    </div>
  );
}
```

Adapt to the actual existing JSX (preserve every styling/aria detail). The component is a controlled wrapper; logic that lives in `ChatInterface.tsx` (send pipeline, attachment state) stays in `ChatInterface.tsx`.

- [ ] **Step 3: Use it from `ChatInterface.tsx`**

```tsx
<ChatInput
  disabled={isStreaming}
  onSend={handleSend}
  onAttachFiles={handleAttachFiles}
  onToggleVoice={handleToggleVoice}
  isVoiceActive={isVoiceActive}
/>
```

- [ ] **Step 4: Type-check + smoke test**

```bash
npx tsc --noEmit
npm run dev
```

Send a message via Enter, via the send button, drop a file, toggle voice. Expected: identical behavior. Stop dev server.

- [ ] **Step 5: Commit**

```bash
git add components/chat/ChatInput.tsx components/chat/ChatInterface.tsx
git commit -m "refactor(chat): extract ChatInput from ChatInterface"
```

---

## Task 21: Extract `AttachmentGallery` component

**Files:**
- Create: `components/chat/AttachmentGallery.tsx`
- Modify: `components/chat/ChatInterface.tsx`

- [ ] **Step 1: Move the gallery JSX**

Create `components/chat/AttachmentGallery.tsx`:

```tsx
'use client';

export interface Attachment {
  id: string;
  dataUrl: string;
  mediaType: 'image/webp' | 'image/png' | 'image/jpeg' | 'image/gif';
  sizeBytes: number;
}

export interface AttachmentGalleryProps {
  attachments: Attachment[];
  onRemove: (id: string) => void;
}

export function AttachmentGallery({ attachments, onRemove }: AttachmentGalleryProps) {
  if (attachments.length === 0) return null;
  return (
    <div className="flex gap-2 px-2 pb-1">
      {attachments.map(att => (
        <div key={att.id} className="relative h-16 w-16 overflow-hidden rounded">
          <img src={att.dataUrl} alt="" className="h-full w-full object-cover" />
          <button
            type="button"
            aria-label="Remove attachment"
            onClick={() => onRemove(att.id)}
            className="absolute right-0 top-0 rounded-bl bg-black/60 px-1 text-xs text-white"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
```

Match the existing styling — open the current gallery JSX in `ChatInterface.tsx` and copy the classNames over. Don't ship a different look in this commit; that's a separate UI-polish task.

- [ ] **Step 2: Use it from `ChatInterface.tsx`**

```tsx
<AttachmentGallery attachments={attachments} onRemove={handleRemoveAttachment} />
```

- [ ] **Step 3: Type-check + smoke test**

```bash
npx tsc --noEmit
npm run dev
```

Drop 2 images, remove one, drop a 5th to trigger eviction. Expected: thumbnails render, remove works, eviction toast appears. Stop dev server.

- [ ] **Step 4: Commit**

```bash
git add components/chat/AttachmentGallery.tsx components/chat/ChatInterface.tsx
git commit -m "refactor(chat): extract AttachmentGallery from ChatInterface"
```

---

## Task 22: Extract `Message` and `MessageActions`

**Files:**
- Create: `components/chat/Message.tsx`
- Create: `components/chat/MessageActions.tsx`
- Modify: `components/chat/MessageList.tsx`

- [ ] **Step 1: Extract `MessageActions`**

The copy/edit/revert button cluster currently lives inline. Pull it out.

Create `components/chat/MessageActions.tsx`:

```tsx
'use client';

export interface MessageActionsProps {
  messageId: string;
  content: string;
  canEdit?: boolean;
  canRevert?: boolean;
  onCopy?: () => void;
  onEdit?: () => void;
  onRevert?: () => void;
}

export function MessageActions({ messageId, content, canEdit, canRevert, onCopy, onEdit, onRevert }: MessageActionsProps) {
  const handleCopy = () => {
    navigator.clipboard?.writeText(content);
    onCopy?.();
  };

  return (
    <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
      <button type="button" aria-label="Copy" onClick={handleCopy} className="rounded p-1 hover:bg-zinc-100">
        ⎘
      </button>
      {canEdit && (
        <button type="button" aria-label="Edit" onClick={onEdit} className="rounded p-1 hover:bg-zinc-100">
          ✎
        </button>
      )}
      {canRevert && (
        <button type="button" aria-label="Revert" onClick={onRevert} className="rounded p-1 hover:bg-zinc-100">
          ↶
        </button>
      )}
    </div>
  );
}
```

Adapt classNames + icons to match existing visuals.

- [ ] **Step 2: Extract `Message`**

Create `components/chat/Message.tsx`:

```tsx
'use client';

import { ThinkingPanel } from './ThinkingPanel';
import { MessageActions } from './MessageActions';
import { MessageRenderer } from './MessageRenderer';

export interface MessageProps {
  message: any; // replace with real ChatMessage type
  isStreaming?: boolean;
  onEdit?: () => void;
  onRevert?: () => void;
}

export function Message({ message, isStreaming, onEdit, onRevert }: MessageProps) {
  const isAssistant = message.role === 'assistant';

  return (
    <div className={`group my-2 ${isAssistant ? 'pl-2' : 'pr-2 text-right'}`}>
      {isAssistant && (
        <ThinkingPanel
          thinking={message.thinking ?? ''}
          isStreaming={isStreaming === true && message.isThinking === true}
          durationMs={message.thinkingDurationMs}
        />
      )}
      <MessageRenderer
        content={message.content}
        images={message.images ?? []}
        toolResults={message.toolResults}
      />
      <MessageActions
        messageId={message.id}
        content={message.content ?? ''}
        canEdit={!isAssistant}
        canRevert={isAssistant}
        onEdit={onEdit}
        onRevert={onRevert}
      />
    </div>
  );
}
```

The `MessageRenderer` import path matches the existing component (per the spec, that one stays unchanged).

- [ ] **Step 3: Use `Message` from `MessageList.tsx`**

Replace the inline per-message JSX in `MessageList.tsx` with:

```tsx
{messages.map(msg => (
  <Message
    key={msg.id}
    message={msg}
    isStreaming={msg.id === streamingMessageId}
    onEdit={() => handleEdit(msg.id)}
    onRevert={() => onRevert?.(msg.id)}
  />
))}
```

`handleEdit` likely lives in `ChatInterface.tsx` and gets passed as a prop — adapt the prop chain.

- [ ] **Step 4: Type-check + smoke test**

```bash
npx tsc --noEmit
npm run dev
```

Hover over messages — actions appear. Click copy, edit, revert. Stop dev server.

- [ ] **Step 5: Commit**

```bash
git add components/chat/Message.tsx components/chat/MessageActions.tsx components/chat/MessageList.tsx
git commit -m "refactor(chat): extract Message + MessageActions"
```

---

## Task 23: Reduce `ChatInterface.tsx` to orchestrator

**Files:**
- Modify: `components/chat/ChatInterface.tsx`

- [ ] **Step 1: Walk through `ChatInterface.tsx` end to end**

Open the file. With the extractions from Tasks 19-22 done, what's left should be:

- Session state + workflow store wiring
- Send pipeline (fetch to `/api/chat/stream`, NDJSON reader)
- Attachment state machine (add/remove with cap)
- Voice input wiring
- Top-level layout: `<AttachmentGallery>` + `<MessageList>` + `<ChatInput>`

Anything else (rendering details, inline buttons, custom JSX for individual concerns) should already be elsewhere. If not, extract it now into the most appropriate existing file.

- [ ] **Step 2: Verify the file size target**

```bash
wc -l components/chat/ChatInterface.tsx
```

Expected: ~350 lines, definitely under 500. If it's still over 500, identify what's left and extract one more component (commonly: a wrapper for keyboard shortcuts, or a header bar with session controls).

- [ ] **Step 3: Type-check + smoke test**

```bash
npx tsc --noEmit
npm run dev
```

Run the full smoke checklist from Task 18 again. Expected: nothing changed in behavior — only the file structure.

- [ ] **Step 4: Commit (only if you made further extractions)**

```bash
git add components/chat/
git commit -m "refactor(chat): trim ChatInterface to orchestrator"
```

If the file was already at target after Tasks 19-22, no commit needed.

---

## Task 24: Full manual test pass

**Files:** none — verification.

- [ ] **Step 1: Run the spec's manual checklist**

The spec lists these — verify each (`docs/superpowers/specs/2026-05-07-chat-brain-rework-design.md`, "Manual test checklist"):

- [ ] Cold session "make me a workflow that puts a person on a beach" with image → workflow appears, thinking visible after threshold, run works.
- [ ] Existing session, "change the model to Flux" → `update_node` fires, no rebuild.
- [ ] "What does this node do?" → no tool calls, fast reply.
- [ ] 5 image upload → oldest evicted, toast shown.
- [ ] Network blip mid-stream → recoverable, retry works (use browser DevTools "Offline" toggle mid-stream to simulate).
- [ ] Refresh page → thinking persists in `metadata.thinking`, panel expands history correctly.
- [ ] Multilingual: send a Hebrew or Spanish message → response in same language.
- [ ] Bad tool call (model emits invalid config) → the brain catches; model self-corrects on next turn; canvas not corrupted. Hard to force; if you can't trigger naturally, log what you did try.

- [ ] **Step 2: Fix anything that fails**

Small fix commits per issue:

```bash
git commit -m "fix(chat): <issue>"
```

If a fix is non-trivial, write a one-line note in the plan margin so reviewers know what was discovered late.

- [ ] **Step 3: No commit if everything passes**

---

## Task 25: Remove the Gemini fallback

**Files:**
- Modify: `app/api/chat/stream/route.ts`
- Modify: `package.json`
- Modify: `CLAUDE.md` (env section)

Run this only after Task 24 passes consistently across multiple sessions.

- [ ] **Step 1: Strip the Gemini path from `route.ts`**

Open `app/api/chat/stream/route.ts`. Delete:
- The `import { streamText, tool } from 'ai';` line
- The `import { createGoogleGenerativeAI } from '@ai-sdk/google';` line
- The `import { z } from 'zod';` line **only if** it's not used by anything left in the file (it's used by zod schemas in the legacy tool defs which are being deleted; check first)
- The `const google = createGoogleGenerativeAI(...)` block
- The `getCleanNodesContext` function and its call site
- The `nodeTypes` const (still needed? grep — likely no after the delete)
- The legacy `prisfolTools` definition
- The legacy systemPrompt construction
- Everything from the legacy `for await (const part of result.fullStream)` block down through the legacy DB persist logic

Replace the entire `POST` function body with:

```ts
export async function POST(req: Request) {
    try {
        return await handleWithNewBrain(req);
    } catch (error: any) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}
```

- [ ] **Step 2: Drop the env flag check**

In `handleWithNewBrain`, the dispatch logic `if (process.env.CHAT_USE_NEW_BRAIN === 'true')` is no longer needed — it was only the dispatcher. Make sure it's gone.

- [ ] **Step 3: Remove unused deps**

```bash
npm uninstall @ai-sdk/google @google/generative-ai
```

Check if anything else in the repo uses `streamText` or `@ai-sdk/google`:

```bash
grep -rn "@ai-sdk/google\|@google/generative-ai\|from 'ai'" lib app components 2>/dev/null | grep -v node_modules
```

If results come back, leave the deps installed and only remove the `ai` SDK from `route.ts`.

- [ ] **Step 4: Update `CLAUDE.md`**

In the `Required env` line, remove `GEMINI_API_KEY` and `CHAT_USE_NEW_BRAIN`. Final shape:

```
Required env (in `.env.local`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `REPLICATE_API_TOKEN`, `REPLICATE_WEBHOOK_SIGNING_SECRET`, `NEXT_PUBLIC_APP_URL` (used as the Replicate webhook base URL — must be publicly reachable), `CRON_SECRET`.
```

- [ ] **Step 5: Type-check + smoke test**

```bash
npx tsc --noEmit
npm run dev
```

Run the smoke checklist from Task 24 once more. Stop the dev server when done.

- [ ] **Step 6: Commit**

```bash
git add app/api/chat/stream/route.ts package.json package-lock.json CLAUDE.md
git commit -m "chore(chat): remove Gemini fallback and CHAT_USE_NEW_BRAIN flag"
```

- [ ] **Step 7: Verify final file sizes against spec targets**

```bash
wc -l app/api/chat/stream/route.ts components/chat/ChatInterface.tsx lib/chat/brain.ts lib/chat/prompt/system.ts
```

Spec targets:
- `route.ts`: ~80 lines (after this task)
- `ChatInterface.tsx`: ~350 lines
- `brain.ts`: ~150 lines
- `prompt/system.ts`: ~250 lines

If any file is dramatically over target, ask whether it's worth one more extraction or whether the bigger size is justified by content. None of these are hard limits.

---

## Done

Branch `feat/chat-brain-rework` is ready to merge. Final shape:

- Anthropic Claude Sonnet 4.6 powers the chat with extended thinking + prompt caching
- `lib/chat/*` modules: prompt builder, registry/workflow context, tools, provider, streaming protocol, brain orchestrator
- `app/api/chat/stream/route.ts` is a thin handler
- `components/chat/*` split into focused components with `ThinkingPanel`
- Image vision actually works
- 4-image cap with eviction toast
- Thinking persists in `messages.metadata.thinking`
- All deferred sub-projects (B/C/D/E/F) have clean seams to plug into

Open follow-ups (not in this plan):
- B — Plan-and-approve flow
- C — Cost preview before run (this plan emits the `usage` event, so the seam is live)
- D — File uploads beyond images
- E — Suggestion chips
- F — Advanced workflow control

---

## Self-review notes

- **Spec coverage:** every section of the spec maps to one or more tasks above (Architecture → Tasks 0-12; Module structure → Tasks 1-11, 19-23; Streaming protocol → Task 1; Image vision → Tasks 12, 16; No classifier → Task 10's hardcoded `THINKING_BUDGET`; Prompt structure → Tasks 3-7; UI components → Tasks 15, 19-23; Error handling → Tasks 11, 16; Migration → Tasks 0, 12, 25).
- **Placeholder scan:** the only intentional `any` types are at component-prop boundaries where the actual `ChatMessage` type lives in the existing repo and the engineer is told to substitute it (Tasks 19, 22). All other steps contain complete code.
- **Type consistency:** `ToolHandlerState`, `BrainResult`, `StreamEvent`, `ProviderEvent`, `ImageAttachment`, `ChatTurn`, `SystemBlock` are defined once and referenced consistently. The `messages.metadata.thinking` shape is defined in Task 12 (write) and consumed in Task 14 (rehydrate) symmetrically.
- **Gaps fixed during review:** clarified in Task 13 that the legacy `{type:'text', content}` and new `{type:'text', text}` shapes both need to be accepted; clarified in Task 16 that `parseImageAttachments` accepts both string and `{dataUrl}` forms so the client-side change is non-breaking; added Task 24 as an explicit full-checklist run before stripping Gemini.
