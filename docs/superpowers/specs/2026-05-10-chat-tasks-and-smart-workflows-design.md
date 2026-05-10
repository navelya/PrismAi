# Chat tasks and smart workflows — design

Date: 2026-05-10
Status: Proposed
Owner: navelya.10@gmail.com

## Problem

The chat brain today emits a single workflow patch per user turn (or a single blueprint via `propose_plan` for complex builds). It works, but it has limits the user wants to push past:

- For complex requests (multi-scene videos, product image sets, multi-stage pipelines), one big blueprint flash gives no sense of *what's happening* during the build. The user wants visible progress per logical section.
- The model has no way to add custom node titles or wrap nodes in named groups with icons. Default labels and a flat node list make complex workflows hard to scan.
- Clarification today is one chip-card per turn. For requests that genuinely need 2–3 pieces of context (length, style, references), the model has no clean pattern to chain probing questions.
- The model is "smart enough" to handle a wide range of use cases (video, product imagery, multi-stage transforms), but the system prompt doesn't anchor that smartness to recognizable archetypes.

## Goals

1. Let the model split a plan into sequential **tasks** when, and only when, the workflow has 2+ logically independent sections.
2. Render task progression in the chat as a minimal, modern checklist component, updating live as each task is applied.
3. Let the model **rename node titles** when a custom label aids comprehension.
4. Let the model **define groups** with `label`, Lucide `icon`, and color, attached to tasks. Build the missing `group_container` plugin so groups actually render.
5. Allow **multi-turn clarification chains** — one question per turn until the model has enough context to plan.
6. Make the model **archetype-aware** — short patterns in the system prompt for multi-scene video, product image set, and multi-stage pipeline that the model generalizes from.
7. Preserve manual user grouping on the canvas alongside AI-driven grouping.

## Non-goals (v1)

- Auto-run after build. Tasks build the graph; the user clicks Run.
- Mid-execution feedback loops ("generate scene 1, look at output, decide scene 2 prompt").
- Per-task LLM sub-calls during the apply loop. The model thinks once at plan time.
- Cancellation of an in-flight task chain.
- Resume after server crash mid-loop. Stalled cards are retried via the feedback path.
- Multi-question clarification cards (a single card with multiple inputs).
- Hardcoded use-case templates beyond the three archetypes.
- Auto-grouping of existing canvas nodes by the AI.
- Custom icon uploads — Lucide only.

## Architecture overview

Five interlocking pieces, all stitched together by extending the existing chat-brain protocol rather than adding a parallel system:

1. **Plan with optional task list.** `propose_plan` gains an optional `tasks: Task[]` field. When present, the plan is built by applying tasks in order. When absent, behavior is identical to today.
2. **Task = node chunk + optional group.** Each task has `{ id, title, summary, group?, nodes, edges }`. The optional group says "wrap this task's nodes in a group_container with this label/icon/color".
3. **Group container as a real plugin.** `group_container` is in the type union but missing as a plugin. We build the two-file plugin (no executor — groups are presentational). React Flow native parent/child handles rendering. Manual user grouping reuses the same plugin.
4. **Sequential application with visible progress.** On plan approve, the server applies `tasks[0]`, broadcasts via Realtime + chat NDJSON stream, waits ~600ms, applies `tasks[1]`, etc. The plan card collapses; a new `TaskProgressCard` renders below it showing checklist + active task + final summary.
5. **Smarter system prompt.** New sections in the system prompt: when to split, when to rename, when to group, archetype patterns, and explicit blessing of multi-turn clarification chains.

No new database tables. No new external services. No migrations. No breaking changes to existing single-blueprint plans.

## Protocol changes

### `propose_plan` tool schema

Extend with optional `tasks: Task[]`. Either `tasks` or `blueprint` is required, never both. Validation rejects `tasks: []` (empty array treated as missing).

```ts
interface ProposedPlan {
  title: string;
  summary: string;
  arrows: string;
  models: string[];
  detail: string;
  // Exactly one of:
  blueprint?: { nodes: NodeBlueprint[]; edges: EdgeBlueprint[] };
  tasks?: Task[];
}

interface Task {
  id: string;            // model-supplied, scoped to this plan (e.g. "scene_1")
  title: string;         // ≤60 chars, shown in checklist
  summary: string;       // ≤140 chars, one-liner
  group?: {
    label: string;       // ≤40 chars
    icon: string;        // Lucide PascalCase name; "Folder" fallback
    color?: 'neutral' | 'indigo' | 'emerald' | 'rose' | 'amber' | 'sky';
  };
  nodes: NodeBlueprint[]; // same item shape as add_node.nodes[]
  edges: EdgeBlueprint[]; // same item shape as add_node.edges[]
}
```

Each task's blueprint is dry-run-validated through `validateBlueprint` at proposal time, same path as today's single-blueprint validation.

### Smart titles

The `add_node` schema's node item already carries `data` as a freeform object. Expose `data.label` explicitly in the JSON schema with one-line guidance ("Optional custom label for this node, ≤40 chars, in the user's language"). No runtime change — `WorkflowNode.data.label` is already rendered by the canvas.

### `ask_clarification` — unchanged

The chat input is always available for free-text answers. If the model needs pure free-text (e.g. "what duration?"), it asks in prose and skips the tool call. Multi-turn clarification is a system-prompt change only, not a protocol change.

### New stream events

Added to `lib/chat/streaming/protocol.ts`:

```ts
| { type: 'task_start'; taskId: string; index: number; total: number }
| { type: 'task_complete'; taskId: string; index: number; total: number }
| { type: 'tasks_complete'; total: number }
```

Existing `tool` events still fire once per task application, carrying that task's patch. The `plan` event already streams the full plan including `tasks`, so the client can render the checklist before the first task starts.

### Persistence

Plan + task list lives in `messages.metadata.plan` (existing JSONB field). Task progress lives in `messages.metadata.taskProgress`:

```json
{
  "status": "pending" | "running" | "done" | "failed",
  "currentIndex": 2,
  "total": 4,
  "failedTaskId": null
}
```

No migrations.

## UI components

### `PlanCard` — two display modes + collapsed state

- **Single-blueprint mode** (today, unchanged): summary, arrows, models, detail, Approve / Feedback buttons.
- **Task-list mode** (new): summary up top, then a checklist of `Task` rows — each row shows `title`, optional group icon + label chip, one-line `summary`. Approve / Feedback buttons at the bottom. Detail prose still fits below the checklist if the model emits one.
- **Collapsed approved state**: after approve, the card collapses to a one-line "Approved · Building N tasks" header. Click to re-expand.

### `TaskProgressCard` — new minimal component

Renders below the (collapsed) `PlanCard` inside the same assistant message bubble, driven from `messageMeta.taskProgress`. Visual:

```
┌──────────────────────────────────────────┐
│ Building workflow                  2 / 4 │
├──────────────────────────────────────────┤
│ ✓  Setup uploads & references            │
│ ✓  Scene 1 — Forest establishing shot    │
│ ●  Scene 2 — Campfire close-up           │
│    Building 4 nodes…                     │
│ ○  Scene 3 — Wide finale                 │
└──────────────────────────────────────────┘
```

Style notes:

- Single column, no card-within-card.
- Status glyphs only: `✓` (done, green-500), pulsing `●` (active, primary), hollow `○` (upcoming, muted).
- Group icon + color render as a tiny chip beside the title (`[icon] Scene 1`).
- One subtle horizontal divider above the rows. Border = `border-border/40`. No box shadows.
- Counter top-right (`2 / 4`).
- On `done`: collapses to a single line `✓ Built 4 tasks · 12 nodes`, click-to-expand.
- On `failed`: failed row shows error in red sub-line + "Retry from here" link-style button.

Two component files: `TaskProgressCard.tsx` (the visual) and a presentational sub-component `TaskRow.tsx` if the row gets messy. State comes from props only.

### `group_container` on canvas

A React Flow group node — `parentNode` of children points to it; `extent: 'parent'` is intentionally NOT set on children (per existing CLAUDE.md note: children must be draggable out of the group). The group renders:

- **Header bar**: Lucide icon (resolved at render via `Icons[name] ?? Icons.Folder`), editable label (double-click → contenteditable; blur or Enter saves to `data.config.label` via existing zustand `updateNode`), and a small "⋯" menu (Change icon, Change color, Ungroup).
- **Body**: faint dashed `border-{color}-300/40`, semi-transparent `bg-{color}-50/30`, rounded-2xl. Children render inside via React Flow's native nesting.
- **Selected state**: solid 1px ring matching color. Same focus-ring system as other nodes.
- **Color tokens** map to Tailwind classes: `neutral`, `indigo`, `emerald`, `rose`, `amber`, `sky`. Default `neutral`.
- **Manual rename / re-icon**: double-click label, right-click for menu. Both reuse the same canvas-action surface as the AI path.

The icon picker is a small popover with a search input over the Lucide name set — same pattern shadcn uses for command menus. Lazy-import each row's icon when the popover opens; no bundle bloat.

### Task staging timing

Between task applications: 600ms default delay. Constant `STAGING_DELAY_MS` in `lib/chat/config.ts` for easy tuning. Each task's nodes appear with the existing `isNew: true` flag — canvas already animates new nodes.

## Group container plugin

### Files

```
lib/nodes/plugins/group_container/
  index.ts        ← shared def
  component.tsx   ← client renderer (header, icon picker, body)
  (no executor)
```

### Shared def shape

```ts
export const groupContainerNode: SharedNodeDef = {
  type: 'group_container',
  family: 'organization',     // new family — visual only
  inputHandles: [],
  outputHandles: [],
  aiSchema: {
    label: { type: 'string', maxLength: 40 },
    icon:  { type: 'string', description: 'Lucide PascalCase name' },
    color: { type: 'string', enum: ['neutral','indigo','emerald','rose','amber','sky'], default: 'neutral' },
  },
  defaultConfig: { label: 'Group', icon: 'Folder', color: 'neutral' },
};
```

### Execution-engine integration

One targeted edit each in `lib/workflow/orchestrator.ts` and `app/api/executions/start/route.ts`: when building the target set or scanning children for dispatch, skip nodes where `node.type === 'group_container'`. Groups produce no `node_results` row and don't gate downstream parent-completion checks. Edges referencing a group_container should never be created (groups have no handles), but a defensive filter belongs here too.

### AI generation path — server-side group synthesis

When a task carries `group: { label, icon, color }`, the runtime synthesizes the container automatically. The model never declares a `group_container` node directly; it only declares the children plus the group descriptor.

```
Per task with group:
  1. Compute bounding box of task.nodes positions: { min, max }.
  2. Synthesize group_container node:
       id = `group_${task.id}`
       config = { label, icon, color }
       position = { x: min.x - 24, y: min.y - 56 }   // header + body padding
       size = { width: max.x - min.x + 240, height: max.y - min.y + 120 }
  3. For each child in task.nodes:
       set parentNode = group_container.id
       set position = child.position - group.position  (relative)
  4. Apply: dispatchTool(state, 'add_node', { nodes: [group, ...children], edges })
```

Position math is deterministic and lives server-side. The model is bad at parent-relative coordinates, and it doesn't need to do them.

### Manual grouping (in scope)

Users can also create groups manually on the canvas — select 2+ nodes → right-click / canvas menu → "Group selection". The plugin's rename, icon-pick, and ungroup interactions are the same surface used for AI-created groups; the manual command is a thin canvas-action layer that calls into the existing zustand actions to:

1. Create a `group_container` node with default config.
2. Compute bounding box of selection, position group, rewrite children's positions to relative + set `parentNode`.

Ungroup (header menu) reverses: clear `parentNode` on each child, restore absolute positions, delete group_container. No edge changes needed in either direction (groups have no handles).

## Sequential task execution

All sequencing happens server-side, inside an extended `handlePlanApprove` in `app/api/chat/stream/route.ts`. Single endpoint, single approval transaction, no new routes.

### Apply loop

When approval arrives and `plan.tasks` is present:

1. Verify idempotency (existing prior-approval check); load `canvas_state` (existing).
2. Initialize `ToolHandlerState` with a shared mutable `idMap`. The map persists across iterations so a later task can reference an earlier task's temp id (e.g. `scene1_gen` from task 0 used in task 2).
3. For `i` in `0..tasks.length-1`:
   1. `encoder.send({ type: 'task_start', taskId, index: i, total })`
   2. If `task.group` present: synthesize group_container node + rewrite children positions + set `parentNode` (per algorithm above).
   3. `dispatchTool(state, 'add_node', { nodes, edges })`
   4. If `!result.success`: emit `{ type: 'error', recoverable: false }` with `failedTaskId`; persist `taskProgress = { status: 'failed', failedTaskId, currentIndex: i }`; break the loop. Tasks 0..i-1 stay applied — partial state is intentional.
   5. `encoder.send({ type: 'tool', name: 'add_node', patch: result.patch })`
   6. Persist `sessions.canvas_state` and `messages.metadata.taskProgress = { status: 'running', currentIndex: i, total }`.
   7. `encoder.send({ type: 'task_complete', taskId, index: i, total })`
   8. If `i < tasks.length - 1`: `await sleep(STAGING_DELAY_MS)` (600ms).
4. After loop: `encoder.send({ type: 'tasks_complete', total })`. Final `taskProgress = { status: 'done', currentIndex: total, total }`.

### `add_node` reuse

The task loop calls `dispatchTool('add_node', ...)` per task — same code path, same validation, same canvas-state mutation as a normal `add_node` tool call. Bugs fixed in one path get fixed everywhere. No parallel apply implementation.

### Realtime delivery

Two channels carry progress:

- The NDJSON chat stream (`task_start`, `tool`, `task_complete`, `tasks_complete`) drives `TaskProgressCard` updates live.
- Supabase Realtime on `messages` row updates handles the multi-tab / mid-flight-refresh case via the existing `taskProgress` JSONB updates.

### Idempotency

Existing prior-approval check at the top of `handlePlanApprove` short-circuits double-clicks. No per-task idempotency key — the whole plan is one approval.

## System prompt changes

All additions go into the cache-controlled stable block. New examples in `FEWSHOT_EXAMPLES` (one task-mode plan, one multi-turn clarification chain, one renamed-titles example) sit in the same block. ~600-token total addition.

### Amend `CLARIFYING QUESTIONS`

Add multi-turn blessing:

> Multi-step clarification: when one answer doesn't give you enough to plan, ask another targeted question on the next turn. Don't bundle all questions into one card. The user prefers one focused question per turn over a survey. Stop asking the moment you have enough to commit to a plan — typically 1–3 turns. If a question can't fit chip options (e.g. "what duration?"), ask it in prose without `ask_clarification`; the user types the answer.

### Amend `GROUPING`

Fold in icon, color, AI vs. manual split:

> Groups now carry an `icon` (Lucide PascalCase name like `Film`, `Camera`, `Folder`, `Music`) and an optional `color` (one of `neutral`, `indigo`, `emerald`, `rose`, `amber`, `sky`). Pick an icon that mirrors the group's purpose. Default `color: neutral` unless distinct sections benefit from visual separation, then assign distinct colors so the user can scan.
>
> Users can also create groups manually on the canvas; you don't need to recreate or repair manual groups. Treat any existing group_container in the canvas summary as authoritative and add new nodes alongside or inside it as the user requests.

### Amend `PLAN PROPOSAL` — task list shape

> A plan can be a single blueprint (today's behavior) OR a list of sequential tasks. Use tasks ONLY when the workflow has 2+ logically independent sections that each produce a recognizable output (e.g. multi-scene video, product image set with distinct angles, multi-stage pipeline with a clear checkpoint per stage). Otherwise emit a single blueprint — most plans are single-blueprint.
>
> When using tasks: each task is one recognizable build chunk. Order matters — earlier tasks may produce nodes referenced by later tasks. The user approves the entire task list at once; the runtime applies them sequentially with brief pauses so the user can perceive each step. Do NOT split a coherent unit into 2+ tasks just to look busy. Do NOT use tasks when the user asked for "just one thing".
>
> When a task is a logical section (a scene, an angle, a stage), give it a `group` with `label` + `icon` + optional `color`. When a task is plumbing (uploads, initial processing) where grouping would be noise, omit `group`.

### New `TITLE RENAMING`

> You can override a node's default label by setting `data.label`. Rename ONLY when a custom label materially helps the user understand what the node does in this workflow. Examples: "AI Generator" → "Hero shot — studio light", "Compositor" → "Final overlay", "Prompt" → "Scene 2 prompt — campfire". Skip renaming for one-off utility nodes where the default is already clear (a single Blur, a single Levels). Be terse; ≤40 chars. Don't rename in a language different from the user's.

### New `USE-CASE ARCHETYPES`

> Common patterns — generalize from these, don't pattern-match rigidly:
>
> *Multi-scene video.* User wants a short video with 2+ distinct scenes. Clarify duration and overall style first if not given. Plan as one task per scene + a final composition task. Each scene group: a prompt node (scene description), an ai_generator (video model), optionally a media_input for reference. Compositor task ties them. Group icon: `Film`. Per-scene color when scenes are visually distinct.
>
> *Product image set.* User wants product images from multiple angles or in multiple settings. Clarify product type, angles, and any reference image. Plan as one task per angle/setting. Each angle group: prompt node + ai_generator + optional media_input for the product reference. No composition task. Group icon: `Camera`. Color them distinctly so the user can scan.
>
> *Multi-stage pipeline.* User wants an output that requires sequential transformations (e.g. background-remove → composite → color-grade → upscale). Plan as one task per stage. Each stage group: 1–2 nodes. Stages without an obvious visual separation can stay ungrouped within a single task. Group icon: stage-appropriate (`Scissors`, `Layers`, `Wand2`, `ArrowUpRightSquare`).
>
> If the user's request doesn't match any archetype, fall back to your judgment: split when sections are independent, group when 2+ nodes share a logical purpose, otherwise single blueprint with no groups.

### New `TASK SPLITTING — when not to`

> Single blueprint is the default. Avoid splitting when:
>
> - The whole workflow is under ~5 nodes.
> - The pipeline is linear with no obvious checkpoint.
> - The user asked for one specific output, not a series.
> - You're tempted to split just to add visible "progress" — that's not a reason.

### Extend `CRITICAL RULES`

> 8. When you emit a plan with `tasks`, every task must contain a complete, apply-ready blueprint chunk — same validation as `add_node`. The runtime applies tasks in array order and won't reorder them.
> 9. `data.label` overrides are advisory: keep them ≤40 chars, in the user's language, and don't rename utility nodes unless it adds real comprehension value.

## Error handling

| Failure mode | Behavior |
|---|---|
| Task N's blueprint fails validation at apply time (rare — same `validateBlueprint` ran at proposal) | Halt loop. Persist `taskProgress = { status: 'failed', failedTaskId, currentIndex: N }`. Tasks 0..N-1 stay on canvas. Card shows the failed row with error message + "Retry from here" link. Retry triggers a feedback-style next turn. |
| Realtime broadcast fails mid-loop | Apply loop continues; client falls back to row-update Realtime channel. Worst case: card jumps task states without intermediate animation — no data loss. |
| User refreshes mid-loop | Page rehydrates from `messages.metadata.taskProgress`. Card shows last persisted state. The `runFromNodeId`/`runMode` exclusion in `app-store.ts` keeps the run-trigger from re-firing. |
| User clicks Approve twice | Existing idempotency short-circuit catches the second approve. |
| Group icon unknown to Lucide | UI falls back to `Folder`. No error. |
| Group color outside enum | Validation error at proposal time. |
| Manual user grouping during a long-running task chain | Last-write-wins on canvas — the task loop's pre-computed positions overwrite manual moves in the ~2s window. Acceptable v1 tradeoff given the short window. |
| Plan has both `tasks` and `blueprint` | Validation error at proposal time, model retries. |
| Plan's `tasks: []` | Treated as missing — validation rejects. |
| Task references a temp id that doesn't exist | Same dispatchTool error as today, bubbles up as task failure. |

## Compatibility

Every existing flow keeps working unchanged:

- Single-blueprint plans (today) keep working — `tasks` is opt-in; when omitted, the existing single-blueprint path runs unchanged.
- `add_node` / `update_node` / `remove_node` — task loop reuses `dispatchTool('add_node')` internally.
- Manual user grouping via `parentNode` — new plugin reads the same field.
- Existing chat messages with old-shape `metadata.plan` (no `tasks`, no `taskProgress`) render in the old single-blueprint path.

## Files changed

| File | Change |
|---|---|
| `lib/chat/tools/definitions.ts` | Add `tasks?: Task[]` to `propose_plan`, expose `data.label` in node schema |
| `lib/chat/tools/handlers.ts` | Validate `tasks` / `blueprint` mutual exclusion in `validateBlueprint` |
| `lib/chat/streaming/protocol.ts` | Add `task_start`, `task_complete`, `tasks_complete` events |
| `lib/chat/streaming/encoder.ts` | New event encoders |
| `lib/chat/brain.ts` | Capture `plan.tasks` from tool calls |
| `lib/chat/prompt/system.ts` | Amend `GROUPING`, `PLAN PROPOSAL`, `CLARIFYING QUESTIONS`, `CRITICAL RULES`; add `TITLE RENAMING`, `TASK SPLITTING`, `USE-CASE ARCHETYPES` |
| `lib/chat/prompt/examples.ts` | New examples: task-mode plan, multi-turn clarification, renamed-titles |
| `lib/chat/config.ts` (new) | `STAGING_DELAY_MS = 600` and related constants |
| `app/api/chat/stream/route.ts` | Extend `handlePlanApprove` with sequential apply loop, group synthesis, position math, taskProgress persistence |
| `lib/nodes/plugins/group_container/index.ts` (new) | Plugin shared def |
| `lib/nodes/plugins/group_container/component.tsx` (new) | Plugin client renderer with header, icon picker, color, rename, ungroup |
| `lib/nodes/core/shared-registry.ts` | Register `group_container` shared def |
| `lib/nodes/core/client-registry.ts` | Register `group_container` client def |
| `lib/workflow/orchestrator.ts` | Skip `group_container` in dispatch / parent-completion checks |
| `app/api/executions/start/route.ts` | Skip `group_container` from target set construction |
| `components/chat/PlanCard.tsx` | Two display modes (single-blueprint vs task-list); collapsed approved state |
| `components/chat/TaskProgressCard.tsx` (new) | Minimal checklist with status glyphs |
| `components/chat/TaskRow.tsx` (new, optional) | Sub-component if rows get messy |
| `components/chat/Message.tsx` or `MessageRenderer.tsx` | Render `TaskProgressCard` when `taskProgress` present |
| `components/canvas/` (new selection-group action) | Manual select-and-group canvas command, reusing plugin's UI |

No database migrations. No new routes. No new external services.

## Open follow-ups (post-v1)

- Cancellation of in-flight task chain (status row keyed by `messageId`).
- Auto-run option ("Run as you build" toggle on plan card).
- Resume after crash mid-loop (UI surface for the stalled-card case).
- Mid-execution feedback loops for "look-then-decide" workflows.
- Per-task run-on-completion auto-trigger.
- Custom icon uploads.
- Smart auto-grouping of *existing* canvas nodes by the AI.
