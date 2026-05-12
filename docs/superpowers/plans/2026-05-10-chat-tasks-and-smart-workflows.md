# Chat tasks and smart workflows — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship sequential chat tasks (with progress UI), group icons + colors, smart node-title renaming, multi-turn clarifications, and use-case archetype awareness in the chat brain — all on top of the existing chat protocol and the grouping foundation shipped on 2026-05-09.

**Architecture:** Extend `propose_plan` with an optional `tasks: Task[]` field. On approval, the server applies tasks sequentially with brief delays, synthesizing group_container nodes from each task's optional `group` descriptor. Stream events drive a new `TaskProgressCard` in chat. Group plugin gains icon + color schema; existing `GroupNode` renders both. System prompt grows new sections for task splitting, title renaming, and use-case archetypes.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Zustand, React Flow 11, Anthropic SDK with tool use, Supabase Postgres + Realtime, Tailwind, lucide-react, shadcn/Radix UI primitives.

**Spec:** `docs/superpowers/specs/2026-05-10-chat-tasks-and-smart-workflows-design.md`

**Testing approach:** This repo has no test runner (per CLAUDE.md). Verification per task is one of:
- **Type check:** `npm run build` after schema/type changes — fails on type errors.
- **Logic scripts:** Small Node script in `scripts/` that exercises a pure function with sample inputs and prints PASS/FAIL.
- **Manual UI:** `npm run dev` + browser interaction, narrated in the verify step.
- **Integration script:** Node script that POSTs to `/api/chat/stream` against a running dev server.

**Commit cadence:** Commit at the end of each task. Smaller, frequent commits make rollback cheap.

---

## Milestone 0 — Group plugin: icon + color

The grouping foundation (renderer, drag, resize, store actions) shipped 2026-05-09. We add per-instance `icon` (Lucide name) and `color` (token) to the schema, render them in `GroupNode`, and surface a small toolbar for changing them.

### Task 0.1: Extend group_container shared-registry def

**Files:**
- Modify: `lib/nodes/core/shared-registry.ts:9-36`

- [ ] **Step 1: Replace the inline `group_container` registration** with one that includes `icon` + `color` in `defaultConfig` and `aiSchema`. Keep the `as any` cast since `family: 'organization'` is still outside the strict `NodeSharedDef` type union.

```ts
group_container: {
    type: 'group_container',
    family: 'organization',
    category: 'organization',
    meta: {
        label: 'Group',
        color: 'rgb(var(--stroke-subtle))',
        icon: 'Group',
    },
    handles: {
        inputs: [],
        outputs: [],
    },
    defaultConfig: {
        width: 400,
        height: 300,
        icon: 'Folder',
        color: 'neutral',
    },
    aiSchema: {
        type: 'object',
        properties: {
            label:  { type: 'string', maxLength: 40 },
            icon:   { type: 'string', description: 'Lucide PascalCase name (Folder, Film, Camera, Music, Wand2, ...). Falls back to Folder if unknown.' },
            color:  { type: 'string', enum: ['neutral','indigo','emerald','rose','amber','sky'], default: 'neutral' },
            width:  { type: 'number', default: 400 },
            height: { type: 'number', default: 300 },
        },
    },
    nonExecutable: true,
} as any,
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS (no type errors). Group nodes still render with default icon + color since defaults exist.

- [ ] **Step 3: Commit**

```bash
git add lib/nodes/core/shared-registry.ts
git commit -m "feat(groups): add icon + color to group_container schema"
```

---

### Task 0.2: Render icon and color in GroupNode

**Files:**
- Modify: `components/editor/GroupNode.tsx`

- [ ] **Step 1: Extend the data shape and read the new config fields.** Add `icon` and `color` to `GroupNodeData['config']` (line 8–11), then resolve them at the top of the component (line 26–28).

```ts
interface GroupNodeData {
    label: string;
    config: {
        width: number;
        height: number;
        icon?: string;
        color?: 'neutral' | 'indigo' | 'emerald' | 'rose' | 'amber' | 'sky';
    };
}
```

Inside the component, after `const height = ...`:

```ts
const iconName = data.config?.icon ?? 'Folder';
const colorToken = data.config?.color ?? 'neutral';
```

- [ ] **Step 2: Add a color → Tailwind class map.** Place this above the `HANDLES` array:

```ts
const GROUP_COLOR_CLASSES: Record<string, { ring: string; bgRgba: string }> = {
    neutral: { ring: 'rgb(127, 127, 127)',                           bgRgba: 'rgba(127, 127, 127, 0.10)' },
    indigo:  { ring: 'rgb(99, 102, 241)',                            bgRgba: 'rgba(99, 102, 241, 0.10)' },
    emerald: { ring: 'rgb(16, 185, 129)',                            bgRgba: 'rgba(16, 185, 129, 0.10)' },
    rose:    { ring: 'rgb(244, 63, 94)',                             bgRgba: 'rgba(244, 63, 94, 0.10)' },
    amber:   { ring: 'rgb(245, 158, 11)',                            bgRgba: 'rgba(245, 158, 11, 0.10)' },
    sky:     { ring: 'rgb(14, 165, 233)',                            bgRgba: 'rgba(14, 165, 233, 0.10)' },
};
```

- [ ] **Step 3: Render the icon in the title bubble.** Inside the `NodeToolbar`'s child div (line 134), add a leading icon. Use a dynamic Lucide lookup with a `Folder` fallback. Add this import at the top:

```ts
import * as LucideIcons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
```

Add this helper above the component (NOT inside it — keep stable reference):

```ts
function resolveIcon(name: string | undefined): LucideIcon {
    if (!name) return LucideIcons.Folder;
    const Candidate = (LucideIcons as any)[name];
    return (Candidate && typeof Candidate === 'object') ? Candidate as LucideIcon : LucideIcons.Folder;
}
```

In the title bubble, before the existing `{isEditingTitle ? ... : ...}` ternary, render the icon:

```tsx
{(() => {
    const Icon = resolveIcon(iconName);
    return <Icon size={12} className="mr-1.5 text-content-secondary shrink-0" />;
})()}
```

- [ ] **Step 4: Apply the color to the body.** Replace the static `background: 'rgba(127, 127, 127, 0.10)'` (line 203) with a lookup:

```ts
background: GROUP_COLOR_CLASSES[colorToken]?.bgRgba ?? GROUP_COLOR_CLASSES.neutral.bgRgba,
```

And replace the static `border-stroke-subtle/60` (line 196) — when not selected/hover-target, tint the border with the color:

```tsx
className={
    "group relative rounded-2xl transition-colors " +
    (isHoverTarget
        ? "border-2 border-accent-primary"
        : selected
            ? "border-2 border-accent-primary"
            : "border")
}
style={{
    width,
    height,
    background: GROUP_COLOR_CLASSES[colorToken]?.bgRgba ?? GROUP_COLOR_CLASSES.neutral.bgRgba,
    borderColor: (isHoverTarget || selected) ? undefined : GROUP_COLOR_CLASSES[colorToken]?.ring + '60',
    pointerEvents: 'none',
}}
```

(`+ '60'` adds 37.5% alpha — gives the same "subtle border" look the original `/60` Tailwind modifier produced.)

- [ ] **Step 5: Verify in dev server**

Run: `npm run dev`

Manually:
1. Open `/chat`, build a workflow with the AI that produces a group_container, OR open the canvas dev view and create a group manually.
2. Open the React DevTools or browser console; `dispatch` an update to set `data.config.icon = 'Film'` and `data.config.color = 'indigo'` on the group node via the store action `updateNode(id, { config: { ..., icon: 'Film', color: 'indigo' } })`.
3. Verify: title bubble shows the Film icon; body has indigo tint; border has indigo subtle tint.

- [ ] **Step 6: Commit**

```bash
git add components/editor/GroupNode.tsx
git commit -m "feat(groups): render icon and color tint on GroupNode"
```

---

### Task 0.3: Icon + color picker toolbar

The user (and AI re-edits) need a way to change icon and color on existing groups. We add a small popover triggered from the title bubble.

**Files:**
- Create: `components/editor/GroupHeaderToolbar.tsx`
- Modify: `components/editor/GroupNode.tsx`

- [ ] **Step 1: Create the toolbar component.**

```tsx
'use client';

import React, { useState } from 'react';
import * as LucideIcons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const COLOR_TOKENS = ['neutral', 'indigo', 'emerald', 'rose', 'amber', 'sky'] as const;
type ColorToken = typeof COLOR_TOKENS[number];

const COLOR_SWATCH_CLASSES: Record<ColorToken, string> = {
    neutral: 'bg-stroke-subtle',
    indigo:  'bg-indigo-500',
    emerald: 'bg-emerald-500',
    rose:    'bg-rose-500',
    amber:   'bg-amber-500',
    sky:     'bg-sky-500',
};

// Curated icon set — short list keeps the popover scannable.
// Engineer can extend; do NOT load all of Lucide (1500+ icons would bloat).
const ICON_OPTIONS = [
    'Folder', 'Film', 'Camera', 'Image', 'Music', 'Mic', 'Volume2',
    'Wand2', 'Layers', 'Scissors', 'Brush', 'Palette',
    'Box', 'Package', 'Star', 'Heart', 'Bookmark', 'Tag',
    'PlayCircle', 'StopCircle', 'Settings', 'Sparkles',
] as const;

interface Props {
    currentIcon: string;
    currentColor: ColorToken;
    onIconChange: (icon: string) => void;
    onColorChange: (color: ColorToken) => void;
    onUngroup: () => void;
}

export function GroupHeaderToolbar({ currentIcon, currentColor, onIconChange, onColorChange, onUngroup }: Props) {
    const [open, setOpen] = useState(false);

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    className="ml-1 px-1 rounded hover:bg-surface-subtle text-content-secondary text-xs nopan nodrag"
                    onClick={(e) => e.stopPropagation()}
                    aria-label="Group options"
                >
                    ⋯
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-56 p-2 nopan nowheel" onClick={(e) => e.stopPropagation()}>
                <div className="text-xs font-medium text-content-secondary mb-1.5">Color</div>
                <div className="flex gap-1.5 mb-3">
                    {COLOR_TOKENS.map((c) => (
                        <button
                            key={c}
                            type="button"
                            onClick={() => onColorChange(c)}
                            aria-label={c}
                            className={
                                'h-5 w-5 rounded-full border transition-all ' +
                                COLOR_SWATCH_CLASSES[c] +
                                (c === currentColor ? ' ring-2 ring-offset-1 ring-content-primary' : ' opacity-80 hover:opacity-100')
                            }
                        />
                    ))}
                </div>
                <div className="text-xs font-medium text-content-secondary mb-1.5">Icon</div>
                <div className="grid grid-cols-6 gap-1 mb-3">
                    {ICON_OPTIONS.map((name) => {
                        const Icon = (LucideIcons as any)[name] as LucideIcon | undefined;
                        if (!Icon) return null;
                        const active = name === currentIcon;
                        return (
                            <button
                                key={name}
                                type="button"
                                onClick={() => onIconChange(name)}
                                title={name}
                                className={
                                    'flex items-center justify-center h-7 w-7 rounded transition-colors ' +
                                    (active ? 'bg-accent-primary text-white' : 'hover:bg-surface-subtle text-content-secondary')
                                }
                            >
                                <Icon size={14} />
                            </button>
                        );
                    })}
                </div>
                <button
                    type="button"
                    onClick={() => { onUngroup(); setOpen(false); }}
                    className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-surface-subtle text-content-primary"
                >
                    Ungroup
                </button>
            </PopoverContent>
        </Popover>
    );
}
```

- [ ] **Step 2: Wire it into `GroupNode.tsx`.** Add import + usage. Also pull in `updateNode` and `ungroupNode` from the store. Add to imports near the top:

```ts
import { GroupHeaderToolbar } from './GroupHeaderToolbar';
```

Inside the component, after the existing `useAppStore` calls:

```ts
const updateNode = useAppStore((s) => s.updateNode);
const ungroupNode = useAppStore((s) => s.ungroupNode);

const handleIconChange = useCallback((icon: string) => {
    updateNode(id, { config: { ...data.config, icon } });
}, [id, data.config, updateNode]);

const handleColorChange = useCallback((color: 'neutral' | 'indigo' | 'emerald' | 'rose' | 'amber' | 'sky') => {
    updateNode(id, { config: { ...data.config, color } });
}, [id, data.config, updateNode]);

const handleUngroup = useCallback(() => {
    ungroupNode(id);
}, [id, ungroupNode]);
```

In the title bubble, after the title button/input (where the contents go), append the toolbar:

```tsx
<GroupHeaderToolbar
    currentIcon={iconName}
    currentColor={colorToken as any}
    onIconChange={handleIconChange}
    onColorChange={handleColorChange}
    onUngroup={handleUngroup}
/>
```

- [ ] **Step 3: Verify in dev server**

Run: `npm run dev`

Manually:
1. On a canvas with a group_container, click the `⋯` button next to the title.
2. Click each color swatch — body tint and border update live.
3. Click each icon — title bubble icon updates live.
4. Click "Ungroup" — group disappears, child nodes survive in absolute positions (the store's existing `ungroupNode` handles this).

- [ ] **Step 4: Commit**

```bash
git add components/editor/GroupHeaderToolbar.tsx components/editor/GroupNode.tsx
git commit -m "feat(groups): icon + color picker popover with ungroup action"
```

---

### Task 0.4: Verify `updateNode` accepts partial config merge

**Files:**
- Read: `lib/store/slices/workflow-slice.ts` (around the `updateNode` action)

The toolbar's `handleIconChange` spreads `...data.config` so a partial update is safe. But verify the store's `updateNode` does a shallow merge on `data` (not a wholesale replace) so other config fields (`width`, `height`) aren't dropped.

- [ ] **Step 1: Read the action.**

Run: `grep -n "updateNode:" lib/store/slices/workflow-slice.ts | head -5`

Open the file and read the `updateNode` action body.

- [ ] **Step 2: If `updateNode` does NOT shallow-merge `data.config`**, change the toolbar to use the existing `renameGroup`/`resizeGroup` precedent — i.e., add new store actions `setGroupIcon(id, icon)` and `setGroupColor(id, color)` in `lib/store/slices/workflow-slice.ts` that do an explicit merge, plus declare them in `lib/store/types.ts`. Wire the toolbar to those instead.

If `updateNode` already merges correctly, no code change.

- [ ] **Step 3: Commit if any change happened**

```bash
git add lib/store/slices/workflow-slice.ts lib/store/types.ts components/editor/GroupHeaderToolbar.tsx components/editor/GroupNode.tsx
git commit -m "feat(groups): explicit setGroupIcon/setGroupColor store actions"
```

---

## Milestone 1 — Manual create-group canvas action

The store already has `ungroupNode`. We add `createGroupFromSelection` and a keyboard shortcut + canvas button.

### Task 1.1: Add `createGroupFromSelection` store action

**Files:**
- Modify: `lib/store/types.ts`
- Modify: `lib/store/slices/workflow-slice.ts`

- [ ] **Step 1: Add the action signature to `lib/store/types.ts`** (near the existing group actions around line 122–139):

```ts
/**
 * Wrap the given node IDs in a new group_container. The new group is positioned
 * at the bounding box of the selection minus padding (24px X, 56px Y for header).
 * Children's positions become relative to the new group; their parentNode is set.
 *
 * Validation (caller's responsibility — store does not enforce):
 * - All IDs must exist on the canvas.
 * - None of the nodes may already be inside another group (parentNode unset).
 * - None may BE a group_container.
 *
 * Returns the new group's id, or null if validation fails.
 */
createGroupFromSelection: (
    nodeIds: string[],
    options?: { label?: string; icon?: string; color?: string }
) => string | null;
```

- [ ] **Step 2: Implement the action in `lib/store/slices/workflow-slice.ts`** (place near `ungroupNode` around line 683):

```ts
createGroupFromSelection: (nodeIds, options) => {
    const state = get();
    const nodes = state.workflow.nodes;
    const selected = nodes.filter((n: any) => nodeIds.includes(n.id));

    if (selected.length < 2) return null;
    if (selected.some((n: any) => n.parentNode)) return null;
    if (selected.some((n: any) => n.type === 'group_container')) return null;

    // Bounding box from absolute positions.
    const xs = selected.map((n: any) => n.position.x);
    const ys = selected.map((n: any) => n.position.y);
    const ws = selected.map((n: any) => n.measured?.width ?? n.width ?? 240);
    const hs = selected.map((n: any) => n.measured?.height ?? n.height ?? 120);

    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs.map((x: number, i: number) => x + ws[i]));
    const maxY = Math.max(...ys.map((y: number, i: number) => y + hs[i]));

    const PAD_X = 24;
    const PAD_Y_TOP = 56; // header
    const PAD_Y_BOT = 24;

    const groupPos = { x: minX - PAD_X, y: minY - PAD_Y_TOP };
    const groupWidth = (maxX - minX) + PAD_X * 2;
    const groupHeight = (maxY - minY) + PAD_Y_TOP + PAD_Y_BOT;

    const groupId = `group-${Math.random().toString(36).slice(2, 10)}`;

    const groupNode: any = {
        id: groupId,
        type: 'group_container',
        position: groupPos,
        data: {
            label: options?.label ?? 'Group',
            config: {
                width: groupWidth,
                height: groupHeight,
                icon: options?.icon ?? 'Folder',
                color: options?.color ?? 'neutral',
            },
        },
        zIndex: -1, // groups render below children
    };

    set((s: any) => {
        const updatedChildren = s.workflow.nodes.map((n: any) => {
            if (!nodeIds.includes(n.id)) return n;
            return {
                ...n,
                parentNode: groupId,
                position: {
                    x: n.position.x - groupPos.x,
                    y: n.position.y - groupPos.y,
                },
            };
        });
        // Group goes BEFORE its children in the array — React Flow requires
        // the parent to appear earlier than its children.
        const others = updatedChildren.filter((n: any) => !nodeIds.includes(n.id));
        const children = updatedChildren.filter((n: any) => nodeIds.includes(n.id));
        s.workflow.nodes = [...others, groupNode, ...children];
    });

    return groupId;
},
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/store/types.ts lib/store/slices/workflow-slice.ts
git commit -m "feat(groups): createGroupFromSelection store action"
```

---

### Task 1.2: Wire `Cmd/Ctrl + G` shortcut + canvas button

**Files:**
- Modify: `components/editor/EditorCanvas.tsx`

- [ ] **Step 1: Read the existing keyboard handlers** (`grep -n "onKeyDown\|useHotkeys\|keyboard" components/editor/EditorCanvas.tsx | head -20`) to find where keyboard shortcuts are handled. Add a new effect or extend the existing handler to listen for `(Ctrl|Cmd) + G`.

```tsx
import { useEffect } from 'react';
// ... existing imports

// Inside the component, after other useEffect hooks:
useEffect(() => {
    function onKey(e: KeyboardEvent) {
        const isMod = e.metaKey || e.ctrlKey;
        if (!isMod) return;
        if (e.key.toLowerCase() !== 'g') return;
        // Ignore inside text inputs.
        const target = e.target as HTMLElement | null;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

        e.preventDefault();

        const selectedNodes = useAppStore.getState().workflow.nodes.filter((n: any) => n.selected);
        if (selectedNodes.length < 2) return;
        if (selectedNodes.some((n: any) => n.parentNode || n.type === 'group_container')) return;

        useAppStore.getState().createGroupFromSelection(selectedNodes.map((n: any) => n.id));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
}, []);
```

(If `EditorCanvas` already centralizes keyboard handling, fold this into the existing handler instead of adding a duplicate listener.)

- [ ] **Step 2: Add a "Group selection" button to the canvas multi-select toolbar** if one exists. Search: `grep -n "NodeToolbar\|multi-?select\|Toolbar" components/editor/*.tsx | head -10`. If the toolbar component is `components/editor/MultiSelectionToolbar.tsx` (or similar), add a button:

```tsx
<button
    type="button"
    disabled={!canGroupSelection /* boolean derived from selection state */}
    onClick={() => createGroupFromSelection(selectedIds)}
    className="..."
    title="Group (Cmd+G)"
>
    <Folder size={14} />
</button>
```

If no multi-selection toolbar exists, skip the button — the keyboard shortcut is enough for v1.

- [ ] **Step 3: Verify in dev server**

Run: `npm run dev`

Manually:
1. Open `/chat` or the editor, multi-select 2+ ungrouped nodes (drag a selection box or shift-click).
2. Press `Cmd+G` (Mac) or `Ctrl+G` (Win).
3. Verify: a group_container appears around the selection; children's `parentNode` is set; dragging the group moves children together.
4. Click `⋯` on the group → Ungroup → children survive in their absolute positions.

- [ ] **Step 4: Commit**

```bash
git add components/editor/EditorCanvas.tsx components/editor/MultiSelectionToolbar.tsx 2>/dev/null
git commit -m "feat(groups): Cmd+G shortcut to group selected nodes"
```

---

## Milestone 2 — Tool & protocol changes

Define the `Task` type, extend `propose_plan`, expose `data.label`, add new stream events, capture tasks in the brain. No execution behavior change yet — just protocol.

### Task 2.1: Define `Task` type in protocol.ts

**Files:**
- Modify: `lib/chat/streaming/protocol.ts`

- [ ] **Step 1: Add `TaskBlueprint` and `TaskGroup` types, extend `PlanPayload`.**

Replace the existing `PlanPayload` interface (lines 10–20) with:

```ts
export interface TaskGroup {
  label: string;        // ≤40 chars
  icon: string;         // Lucide PascalCase name; falls back to 'Folder' if unknown
  color?: 'neutral' | 'indigo' | 'emerald' | 'rose' | 'amber' | 'sky';
}

export interface TaskBlueprint {
  id: string;           // model-supplied, scoped to this plan (e.g. 'scene_1')
  title: string;        // ≤60 chars
  summary: string;      // ≤140 chars
  group?: TaskGroup;    // optional — present when this task is a logical section
  nodes: any[];         // same item shape as add_node.nodes[]
  edges: any[];         // same item shape as add_node.edges[]
}

export interface PlanPayload {
  title: string;
  summary: string;
  arrows: string;
  models: string[];
  detail: string;
  // Exactly one of:
  blueprint?: { nodes?: any[]; edges?: any[] };
  tasks?: TaskBlueprint[];
}
```

- [ ] **Step 2: Add new stream events.** Append to the `StreamEvent` union (around line 36–46):

```ts
  | { type: 'task_start'; taskId: string; index: number; total: number }
  | { type: 'task_complete'; taskId: string; index: number; total: number }
  | { type: 'tasks_complete'; total: number }
```

- [ ] **Step 3: Update the order-guarantee comment** (lines 22–35) to note tasks events:

```ts
/**
 * NDJSON stream events emitted by the new chat brain.
 * One JSON object per line, terminated by '\n'.
 *
 * Order guarantee per turn:
 *   [thinking_start] [thinking_delta]* [thinking_end]
 *   [text]*
 *   [tool]*
 *   [clarification?]
 *   [plan?]            ← never coexists with [tool] or [clarification]
 *
 * Plan-approve branch (sequential tasks):
 *   for each task i:
 *     [task_start]
 *     [tool]
 *     [task_complete]
 *   [tasks_complete]
 *   [usage]
 *   [done]
 */
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: PASS. The new types are additive; existing usages of `PlanPayload` only read existing fields.

- [ ] **Step 5: Commit**

```bash
git add lib/chat/streaming/protocol.ts
git commit -m "feat(chat): add Task types and task_start/complete/tasks_complete stream events"
```

---

### Task 2.2: Extend `propose_plan` tool schema

**Files:**
- Modify: `lib/chat/tools/definitions.ts`

- [ ] **Step 1: Extract a shared `taskSchema` and add `data.label` to `nodesEdgesSchema.nodes.items.properties.data`.**

After the `nodesEdgesSchema` definition (lines 43–83), add:

```ts
const taskGroupSchema = {
  type: 'object' as const,
  properties: {
    label: { type: 'string', maxLength: 40 },
    icon:  { type: 'string', description: 'Lucide PascalCase name (Folder, Film, Camera, ...). Falls back to Folder if unknown.' },
    color: { type: 'string', enum: ['neutral', 'indigo', 'emerald', 'rose', 'amber', 'sky'] },
  },
  required: ['label', 'icon'],
} as const;

const taskSchema = {
  type: 'object' as const,
  properties: {
    id: { type: 'string', description: 'Model-supplied id scoped to this plan (e.g. "scene_1").' },
    title: { type: 'string', maxLength: 60, description: 'Shown in the task checklist.' },
    summary: { type: 'string', maxLength: 140, description: 'One-line description.' },
    group: taskGroupSchema,
    nodes: nodesEdgesSchema.nodes,
    edges: nodesEdgesSchema.edges,
  },
  required: ['id', 'title', 'summary', 'nodes', 'edges'],
} as const;
```

In `nodesEdgesSchema.nodes.items.properties`, the `data` property currently allows arbitrary config. Add an explicit `label` field so the model knows it's available:

```ts
data: {
  type: 'object',
  properties: {
    label: {
      type: 'string',
      maxLength: 40,
      description: 'Optional custom label for this node — overrides the default label. Use only when a custom name materially aids comprehension. Same language as the user.'
    },
    config: { type: 'object', additionalProperties: true }
  },
  required: ['config'],
  description: 'Node config matching the registry aiSchema. Optional `label` overrides the default node title.'
},
```

- [ ] **Step 2: Add `tasks` to the `propose_plan` tool schema.** Locate the `propose_plan` definition (lines 162–218) and:

1. Make `blueprint` optional in `properties.required` (remove `'blueprint'` from the required list).
2. Add `tasks` next to `blueprint`.
3. Update the `description` to reflect both modes.

```ts
{
  name: 'propose_plan',
  description:
    'Propose a workflow plan for the user to approve before building. ' +
    'Use ONLY for genuinely complex requests where guessing wrong would ' +
    'waste real work. The plan can be a single blueprint (default) OR a ' +
    'sequential list of tasks for multi-section workflows. Use tasks ONLY ' +
    'when the workflow has 2+ logically independent sections — each task ' +
    'is one recognizable build chunk. Do NOT use propose_plan in the same ' +
    'turn as ask_clarification or add_node/update_node/remove_node.',
  input_schema: {
    type: 'object',
    properties: {
      title:   { type: 'string', maxLength: 60 },
      summary: { type: 'string', maxLength: 240 },
      arrows:  { type: 'string', maxLength: 240 },
      models: {
        type: 'array',
        items: { type: 'string', maxLength: 60 },
        maxItems: 6,
      },
      detail:  { type: 'string', maxLength: 1200 },
      // Exactly one of blueprint or tasks (validated in handlers.ts).
      blueprint: {
        type: 'object',
        description: 'Single-blueprint mode. Omit when using tasks.',
        properties: {
          nodes: nodesEdgesSchema.nodes,
          edges: nodesEdgesSchema.edges,
        },
      },
      tasks: {
        type: 'array',
        description: 'Sequential task list. Use ONLY when the workflow has 2+ logically independent sections. Omit for single-blueprint plans.',
        items: taskSchema,
        minItems: 1,
      },
    },
    required: ['title', 'summary', 'arrows', 'models', 'detail'],
  },
},
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/chat/tools/definitions.ts
git commit -m "feat(chat): add tasks[] to propose_plan and data.label to add_node"
```

---

### Task 2.3: Add `validateTaskList` and integrate into brain.ts

**Files:**
- Modify: `lib/chat/tools/handlers.ts`
- Modify: `lib/chat/brain.ts`

- [ ] **Step 1: Add `validateTaskList` to `lib/chat/tools/handlers.ts`** alongside the existing `validateBlueprint`. Find `validateBlueprint` (`grep -n "validateBlueprint" lib/chat/tools/handlers.ts`) and after it, add:

```ts
/**
 * Dry-run validation for a task list. Each task's blueprint goes through
 * the same checks as a single-blueprint propose_plan. The shared idMap
 * accumulates across tasks so a later task may reference an earlier
 * task's temp id.
 *
 * Returns ok: false with the first failure's task index + error.
 */
export function validateTaskList(
  state: ToolHandlerState,
  tasks: any[] | null | undefined
): { ok: true } | { ok: false; taskIndex: number; error: string } {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return { ok: false, taskIndex: -1, error: 'tasks must be a non-empty array.' };
  }

  // Shadow state — we don't want validation to mutate the real handler state.
  const shadow: ToolHandlerState = {
    workflow: { ...state.workflow, nodes: [...state.workflow.nodes], edges: [...state.workflow.edges] } as any,
    idMap: new Map(state.idMap),
    aiModelHandles: state.aiModelHandles,
  };

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (!t || typeof t !== 'object') return { ok: false, taskIndex: i, error: 'task must be an object.' };
    if (typeof t.id !== 'string' || t.id.length === 0) return { ok: false, taskIndex: i, error: 'task.id required.' };
    if (typeof t.title !== 'string' || t.title.length === 0) return { ok: false, taskIndex: i, error: 'task.title required.' };
    if (typeof t.summary !== 'string') return { ok: false, taskIndex: i, error: 'task.summary required.' };
    if (!Array.isArray(t.nodes) || !Array.isArray(t.edges)) return { ok: false, taskIndex: i, error: 'task.nodes and task.edges must be arrays.' };

    if (t.group !== undefined) {
      if (!t.group || typeof t.group !== 'object') return { ok: false, taskIndex: i, error: 'task.group must be an object when present.' };
      if (typeof t.group.label !== 'string' || t.group.label.length === 0) return { ok: false, taskIndex: i, error: 'task.group.label required.' };
      if (typeof t.group.icon !== 'string' || t.group.icon.length === 0) return { ok: false, taskIndex: i, error: 'task.group.icon required.' };
      if (t.group.color !== undefined && !['neutral','indigo','emerald','rose','amber','sky'].includes(t.group.color)) {
        return { ok: false, taskIndex: i, error: 'task.group.color must be one of: neutral, indigo, emerald, rose, amber, sky.' };
      }
    }

    // Validate the task's blueprint chunk in the shadow state. validateBlueprint
    // mutates the shadow's idMap as it would in a real apply — that's what we
    // want, so a later task referencing this task's ids will resolve.
    const v = validateBlueprint(shadow, { nodes: t.nodes, edges: t.edges });
    if (!v.ok) return { ok: false, taskIndex: i, error: v.error };
  }

  return { ok: true };
}
```

(If `validateBlueprint` is not exported, export it. If it doesn't currently mutate the idMap on dry-run, refactor to take a `shadow: ToolHandlerState` parameter that it can mutate without touching the live state.)

- [ ] **Step 2: Update `propose_plan` handling in `lib/chat/brain.ts`** (lines 136–193) to support both modes. Replace the `propose_plan` block:

```ts
if (name === 'propose_plan') {
  const args = (event.args ?? {}) as Record<string, unknown>;

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
  const rawModels = args.models;
  if (!Array.isArray(rawModels) || !rawModels.every(m => typeof m === 'string')) {
    input.encoder.send({
      type: 'error',
      message: 'propose_plan.models must be an array of strings (may be empty).',
      recoverable: true,
    });
    break;
  }

  const hasTasks = Array.isArray(args.tasks) && (args.tasks as any[]).length > 0;
  const hasBlueprint = !!args.blueprint && typeof args.blueprint === 'object';

  if (hasTasks && hasBlueprint) {
    input.encoder.send({
      type: 'error',
      message: 'propose_plan must use EITHER blueprint OR tasks — never both.',
      recoverable: true,
    });
    break;
  }
  if (!hasTasks && !hasBlueprint) {
    input.encoder.send({
      type: 'error',
      message: 'propose_plan requires either a blueprint or a non-empty tasks[] array.',
      recoverable: true,
    });
    break;
  }

  if (hasTasks) {
    const validation = validateTaskList(state, args.tasks as any[]);
    if (!validation.ok) {
      input.encoder.send({
        type: 'error',
        message: `propose_plan tasks invalid (task ${validation.taskIndex}): ${validation.error}`,
        recoverable: true,
      });
      break;
    }
  } else {
    const blueprint = args.blueprint as { nodes?: any[]; edges?: any[] } | null;
    const validation = validateBlueprint(state, blueprint);
    if (!validation.ok) {
      input.encoder.send({
        type: 'error',
        message: `propose_plan blueprint invalid: ${validation.error}`,
        recoverable: true,
      });
      break;
    }
  }

  if (!plan) {
    plan = {
      title: String(args.title).trim(),
      summary: String(args.summary).trim(),
      arrows: String(args.arrows).trim(),
      models: rawModels as string[],
      detail: String(args.detail).trim(),
      blueprint: hasBlueprint
        ? {
            nodes: Array.isArray((args.blueprint as any)?.nodes) ? (args.blueprint as any).nodes : [],
            edges: Array.isArray((args.blueprint as any)?.edges) ? (args.blueprint as any).edges : [],
          }
        : undefined,
      tasks: hasTasks ? (args.tasks as any[]) : undefined,
    };
    input.encoder.send({ type: 'plan', plan });
  }
  break;
}
```

Add `validateTaskList` to the imports at the top of `brain.ts`:

```ts
import { dispatchTool, validateBlueprint, validateTaskList, type ToolHandlerState } from './tools/handlers';
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Logic test script.** Create `scripts/verify-validate-tasklist.js`:

```js
// Quick check that validateTaskList accepts a well-formed list and rejects
// malformed ones. Run with: node scripts/verify-validate-tasklist.js
const path = require('path');
require('ts-node/register/transpile-only');

const { validateTaskList } = require('../lib/chat/tools/handlers');

function makeState() {
  return {
    workflow: { name: 'test', nodes: [], edges: [] },
    idMap: new Map(),
    aiModelHandles: new Map(),
  };
}

const ok = validateTaskList(makeState(), [
  {
    id: 'task_1',
    title: 'First scene',
    summary: 'One',
    nodes: [{ id: 'p1', type: 'prompt', position: { x: 0, y: 0 }, data: { config: { prompt: 'hello' } } }],
    edges: [],
  },
]);
console.log('non-empty list:', ok.ok ? 'PASS' : 'FAIL — ' + ok.error);

const empty = validateTaskList(makeState(), []);
console.log('empty list:', !empty.ok ? 'PASS' : 'FAIL');

const bothFlavors = validateTaskList(makeState(), [
  { id: 't', title: 't', summary: '', nodes: [], edges: [], group: { label: '', icon: 'X' } },
]);
console.log('empty group label:', !bothFlavors.ok ? 'PASS' : 'FAIL');
```

Run: `node scripts/verify-validate-tasklist.js`
Expected output:
```
non-empty list: PASS
empty list: PASS
empty group label: PASS
```

If `ts-node` isn't a dependency, install it ad-hoc: `npm i -D ts-node` (commit the dep change too).

- [ ] **Step 5: Commit**

```bash
git add lib/chat/tools/handlers.ts lib/chat/brain.ts scripts/verify-validate-tasklist.js package.json package-lock.json
git commit -m "feat(chat): validateTaskList + propose_plan tasks-mode handling"
```

---

### Task 2.4: Verify single-blueprint plans still work end-to-end

**Files:**
- (verification only)

- [ ] **Step 1: Run dev server.** `npm run dev`

- [ ] **Step 2: Manual test.** In `/chat`, send a request that should trigger a single-blueprint plan: "Build me a simple workflow that generates a cat image and applies a slight blur."

- [ ] **Step 3: Verify**
1. The plan card appears with the existing single-blueprint layout (no checklist).
2. Click Approve.
3. Nodes appear on canvas — exactly the existing behavior, no regressions.
4. No `task_*` events should appear in the network NDJSON stream — only the existing event types.

- [ ] **Step 4: No commit needed** — verification only.

---

## Milestone 3 — Sequential apply loop

Server-side: `handlePlanApprove` learns to apply tasks sequentially with group synthesis and progress persistence.

### Task 3.1: Create `lib/chat/config.ts`

**Files:**
- Create: `lib/chat/config.ts`

- [ ] **Step 1: Write the file.**

```ts
/**
 * Tunable constants for the chat brain and approve/apply loop.
 * Kept in one place so they can be adjusted without grepping the codebase.
 */

/** Pause between sequential task applications, in milliseconds. */
export const STAGING_DELAY_MS = 600;

/** Padding around children when synthesizing a group_container. */
export const GROUP_PADDING_X = 24;
export const GROUP_PADDING_Y_TOP = 56;     // header
export const GROUP_PADDING_Y_BOTTOM = 24;
```

- [ ] **Step 2: Commit**

```bash
git add lib/chat/config.ts
git commit -m "feat(chat): add config.ts with STAGING_DELAY_MS and group padding constants"
```

---

### Task 3.2: Create `lib/chat/task-loop.ts` with helpers

**Files:**
- Create: `lib/chat/task-loop.ts`

- [ ] **Step 1: Write the helpers.**

```ts
import {
  GROUP_PADDING_X,
  GROUP_PADDING_Y_TOP,
  GROUP_PADDING_Y_BOTTOM,
} from './config';
import type { TaskBlueprint } from './streaming/protocol';

/** Sleep helper. */
export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Given a task with a `group` descriptor, produce the augmented nodes/edges
 * arrays the server will pass to `dispatchTool('add_node', ...)`. The synthesis
 * is deterministic and lives server-side — the model declares "these nodes go
 * in a group called X with icon Y" and we materialize the container.
 *
 * Returns the original arrays unchanged when task.group is absent.
 */
export function synthesizeTaskBlueprint(task: TaskBlueprint): { nodes: any[]; edges: any[] } {
  if (!task.group) {
    return { nodes: task.nodes, edges: task.edges };
  }

  const xs = task.nodes.map((n: any) => n.position?.x ?? 0);
  const ys = task.nodes.map((n: any) => n.position?.y ?? 0);
  const ws = task.nodes.map((n: any) => n.measured?.width ?? n.width ?? 240);
  const hs = task.nodes.map((n: any) => n.measured?.height ?? n.height ?? 120);

  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs.map((x: number, i: number) => x + ws[i]));
  const maxY = Math.max(...ys.map((y: number, i: number) => y + hs[i]));

  const groupPos = { x: minX - GROUP_PADDING_X, y: minY - GROUP_PADDING_Y_TOP };
  const groupWidth = (maxX - minX) + GROUP_PADDING_X * 2;
  const groupHeight = (maxY - minY) + GROUP_PADDING_Y_TOP + GROUP_PADDING_Y_BOTTOM;

  const groupId = `group_${task.id}`;

  const groupNode = {
    id: groupId,
    type: 'group_container',
    position: groupPos,
    data: {
      label: task.group.label,
      config: {
        width: groupWidth,
        height: groupHeight,
        icon: task.group.icon,
        color: task.group.color ?? 'neutral',
      },
    },
    zIndex: -1,
  };

  // Children become parent-relative.
  const children = task.nodes.map((n: any) => ({
    ...n,
    parentNode: groupId,
    position: {
      x: (n.position?.x ?? 0) - groupPos.x,
      y: (n.position?.y ?? 0) - groupPos.y,
    },
  }));

  // Group BEFORE its children — React Flow requires parent-first order.
  return {
    nodes: [groupNode, ...children],
    edges: task.edges,
  };
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Logic test script.** Create `scripts/verify-synthesize-group.js`:

```js
// Run with: node scripts/verify-synthesize-group.js
require('ts-node/register/transpile-only');
const { synthesizeTaskBlueprint } = require('../lib/chat/task-loop');

const out = synthesizeTaskBlueprint({
  id: 'scene_1',
  title: 't',
  summary: 's',
  group: { label: 'Scene 1', icon: 'Film', color: 'indigo' },
  nodes: [
    { id: 'p1', type: 'prompt',     position: { x: 100, y: 100 }, data: { config: {} } },
    { id: 'g1', type: 'ai_generator', position: { x: 300, y: 100 }, data: { config: {} } },
  ],
  edges: [],
});

console.log('nodes count:', out.nodes.length === 3 ? 'PASS' : 'FAIL');
console.log('group first:', out.nodes[0].id === 'group_scene_1' ? 'PASS' : 'FAIL');
console.log('group icon:', out.nodes[0].data.config.icon === 'Film' ? 'PASS' : 'FAIL');
console.log('group color:', out.nodes[0].data.config.color === 'indigo' ? 'PASS' : 'FAIL');
console.log('child parented:', out.nodes[1].parentNode === 'group_scene_1' ? 'PASS' : 'FAIL');
console.log('child relative:', out.nodes[1].position.x === 100 - (100 - 24) ? 'PASS' : 'FAIL');
```

Run: `node scripts/verify-synthesize-group.js`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/chat/task-loop.ts scripts/verify-synthesize-group.js
git commit -m "feat(chat): task-loop helpers — sleep + synthesizeTaskBlueprint"
```

---

### Task 3.3: Extend `handlePlanApprove` with sequential task application

**Files:**
- Modify: `app/api/chat/stream/route.ts`

This is the largest change in this milestone. We're adding a tasks branch to the existing approve handler. The existing single-blueprint path is preserved verbatim.

- [ ] **Step 1: Read the current `handlePlanApprove`** (lines 28–218) so you understand its single-blueprint flow before changing it.

- [ ] **Step 2: Add imports.** Near the top of the file:

```ts
import { synthesizeTaskBlueprint, sleep } from '@/lib/chat/task-loop';
import { STAGING_DELAY_MS } from '@/lib/chat/config';
```

- [ ] **Step 3: After the existing blueprint extraction (around line 70 — `const blueprint = planRow.metadata?.plan?.blueprint`), also extract `tasks`:**

```ts
const blueprint = planRow.metadata?.plan?.blueprint;
const tasks = planRow.metadata?.plan?.tasks;

if (!blueprint && !(Array.isArray(tasks) && tasks.length > 0)) {
  encoder.send({
    type: 'error',
    message: 'Plan has no blueprint or tasks to apply.',
    recoverable: false,
  });
  encoder.send({ type: 'done' });
  encoder.close();
  return;
}
```

(Replace the existing `if (!blueprint)` check.)

- [ ] **Step 4: After the existing `state` initialization (around line 130), branch on tasks vs blueprint.**

Replace the section from `// 5. Apply via dispatchTool('add_node', blueprint).` through the end of the success path with:

```ts
// 5. Apply — single blueprint or sequential tasks.
const isTasks = Array.isArray(tasks) && tasks.length > 0;

if (!isTasks) {
  // Original single-blueprint path — unchanged.
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

  // 6. Persist user message + canvas_state.  (existing code)
  const dbOps: Promise<any>[] = [];
  dbOps.push(
    Promise.resolve(supabase.from('messages').insert({
      ...(userMessageId ? { id: userMessageId } : {}),
      session_id: sessionId,
      role: 'user',
      content: lastUserContent || 'Approved',
      status: 'completed',
      metadata: { plan_answer: { planMessageId: planAnswer.planMessageId, action: 'approve' } },
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

  if (result.patch) {
    encoder.send({ type: 'tool', name: 'add_node', patch: result.patch });
  }
  encoder.send({ type: 'usage', inputTokens: 0, outputTokens: 0, thinkingTokens: 0, costUsd: 0 });
  encoder.send({ type: 'done' });
  encoder.close();
  return;
}

// Tasks-mode path.
// Persist the user-approval message ONCE upfront (same content as today).
await supabase.from('messages').insert({
  ...(userMessageId ? { id: userMessageId } : {}),
  session_id: sessionId,
  role: 'user',
  content: lastUserContent || 'Approved',
  status: 'completed',
  metadata: { plan_answer: { planMessageId: planAnswer.planMessageId, action: 'approve' } },
  created_at: new Date().toISOString(),
});

// Initial taskProgress on the assistant plan row.
const total = tasks.length;
await supabase
  .from('messages')
  .update({
    metadata: {
      ...planRow.metadata,
      taskProgress: { status: 'running', currentIndex: 0, total, failedTaskId: null },
    },
  })
  .eq('id', planAnswer.planMessageId);

let failed = false;
let failedTaskId: string | null = null;

for (let i = 0; i < tasks.length; i++) {
  const task = tasks[i];
  encoder.send({ type: 'task_start', taskId: task.id, index: i, total });

  const augmented = synthesizeTaskBlueprint(task);
  const result = dispatchTool(state, 'add_node', augmented);
  if (!result.success) {
    failed = true;
    failedTaskId = task.id;
    encoder.send({
      type: 'error',
      message: `Task "${task.title}" failed: ${result.error || 'unknown error'}`,
      recoverable: true,
    });
    break;
  }

  if (result.patch) {
    encoder.send({ type: 'tool', name: 'add_node', patch: result.patch });
  }

  // Persist incremental updates after each task.
  await Promise.all([
    supabase.from('sessions').update({
      canvas_state: { nodes: state.workflow.nodes, edges: state.workflow.edges },
      updated_at: new Date().toISOString(),
    }).eq('id', sessionId),
    supabase.from('messages').update({
      metadata: {
        ...planRow.metadata,
        taskProgress: { status: 'running', currentIndex: i + 1, total, failedTaskId: null },
      },
    }).eq('id', planAnswer.planMessageId),
  ]);

  encoder.send({ type: 'task_complete', taskId: task.id, index: i, total });

  if (i < tasks.length - 1) {
    await sleep(STAGING_DELAY_MS);
  }
}

// Final taskProgress update.
const finalProgress = failed
  ? { status: 'failed' as const, currentIndex: tasks.findIndex((t: any) => t.id === failedTaskId), total, failedTaskId }
  : { status: 'done' as const, currentIndex: total, total, failedTaskId: null };

await supabase
  .from('messages')
  .update({
    metadata: {
      ...planRow.metadata,
      taskProgress: finalProgress,
    },
  })
  .eq('id', planAnswer.planMessageId);

if (!failed) {
  encoder.send({ type: 'tasks_complete', total });
}

encoder.send({ type: 'usage', inputTokens: 0, outputTokens: 0, thinkingTokens: 0, costUsd: 0 });
encoder.send({ type: 'done' });
encoder.close();
return;
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/chat/stream/route.ts
git commit -m "feat(chat): sequential task application in handlePlanApprove"
```

---

### Task 3.4: Integration script — POST a fake tasks plan and assert event order

**Files:**
- Create: `scripts/verify-task-loop-stream.js`

- [ ] **Step 1: Write the integration script.** This requires a running dev server (`npm run dev`) and a real session with an existing assistant plan row in the database. The script just inspects the wire format.

```js
// Run with the dev server running on :3000:
//   node scripts/verify-task-loop-stream.js <sessionId> <planMessageId>
//
// Asserts the stream emits task_start/task_complete pairs in order
// and ends with tasks_complete + done.

const fetch = require('node-fetch');

async function main() {
  const sessionId = process.argv[2];
  const planMessageId = process.argv[3];
  if (!sessionId || !planMessageId) {
    console.error('Usage: node scripts/verify-task-loop-stream.js <sessionId> <planMessageId>');
    process.exit(1);
  }

  const res = await fetch('http://localhost:3000/api/chat/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Approved' }],
      sessionId,
      planAnswer: { planMessageId, action: 'approve' },
    }),
  });

  if (!res.ok) {
    console.error('HTTP', res.status, await res.text());
    process.exit(1);
  }

  const reader = res.body;
  let buf = '';
  const events = [];
  for await (const chunk of reader) {
    buf += chunk.toString('utf8');
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      events.push(JSON.parse(line));
    }
  }

  const types = events.map((e) => e.type);
  console.log('Event sequence:', types.join(' '));

  const taskStarts = events.filter((e) => e.type === 'task_start');
  const taskCompletes = events.filter((e) => e.type === 'task_complete');
  const tasksComplete = events.find((e) => e.type === 'tasks_complete');

  console.log('task_start count =', taskStarts.length);
  console.log('task_complete count =', taskCompletes.length);
  console.log('counts match:', taskStarts.length === taskCompletes.length ? 'PASS' : 'FAIL');
  console.log('indices ascend:',
    taskStarts.every((e, i) => e.index === i) ? 'PASS' : 'FAIL');
  console.log('tasks_complete present:', tasksComplete ? 'PASS' : 'FAIL');
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run the integration test.** Manually:
1. Start dev server: `npm run dev`
2. In another shell, open `/chat`, request something that produces a tasks plan (e.g. "Build a 3-scene short video").
3. Note the `sessionId` (URL or DB) and the `planMessageId` (from the assistant message DB row or React DevTools).
4. Run: `node scripts/verify-task-loop-stream.js <sessionId> <planMessageId>`

Expected: all PASS lines. Event sequence shows `task_start tool task_complete` repeated N times, then `tasks_complete`.

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-task-loop-stream.js
git commit -m "test(chat): integration script for task-loop stream event order"
```

---

## Milestone 4 — UI: PlanCard task-list mode + TaskProgressCard

### Task 4.1: PlanCard task-list display mode

**Files:**
- Modify: `components/chat/PlanCard.tsx`

- [ ] **Step 1: Read the existing PlanCard** (`grep -n "summary\|arrows\|detail\|blueprint" components/chat/PlanCard.tsx | head -20`) to understand its current structure and props.

- [ ] **Step 2: Add a task-list display mode.** When `plan.tasks?.length > 0`, replace the blueprint preview with a checklist. The Approve/Feedback buttons stay in the same place.

Add a new `TaskList` sub-section in the same file (or extract to `TaskList.tsx` if the file gets too large):

```tsx
import * as LucideIcons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { TaskBlueprint } from '@/lib/chat/streaming/protocol';

const COLOR_CHIP: Record<string, string> = {
    neutral: 'bg-stroke-subtle/30 text-content-secondary',
    indigo:  'bg-indigo-500/15 text-indigo-300',
    emerald: 'bg-emerald-500/15 text-emerald-300',
    rose:    'bg-rose-500/15 text-rose-300',
    amber:   'bg-amber-500/15 text-amber-300',
    sky:     'bg-sky-500/15 text-sky-300',
};

function resolveIcon(name: string | undefined): LucideIcon {
    if (!name) return LucideIcons.Folder;
    const Cand = (LucideIcons as any)[name];
    return (Cand && typeof Cand === 'object') ? Cand as LucideIcon : LucideIcons.Folder;
}

function PlanTaskList({ tasks }: { tasks: TaskBlueprint[] }) {
    return (
        <ul className="flex flex-col gap-2 my-3">
            {tasks.map((t, i) => {
                const GIcon = t.group ? resolveIcon(t.group.icon) : null;
                const colorClass = t.group?.color ? COLOR_CHIP[t.group.color] : COLOR_CHIP.neutral;
                return (
                    <li key={t.id} className="flex items-start gap-2 text-sm">
                        <span className="text-content-tertiary text-xs w-4 shrink-0 mt-0.5">{i + 1}.</span>
                        <div className="flex flex-col gap-0.5 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                                {t.group && GIcon && (
                                    <span className={'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs ' + colorClass}>
                                        <GIcon size={11} />
                                        <span className="truncate max-w-[140px]">{t.group.label}</span>
                                    </span>
                                )}
                                <span className="font-medium text-content-primary truncate">{t.title}</span>
                            </div>
                            <p className="text-xs text-content-secondary leading-snug">{t.summary}</p>
                        </div>
                    </li>
                );
            })}
        </ul>
    );
}
```

In the main `PlanCard` body, swap in the task list when present. Find the render path that shows summary + arrows + detail and wrap the blueprint-preview portion conditionally:

```tsx
{plan.summary && <p className="...">{plan.summary}</p>}
{plan.arrows && <div className="...">{plan.arrows}</div>}

{plan.tasks && plan.tasks.length > 0
    ? <PlanTaskList tasks={plan.tasks} />
    : (/* existing blueprint-mode preview */ null)
}

{plan.detail && <div className="...">{plan.detail}</div>}
```

- [ ] **Step 3: Verify in dev server**

Run: `npm run dev`

Manually:
1. In `/chat`, request a multi-section workflow ("Build a 3-scene short video, ~30s total"). The model should emit a tasks plan.
2. The plan card shows the checklist with title, group chip (if group present), and summary per task.
3. Approve still works.

- [ ] **Step 4: Commit**

```bash
git add components/chat/PlanCard.tsx
git commit -m "feat(chat): PlanCard task-list display mode"
```

---

### Task 4.2: PlanCard collapsed approved state

**Files:**
- Modify: `components/chat/PlanCard.tsx`

- [ ] **Step 1: Detect approved state.** The plan card receives the assistant message it belongs to. Find where the parent passes `approved`/state info (`grep -n "approved\|plan_answer\|metadata" components/chat/PlanCard.tsx`). If the prop doesn't exist yet, derive it: a plan is "approved" when the parent message bubble's session has a sibling user message with `metadata.plan_answer.action === 'approve'` referencing this plan's id.

For simplicity, accept a new optional prop `approved?: boolean`:

```ts
interface PlanCardProps {
    plan: PlanPayload;
    approved?: boolean;          // NEW — when true, render collapsed header
    onApprove?: () => void;
    onFeedback?: (text: string) => void;
    // ... existing props
}
```

- [ ] **Step 2: Render collapsed when `approved`.** Add this branch at the top of the card body:

```tsx
const [expanded, setExpanded] = useState(false);

if (approved && !expanded) {
    const taskCount = plan.tasks?.length ?? 0;
    const summary = taskCount > 0
        ? `Approved · Building ${taskCount} task${taskCount === 1 ? '' : 's'}`
        : 'Approved';
    return (
        <button
            type="button"
            onClick={() => setExpanded(true)}
            className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg border border-stroke-subtle/40 bg-surface-elevated/40 hover:bg-surface-elevated text-xs text-content-secondary transition-colors"
        >
            <Check size={12} className="text-emerald-500 shrink-0" />
            <span className="truncate">{summary}</span>
            <span className="ml-auto text-content-tertiary">▾</span>
        </button>
    );
}
```

(Add the `Check` import: `import { Check } from 'lucide-react';`.)

- [ ] **Step 3: Wire `approved` from the message renderer.** In `components/chat/Message.tsx` or `components/chat/MessageRenderer.tsx`, pass `approved` based on whether a sibling user-approve message exists or `messageMeta.taskProgress` is present:

```tsx
const approved = !!message.metadata?.taskProgress
    || messages.some((m) =>
        m.role === 'user'
        && m.metadata?.plan_answer?.action === 'approve'
        && m.metadata?.plan_answer?.planMessageId === message.id
    );
<PlanCard plan={message.metadata.plan} approved={approved} ... />
```

(Adjust to the actual prop names in `MessageRenderer.tsx`.)

- [ ] **Step 4: Verify in dev server**

Manually:
1. Approve a tasks plan.
2. Plan card collapses to a one-line "Approved · Building N tasks" header.
3. Click it — re-expands to full plan.
4. Click again (the "▾" or somewhere in the header) — collapses again.

(Add a "▴" affordance for the expanded state if desired.)

- [ ] **Step 5: Commit**

```bash
git add components/chat/PlanCard.tsx components/chat/Message.tsx components/chat/MessageRenderer.tsx 2>/dev/null
git commit -m "feat(chat): PlanCard collapses to one-line summary after approval"
```

---

### Task 4.3: Create `TaskProgressCard` component

**Files:**
- Create: `components/chat/TaskProgressCard.tsx`

- [ ] **Step 1: Write the component.**

```tsx
'use client';

import React, { useState } from 'react';
import * as LucideIcons from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Check } from 'lucide-react';
import type { TaskBlueprint } from '@/lib/chat/streaming/protocol';

interface TaskProgress {
    status: 'running' | 'done' | 'failed';
    currentIndex: number;
    total: number;
    failedTaskId?: string | null;
    errorMessage?: string;
}

interface Props {
    tasks: TaskBlueprint[];
    progress: TaskProgress;
    onRetryFromTask?: (taskId: string) => void;
}

const COLOR_CHIP: Record<string, string> = {
    neutral: 'bg-stroke-subtle/30 text-content-secondary',
    indigo:  'bg-indigo-500/15 text-indigo-300',
    emerald: 'bg-emerald-500/15 text-emerald-300',
    rose:    'bg-rose-500/15 text-rose-300',
    amber:   'bg-amber-500/15 text-amber-300',
    sky:     'bg-sky-500/15 text-sky-300',
};

function resolveIcon(name: string | undefined): LucideIcon {
    if (!name) return LucideIcons.Folder;
    const Cand = (LucideIcons as any)[name];
    return (Cand && typeof Cand === 'object') ? Cand as LucideIcon : LucideIcons.Folder;
}

export function TaskProgressCard({ tasks, progress, onRetryFromTask }: Props) {
    const [expanded, setExpanded] = useState(progress.status !== 'done');

    if (progress.status === 'done' && !expanded) {
        const totalNodes = tasks.reduce((acc, t) => acc + t.nodes.length, 0);
        return (
            <button
                type="button"
                onClick={() => setExpanded(true)}
                className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg border border-stroke-subtle/40 bg-surface-elevated/40 hover:bg-surface-elevated text-xs text-content-secondary transition-colors mt-2"
            >
                <Check size={12} className="text-emerald-500 shrink-0" />
                <span>Built {tasks.length} task{tasks.length === 1 ? '' : 's'} · {totalNodes} node{totalNodes === 1 ? '' : 's'}</span>
                <span className="ml-auto text-content-tertiary">▾</span>
            </button>
        );
    }

    return (
        <div className="mt-2 px-3 py-3 rounded-lg border border-stroke-subtle/40 bg-surface-elevated/40">
            <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-content-primary">
                    {progress.status === 'failed' ? 'Build failed' :
                     progress.status === 'done' ? 'Build complete' :
                     'Building workflow'}
                </span>
                <span className="text-xs text-content-tertiary tabular-nums">
                    {Math.min(progress.currentIndex, progress.total)} / {progress.total}
                </span>
            </div>
            <div className="border-t border-border/40 pt-2">
                <ul className="flex flex-col gap-1.5">
                    {tasks.map((t, i) => {
                        const isDone = i < progress.currentIndex || progress.status === 'done';
                        const isActive = i === progress.currentIndex && progress.status === 'running';
                        const isFailed = progress.status === 'failed' && t.id === progress.failedTaskId;
                        const isUpcoming = !isDone && !isActive && !isFailed;

                        const GIcon = t.group ? resolveIcon(t.group.icon) : null;
                        const colorClass = t.group?.color ? COLOR_CHIP[t.group.color] : COLOR_CHIP.neutral;

                        return (
                            <li key={t.id} className="flex items-start gap-2 text-sm">
                                <span className="w-4 mt-0.5 shrink-0 flex items-center justify-center">
                                    {isDone && <Check size={12} className="text-emerald-500" />}
                                    {isActive && <span className="block h-2 w-2 rounded-full bg-accent-primary animate-pulse" />}
                                    {isFailed && <span className="block h-2 w-2 rounded-full bg-rose-500" />}
                                    {isUpcoming && <span className="block h-2 w-2 rounded-full border border-content-tertiary/50" />}
                                </span>
                                <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                        {t.group && GIcon && (
                                            <span className={'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] ' + colorClass}>
                                                <GIcon size={9} />
                                                <span className="truncate max-w-[120px]">{t.group.label}</span>
                                            </span>
                                        )}
                                        <span className={
                                            'truncate ' +
                                            (isDone || isActive ? 'text-content-primary' : 'text-content-tertiary') +
                                            (isActive ? ' font-medium' : '')
                                        }>
                                            {t.title}
                                        </span>
                                    </div>
                                    {isActive && (
                                        <span className="text-[11px] text-content-tertiary">
                                            Building {t.nodes.length} node{t.nodes.length === 1 ? '' : 's'}…
                                        </span>
                                    )}
                                    {isFailed && (
                                        <div className="text-[11px] text-rose-400 flex items-center gap-2">
                                            <span>{progress.errorMessage ?? 'Task failed'}</span>
                                            {onRetryFromTask && (
                                                <button
                                                    type="button"
                                                    onClick={() => onRetryFromTask(t.id)}
                                                    className="underline hover:text-rose-300"
                                                >
                                                    Retry from here
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            </li>
                        );
                    })}
                </ul>
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add components/chat/TaskProgressCard.tsx
git commit -m "feat(chat): TaskProgressCard component with status glyphs"
```

---

### Task 4.4: Wire `TaskProgressCard` into the message renderer

**Files:**
- Modify: `components/chat/MessageRenderer.tsx` (or wherever the assistant message body is composed — `grep -n "PlanCard" components/chat/*.tsx`)

- [ ] **Step 1: Render `TaskProgressCard` below the (collapsed) PlanCard whenever `message.metadata.taskProgress` is present.**

```tsx
import { TaskProgressCard } from './TaskProgressCard';

// ... inside the assistant message render path, after <PlanCard /> ...

{message.metadata?.plan?.tasks && message.metadata?.taskProgress && (
    <TaskProgressCard
        tasks={message.metadata.plan.tasks}
        progress={message.metadata.taskProgress}
        onRetryFromTask={(taskId) => {
            // For v1: send a feedback message with the task id baked in.
            // The brain's next-turn fewshot teaches it to revise from there.
            sendFeedback?.(`The build failed at task ${taskId}. Please revise the plan from there.`);
        }}
    />
)}
```

- [ ] **Step 2: Subscribe to message-row updates so the card re-renders during the apply loop.** The existing `useExecutionChannel` pattern (in `lib/hooks/use-execution-channel.ts`) is for `node_results`; for `messages.metadata.taskProgress` we need a similar subscription on the `messages` table. If a hook for this doesn't already exist, add one:

Create: `lib/hooks/use-message-channel.ts`

```ts
import { useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * Subscribe to UPDATE events on `messages` rows for a given session.
 * Calls `onMessageUpdate(row)` whenever a message in this session changes.
 *
 * Used to drive TaskProgressCard live updates during the approve/apply loop —
 * the server updates `metadata.taskProgress` per task, and Realtime pushes
 * the row update to all connected tabs.
 */
export function useMessageChannel(
  sessionId: string | undefined,
  onMessageUpdate: (row: any) => void,
) {
  useEffect(() => {
    if (!sessionId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`messages:${sessionId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `session_id=eq.${sessionId}` },
        (payload) => {
          onMessageUpdate(payload.new);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [sessionId, onMessageUpdate]);
}
```

Wire it into the chat page or `MessageRenderer`'s parent — wherever messages are stored — to merge the updated row's `metadata` into the message in state.

- [ ] **Step 3: Verify in dev server**

Manually:
1. Approve a tasks plan.
2. Watch the chat bubble: `PlanCard` collapses → `TaskProgressCard` appears → tasks tick green one by one → final "Built N tasks · M nodes" line.
3. Refresh mid-flight: card rehydrates from DB metadata at the last persisted `currentIndex`.

- [ ] **Step 4: Commit**

```bash
git add components/chat/MessageRenderer.tsx lib/hooks/use-message-channel.ts components/chat/Message.tsx 2>/dev/null
git commit -m "feat(chat): TaskProgressCard live updates via messages Realtime channel"
```

---

## Milestone 5 — System prompt: smarter splitting, renaming, archetypes

### Task 5.1: Amend `GROUPING` and `PLAN PROPOSAL` sections

**Files:**
- Modify: `lib/chat/prompt/system.ts`

- [ ] **Step 1: Replace the existing `GROUPING` constant** (lines 58–65) with the icon/color extension:

```ts
const GROUPING = `GROUPING:
- You may organize related nodes into a visual group by emitting a node with type 'group_container'. Use it to communicate structure when a workflow has clearly distinct sections (e.g. "input prep", "generation", "post-processing").
- Group node shape: { id: 'group_1', type: 'group_container', position: { x, y }, data: { label: '<title>', config: { width, height, icon, color } } }
  - icon: a Lucide PascalCase name like 'Film', 'Camera', 'Folder', 'Music', 'Wand2', 'Layers', 'Scissors'. Pick one that mirrors the group's purpose. Falls back to 'Folder' if unknown.
  - color: one of 'neutral' (default), 'indigo', 'emerald', 'rose', 'amber', 'sky'. Use distinct colors when sections benefit from visual separation; otherwise 'neutral'.
- To put a node into the group, set its parentNode field to the group's id in the SAME tool call that creates both. Children's positions are relative to the group's origin.
- A group has no input/output handles. NEVER add an edge whose source or target is a group node.
- Groups never execute. Do not propose a group as a way to run nodes in parallel or "wrap" execution.
- Default size when uncertain: width 400, height 300. The UI auto-expands.
- Do not group a single node. Only use groups when the user is asking for organization or when 3+ related nodes belong together.
- Users can also create groups manually on the canvas. Treat any existing group_container in the canvas summary as authoritative — add new nodes alongside or inside it as the user requests.`;
```

- [ ] **Step 2: Replace the existing `PLAN PROPOSAL` block inside `TOOL_RULES`** (lines 42–56). The full TOOL_RULES constant gains the tasks branch and the `data.label` mention:

(Add a new `TASKS` paragraph inside the PLAN PROPOSAL block, and a `TITLE RENAMING` paragraph immediately after. Keep all existing rules.)

```ts
PLAN PROPOSAL:
- Use propose_plan ONLY for genuinely complex builds where guessing wrong would waste real work: multi-section pipelines, large rewrites, builds with multiple model choices that affect creative direction, or workflows that combine 4+ nodes spanning different functional roles.
- A plan can be a single blueprint (the default) OR a list of sequential tasks via the 'tasks' field. Use tasks ONLY when the workflow has 2+ logically independent sections that each produce a recognizable output (multi-scene video, product image set with distinct angles, multi-stage pipeline with a clear checkpoint per stage). Otherwise emit a single blueprint.
- When using tasks: each task is one recognizable build chunk. Order matters — earlier tasks may produce nodes referenced by later tasks. The user approves the entire task list at once; the runtime applies them sequentially. Do NOT split a coherent unit into 2+ tasks just to look busy. Do NOT use tasks when the user asked for "just one thing".
- When a task is a logical section (a scene, an angle, a stage), give it a 'group' { label, icon, color }. When a task is plumbing (uploads, initial processing) where grouping would be noise, omit 'group'.
- Do NOT use propose_plan for: single-node updates, swapping one model for another, trivial config edits.
- Do NOT use propose_plan in the same turn as ask_clarification. Do NOT call add_node/update_node/remove_node in the same turn as propose_plan.
- The blueprint (or every task's blueprint) must be complete and apply-ready: every node fully configured per its aiSchema, every edge valid.
- Phrase title, summary, arrows, models, detail in the user's language.
- summary: ONE short sentence answering "what it does."
- arrows: ONE single-line arrow notation. No prose.
- models: use the EXACT display_name from "AI GENERATOR MODELS" so the UI can render the brand icon.
- detail: 2–4 short paragraphs OR bullet points starting with "- ". NO markdown headers.
- After feedback, emit a NEW propose_plan that ADDRESSES the feedback.
- Do NOT propose_plan again immediately after the user approves a plan.

TITLE RENAMING:
- You can override a node's default label by setting data.label. Rename ONLY when a custom label materially helps the user understand what the node does in this workflow. Examples: "AI Generator" → "Hero shot — studio light", "Compositor" → "Final overlay", "Prompt" → "Scene 2 — campfire prompt". Skip renaming for one-off utility nodes where the default is already clear (a single Blur, a single Levels). Be terse; ≤40 chars. Same language as the user.
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: PASS (system.ts is just strings).

- [ ] **Step 4: Commit**

```bash
git add lib/chat/prompt/system.ts
git commit -m "feat(chat): system prompt — tasks-mode rules + title renaming + group icon/color"
```

---

### Task 5.2: Amend `CLARIFYING QUESTIONS`, `CRITICAL_RULES`, add `TASK_SPLITTING` and `USE_CASE_ARCHETYPES`

**Files:**
- Modify: `lib/chat/prompt/system.ts`

- [ ] **Step 1: Append a multi-step paragraph to the existing `CLARIFYING QUESTIONS` block in `TOOL_RULES`** (lines 32–40). Keep all existing rules; add this paragraph after the existing list:

```ts
- Multi-step clarification: when one answer doesn't give you enough to plan, ask another targeted question on the next turn. Don't bundle questions. Stop asking the moment you have enough to commit — typically 1–3 turns. If a question can't fit chip options (e.g. "what duration?"), ask it in prose without ask_clarification; the user types the answer.
```

- [ ] **Step 2: Add new `TASK_SPLITTING` and `USE_CASE_ARCHETYPES` constants** at the top of `system.ts`, after `GROUPING`:

```ts
const TASK_SPLITTING = `TASK SPLITTING — when NOT to use tasks:
Single blueprint is the default. Avoid splitting when:
- The whole workflow is under ~5 nodes.
- The pipeline is linear with no obvious checkpoint.
- The user asked for one specific output, not a series.
- You're tempted to split just to add visible "progress" — that's not a reason.`;

const USE_CASE_ARCHETYPES = `USE-CASE ARCHETYPES (generalize from these — don't pattern-match rigidly):

Multi-scene video.
User wants a short video with 2+ distinct scenes. Clarify duration and overall style first if not given. Plan as one task per scene + a final composition task. Each scene group: a prompt node (scene description), an ai_generator (video model), optionally a media_input for reference. Compositor task ties them. Group icon: Film. Per-scene color when scenes are visually distinct.

Product image set.
User wants product images from multiple angles or settings. Clarify product type, angles, and any reference image. Plan as one task per angle/setting. Each angle group: prompt node + ai_generator + optional media_input for the product reference. No composition task. Group icon: Camera. Color them distinctly so the user can scan.

Multi-stage pipeline.
User wants an output that requires sequential transformations (e.g. background-remove → composite → color-grade → upscale). Plan as one task per stage. Each stage group: 1–2 nodes. Stages without obvious visual separation can stay ungrouped within a single task. Group icon: stage-appropriate (Scissors, Layers, Wand2, ArrowUpRightSquare).

If the user's request doesn't match any archetype, fall back to your judgment: split when sections are independent, group when 2+ nodes share a logical purpose, otherwise single blueprint with no groups.`;
```

- [ ] **Step 3: Extend `CRITICAL_RULES`** (lines 72–79) with two new rules:

```ts
const CRITICAL_RULES = `CRITICAL RULES — MUST follow:
1. Every node you add MUST have its config fully populated. NEVER emit \`data.config: {}\`...
2. For ai_generator, model_id is MANDATORY...
3. For compositor, edges into it use targetHandle: "layers"...
4. When you call a tool, emit at least one short sentence of confirmation text before the tool call.
5. Respond in the same language the user wrote in.
6. NEVER end a turn with a question that asks the user to choose between alternatives unless you ALSO call ask_clarification...
7. When you call propose_plan with a single blueprint, the blueprint must be a complete, apply-ready workflow patch.
8. When you call propose_plan with tasks, every task must contain a complete, apply-ready blueprint chunk — same validation as add_node. The runtime applies tasks in array order and won't reorder them.
9. data.label overrides are advisory: keep them ≤40 chars, in the user's language, and don't rename utility nodes unless it adds real comprehension value.`;
```

(Preserve the full text of rules 1–6; rules 7, 8, 9 above either replace 7 or add 8 and 9 — adjust to match the actual line content.)

- [ ] **Step 4: Add the new constants to the stable block in `buildSystemPrompt`** (lines 104–114):

```ts
const stable = [
  IDENTITY,
  VOICE_RULES,
  CAPABILITIES,
  CRITICAL_RULES,
  formatRegistryContext(input.registry),
  TOOL_RULES,
  GROUPING,
  TASK_SPLITTING,
  USE_CASE_ARCHETYPES,
  RESPONSE_FORMAT,
  FEWSHOT_EXAMPLES,
].join('\n\n');
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/chat/prompt/system.ts
git commit -m "feat(chat): add task-splitting + archetypes sections to system prompt"
```

---

### Task 5.3: Add fewshot examples for tasks, multi-turn clarification, renamed titles

**Files:**
- Modify: `lib/chat/prompt/examples.ts`

- [ ] **Step 1: Read the current examples** to match the prose style (`grep -n "Example\|---" lib/chat/prompt/examples.ts | head -10`).

- [ ] **Step 2: Append three new examples.** At the end of the `FEWSHOT_EXAMPLES` string, before any closing backtick, insert:

```
---

EXAMPLE: Multi-scene video with tasks
User: I want a short 30-second video with three scenes — a forest, a campfire, and a wide finale.
Assistant (thinking): Three distinct scenes — clearly tasks-mode. Each scene = one task with a Film-icon group. Final composition is a separate task without a group.
Assistant (text): Splitting this into four tasks so you can see each scene build.
Assistant (tool: propose_plan):
{
  "title": "Three-scene short film",
  "summary": "30-second video assembled from three distinct scenes plus a final compositor.",
  "arrows": "[forest scene] → [campfire scene] → [wide finale] → composite → output",
  "models": ["Veo 3", "Compositor"],
  "detail": "Each scene gets its own prompt + Veo 3 generator. The compositor task ties the three outputs into a single video.",
  "tasks": [
    {
      "id": "scene_1",
      "title": "Forest establishing shot",
      "summary": "10s aerial shot through dense forest at golden hour.",
      "group": { "label": "Scene 1 — Forest", "icon": "Film", "color": "emerald" },
      "nodes": [
        { "id": "p1", "type": "prompt", "position": { "x": 0, "y": 0 }, "data": { "label": "Scene 1 prompt — forest", "config": { "prompt": "Aerial dolly shot through dense pine forest at golden hour, sunbeams through fog, cinematic, 10s." } } },
        { "id": "g1", "type": "ai_generator", "node_type_id": "veo_3", "position": { "x": 200, "y": 0 }, "data": { "label": "Forest shot — Veo 3", "config": { "model_id": 42, "duration": 10, "aspect_ratio": "16:9" } } }
      ],
      "edges": [{ "source": "p1", "target": "g1", "targetHandle": "prompt" }]
    },
    { "id": "scene_2", "title": "Campfire close-up", "summary": "8s tight shot on a glowing fire and faces.", "group": { "label": "Scene 2 — Campfire", "icon": "Film", "color": "amber" }, "nodes": [ /* ... */ ], "edges": [ /* ... */ ] },
    { "id": "scene_3", "title": "Wide finale", "summary": "12s wide reveal of the landscape.", "group": { "label": "Scene 3 — Finale", "icon": "Film", "color": "sky" }, "nodes": [ /* ... */ ], "edges": [ /* ... */ ] },
    { "id": "compose", "title": "Compose into one video", "summary": "Merge the three scenes into a single 30s video.", "nodes": [{ "id": "c1", "type": "compositor", "position": { "x": 800, "y": 200 }, "data": { "config": { "layers": [] } } }], "edges": [{ "source": "g1", "target": "c1", "targetHandle": "layers" }, /* ... */] }
  ]
}

---

EXAMPLE: Multi-turn clarification before plan
User: Make me a video.
Assistant (text): A few quick things — what should it be about?
Assistant (no tool — pure prose, free-text expected.)
User: A short product reel for my new sneakers.
Assistant (text): Got it. How long should it be?
Assistant (tool: ask_clarification): { "options": ["15 seconds", "30 seconds", "60 seconds"] }
User: 30 seconds
Assistant (text): And do you have product photos to use as reference, or should I generate the look from scratch?
Assistant (tool: ask_clarification): { "options": ["I'll attach photos", "Generate from scratch"] }
User: I'll attach photos
Assistant: [next turn — emits propose_plan with tasks for an upload + 2 angle groups]

---

EXAMPLE: Smart title renaming
User: Build me a workflow that generates a hero shot of a sports car and adds a subtle blur to the background.
Assistant (text): One generator + one blur — straightforward. Renaming the generator so its purpose is clear.
Assistant (tool: add_node):
{
  "nodes": [
    { "id": "p1", "type": "prompt",     "position": { "x": 0, "y": 0 },   "data": { "config": { "prompt": "Hero shot of a metallic-red sports car, studio light, high detail." } } },
    { "id": "g1", "type": "ai_generator", "node_type_id": "imagen_4", "position": { "x": 200, "y": 0 }, "data": { "label": "Hero shot — studio light", "config": { "model_id": 17, "aspect_ratio": "16:9" } } },
    { "id": "b1", "type": "blur",       "position": { "x": 400, "y": 0 }, "data": { "config": { "radius": 6 } } }
  ],
  "edges": [
    { "source": "p1", "target": "g1", "targetHandle": "prompt" },
    { "source": "g1", "target": "b1", "targetHandle": "image" }
  ]
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add lib/chat/prompt/examples.ts
git commit -m "feat(chat): fewshot examples — tasks plan, multi-turn clarify, renamed titles"
```

---

### Task 5.4: End-to-end manual verification

**Files:**
- (verification only)

- [ ] **Step 1: Start dev server.** `npm run dev`

- [ ] **Step 2: Multi-scene video flow.**
1. In `/chat`: "Build a 30-second video with three scenes — forest, campfire, wide finale."
2. Expected: model emits a tasks plan with 3 scene tasks (each with `group` containing Film icon + color) plus a composition task.
3. Plan card shows the task checklist with group chips.
4. Approve.
5. PlanCard collapses to one-line. TaskProgressCard appears, ticks tasks one by one with ~600ms staging.
6. Canvas shows 3 colored groups (each with Film icon in title bubble) + a final compositor outside any group, with edges connecting scene generators to the compositor.

- [ ] **Step 3: Product image set flow.**
1. "Make me product images of my sneakers from three angles — front, side, top."
2. Expected: model possibly asks for a reference image first (multi-turn clarification), then emits a tasks plan with 3 angle tasks (Camera-icon groups, distinct colors).
3. Approve, watch progress.

- [ ] **Step 4: Single-blueprint regression.**
1. "Generate an image of a cat and blur it lightly."
2. Expected: single-blueprint plan (no checklist), behaves exactly as before this milestone.

- [ ] **Step 5: Title-rename regression.**
1. "Build a workflow that generates a hero shot of a sports car and softens the background."
2. Expected: model uses `data.label` to give the generator a meaningful name like "Hero shot — studio light"; the canvas shows the renamed label, not the default "AI Generator".

- [ ] **Step 6: Manual grouping regression.**
1. Multi-select 2 ungrouped nodes → press Cmd/Ctrl+G.
2. Expected: group_container appears around them with default Folder icon + neutral color.
3. Click `⋯` on the group, change icon and color, click Ungroup.
4. Expected: smooth interactions, no console errors.

- [ ] **Step 7: No commit.** Verification only. If any failures, fix in a new task and re-run.

---

## Self-review

**Spec coverage check:**
- ✅ Task list in propose_plan: T2.1, T2.2, T2.3
- ✅ Task progress UI: T4.1, T4.2, T4.3, T4.4
- ✅ Group container with icon/color: T0.1, T0.2, T0.3
- ✅ Manual grouping: T1.1, T1.2 (foundation already shipped 2026-05-09)
- ✅ Smart titles: T2.2 (schema), T5.3 (fewshot example), T5.2 (CRITICAL rule)
- ✅ Multi-turn clarification: T5.2 (system prompt amendment), T5.3 (fewshot)
- ✅ Use-case archetypes: T5.2 (USE_CASE_ARCHETYPES section), T5.3 (fewshots)
- ✅ Sequential apply loop with group synthesis: T3.2, T3.3
- ✅ Stream events: T2.1
- ✅ Persistence in messages.metadata: T3.3
- ✅ Realtime live updates: T4.4
- ✅ STAGING_DELAY_MS constant: T3.1
- ✅ Compatibility (single-blueprint unchanged): T2.4, T5.4

**Placeholder scan:** No "TBD"/"TODO"/"fill in"/"similar to Task N" in the steps. Code blocks present where code changes. Verify steps state expected output.

**Type consistency:** `TaskBlueprint`, `TaskGroup`, `PlanPayload` introduced in T2.1 are used consistently in T2.3 (validateTaskList), T3.2 (synthesizeTaskBlueprint), T4.1 (PlanCard), T4.3 (TaskProgressCard). Field names (`id`, `title`, `summary`, `group`, `nodes`, `edges`) match throughout. Color enum `('neutral'|'indigo'|'emerald'|'rose'|'amber'|'sky')` matches across schema (T2.2), validator (T2.3), GroupNode renderer (T0.2), PlanCard (T4.1), TaskProgressCard (T4.3), and prompt rules (T5.1).

**Known caveats / engineer judgment calls:**
- `MultiSelectionToolbar.tsx` may or may not exist in the codebase — Task 1.2 instructs grepping first; the keyboard shortcut alone is enough if no toolbar.
- The exact `MessageRenderer.tsx` path may be `Message.tsx` — Task 4.4 mentions both; engineer picks the right one.
- `validateBlueprint` may need a small refactor in T2.3 to cleanly accept a shadow state. The instruction notes this.
- The Lucide icon set in `GroupHeaderToolbar` is a curated 22-name list; if the AI emits a name outside it, the resolver still falls back gracefully — no failure.
