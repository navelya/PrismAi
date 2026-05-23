# AI Node Output Navigation, Selection & Accumulation — Implementation Plan (Plan A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every AI generator node a persistent, navigable collection of all outputs it has produced (newest first), with hover arrows in single view, a grid/stacked-list multi-view (mirroring `media_input`), and one user-selectable output that flows downstream.

**Architecture:** Outputs accumulate in the node's `data.config.outputs` (a flat, newest-first array persisted in `sessions.canvas_state`). A pure helper builds/merges/dedupes the collection; one store action appends a completed run; the client result handler calls it on realtime completions only (never on hydration). The node component renders the collection's selected item (single view + hover arrows) or the whole collection (grid/list), and persists selection via `updateNodeConfig`. A focused change to the execution-start preseed builder makes the selected output the value downstream nodes receive.

**Tech Stack:** Next.js (App Router), React + ReactFlow, Zustand (`lib/store`), Supabase (Postgres + realtime), TypeScript.

---

## Testing & verification note (READ FIRST)

This repo has **no test runner** (see CLAUDE.md). Per the user's standing instruction, the authoritative type/correctness gate is:

```bash
npx tsc --noEmit
```

`npm run lint` / `next build` are unreliable here — do **not** rely on them. The one piece of pure logic (the outputs helper, Task A1) gets an automated check via a standalone Node script run with `npx tsx` (the repo already uses ad-hoc `scripts/*` run directly). All UI/integration behavior is verified with the explicit manual checklists in each task against `npm run dev` (port 3000). Treat the manual checklist as the task's "tests" — do not claim a task complete without performing it.

**Commit after every task.** Branch: `feat/ai-node-iterations-multi-output` (already checked out).

---

## File Structure

**Create:**
- `lib/nodes/plugins/ai_generator/outputs.ts` — pure helpers + the `GeneratedOutput` type. One responsibility: build/merge/clamp the outputs collection. No React, no store, no I/O.
- `scripts/check-ai-outputs.ts` — standalone assertions for `outputs.ts` (run with `npx tsx`).

**Modify:**
- `lib/nodes/plugins/ai_generator/definition.ts` — extend `AIGeneratorConfig` with `outputs` + `selected_output_index`.
- `lib/store/slices/workflow-slice.ts` — add `appendAiGeneratorRun` action (reuses `updateNodeConfig`).
- `lib/store/slices/workflow-slice.ts` type/interface (wherever the slice's action signatures are declared — search for `updateNodeConfig:` in the slice's TS interface) — declare `appendAiGeneratorRun`.
- `lib/hooks/use-execution-channel.ts` — in `applyNodeResult`, append a completed ai_generator run to the collection (realtime only).
- `lib/nodes/plugins/ai_generator/component.tsx` — derive collection + selected index from config; single-view hover arrows; grid selection persists; grid videos use `BlurryVideo`; text multi-view (arrows + stacked list).
- `app/api/executions/start/route.ts` — preseed builder prefers a generative ancestor's persisted selected output.

---

## Task A1: Pure outputs helper + types

**Files:**
- Create: `lib/nodes/plugins/ai_generator/outputs.ts`
- Create: `scripts/check-ai-outputs.ts`
- Modify: `lib/nodes/plugins/ai_generator/definition.ts:7-12`

- [ ] **Step 1: Write the pure helper**

Create `lib/nodes/plugins/ai_generator/outputs.ts`:

```ts
import type { NodeResultType } from '@/lib/nodes/types';

/** One produced output, persisted in ai_generator config.outputs (newest-first). */
export interface GeneratedOutput {
    /** Result type of THIS item ('image' | 'video' | 'text' | 'audio' | '3d' | 'json'). */
    type: NodeResultType;
    /** URL for media, string for text, or raw value otherwise. */
    value: any;
    /** The execution that produced this item. Used to dedupe re-delivered events. */
    execution_id?: string;
    /** ISO timestamp the item was added (newest-first ordering aid). */
    created_at?: string;
}

/** Hard cap so a long-lived node can't bloat the persisted workflow JSON. */
export const MAX_OUTPUTS_PER_NODE = 60;

/** Wrap a run's raw values (urls or text strings) into GeneratedOutput items. */
export function buildOutputItems(
    type: NodeResultType,
    values: any[],
    executionId?: string,
    createdAt: string = new Date().toISOString(),
): GeneratedOutput[] {
    return (values ?? [])
        .filter((v) => v !== undefined && v !== null && v !== '')
        .map((v) => ({ type, value: v, execution_id: executionId, created_at: createdAt }));
}

/**
 * Merge a new run's items into the existing collection, newest-first.
 * - Idempotent per execution: items whose execution_id matches `executionId`
 *   are dropped from `existing` first, so a re-delivered realtime event for the
 *   same run never double-appends.
 * - Capped at MAX_OUTPUTS_PER_NODE (oldest items fall off the tail).
 */
export function mergeRunIntoCollection(
    existing: GeneratedOutput[] | undefined,
    incoming: GeneratedOutput[],
    executionId?: string,
): GeneratedOutput[] {
    const prior = (existing ?? []).filter(
        (o) => !(executionId && o.execution_id === executionId),
    );
    return [...incoming, ...prior].slice(0, MAX_OUTPUTS_PER_NODE);
}

/** Clamp a (possibly stale) selected index into [0, length-1]; 0 when empty. */
export function clampSelectedIndex(index: number | undefined, length: number): number {
    if (length <= 0) return 0;
    const i = Number.isFinite(index as number) ? Math.trunc(index as number) : 0;
    return Math.max(0, Math.min(length - 1, i));
}

/** The currently-selected output value, or undefined for an empty collection. */
export function selectedValue(
    outputs: GeneratedOutput[] | undefined,
    index: number | undefined,
): any {
    const list = outputs ?? [];
    if (list.length === 0) return undefined;
    return list[clampSelectedIndex(index, list.length)]?.value;
}
```

- [ ] **Step 2: Extend the config type**

In `lib/nodes/plugins/ai_generator/definition.ts`, replace the `AIGeneratorConfig` interface (lines 7-12):

```ts
import type { GeneratedOutput } from './outputs';

/**
 * AI Generator Node Configuration
 * Dynamic node that adapts based on selected model from the catalog
 */
export interface AIGeneratorConfig {
    model_id?: number;
    node_type_id?: string;
    control_values?: Record<string, any>;
    /** Selected output value, mirrored for preview/hydration. */
    last_output?: any;
    /** All outputs this node has produced, newest-first (Plan A). */
    outputs?: GeneratedOutput[];
    /** Index into `outputs` of the active/selected output (Plan A). Default 0. */
    selected_output_index?: number;
}
```

(Note: `definition.ts` is imported by both client and server registries; `outputs.ts` is pure TS with no React/`sharp` imports, so this is safe.)

- [ ] **Step 3: Write the standalone check script**

Create `scripts/check-ai-outputs.ts`:

```ts
import assert from 'node:assert';
import {
    buildOutputItems,
    mergeRunIntoCollection,
    clampSelectedIndex,
    selectedValue,
    MAX_OUTPUTS_PER_NODE,
} from '../lib/nodes/plugins/ai_generator/outputs';

// buildOutputItems filters empties and tags metadata
const built = buildOutputItems('image', ['a', '', null, 'b'], 'exec1');
assert.deepStrictEqual(built.map((o) => o.value), ['a', 'b'], 'filters empties');
assert.strictEqual(built[0].execution_id, 'exec1', 'tags execution_id');
assert.strictEqual(built[0].type, 'image', 'tags type');

// merge prepends newest-first
const run1 = buildOutputItems('image', ['a'], 'e1');
const run2 = buildOutputItems('image', ['b', 'c'], 'e2');
const merged = mergeRunIntoCollection(run1, run2, 'e2');
assert.deepStrictEqual(merged.map((o) => o.value), ['b', 'c', 'a'], 'newest-first');

// merge is idempotent per execution_id (re-delivered event)
const again = mergeRunIntoCollection(merged, run2, 'e2');
assert.deepStrictEqual(again.map((o) => o.value), ['b', 'c', 'a'], 'no double-append');

// cap enforced
const big = buildOutputItems('image', Array.from({ length: 100 }, (_, i) => `u${i}`), 'eBig');
assert.strictEqual(
    mergeRunIntoCollection([], big, 'eBig').length,
    MAX_OUTPUTS_PER_NODE,
    'capped',
);

// clamp + selectedValue
assert.strictEqual(clampSelectedIndex(5, 3), 2, 'clamps high');
assert.strictEqual(clampSelectedIndex(-1, 3), 0, 'clamps low');
assert.strictEqual(clampSelectedIndex(0, 0), 0, 'empty → 0');
assert.strictEqual(selectedValue(merged, 1), 'c', 'selectedValue by index');
assert.strictEqual(selectedValue([], 0), undefined, 'empty → undefined');

console.log('check-ai-outputs: ALL ASSERTIONS PASSED');
```

- [ ] **Step 4: Run the check script — verify it passes**

Run: `npx tsx scripts/check-ai-outputs.ts`
Expected: prints `check-ai-outputs: ALL ASSERTIONS PASSED` and exits 0.

(If `tsx` is unavailable, run `npx --yes tsx scripts/check-ai-outputs.ts`. Do not substitute a different runner silently — if it still fails to run, stop and report.)

- [ ] **Step 5: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no new errors referencing `outputs.ts` or `definition.ts`.

- [ ] **Step 6: Commit**

```bash
git add lib/nodes/plugins/ai_generator/outputs.ts scripts/check-ai-outputs.ts lib/nodes/plugins/ai_generator/definition.ts
git commit -m "feat(ai-node): outputs collection helper + config types"
```

---

## Task A2: Store action — append a completed run

**Files:**
- Modify: `lib/store/slices/workflow-slice.ts` (add action after `updateNodeConfig`, which ends at line 737)
- Modify: the slice's TypeScript interface (search for `updateNodeConfig:` in the same file's `interface`/type that declares the actions) to declare the new action.

- [ ] **Step 1: Declare the action in the slice interface**

In `lib/store/slices/workflow-slice.ts`, find the interface line declaring `updateNodeConfig` (e.g. `updateNodeConfig: (nodeId: string, config: any) => void;`) and add directly beneath it:

```ts
    /**
     * Append a completed ai_generator run's outputs to the node's persisted
     * collection (newest-first), auto-select the newest, and persist. No-op for
     * non-ai_generator nodes. Idempotent per executionId.
     */
    appendAiGeneratorRun: (
        nodeId: string,
        type: import('@/lib/nodes/types').NodeResultType,
        values: any[],
        executionId?: string,
    ) => void;
```

- [ ] **Step 2: Implement the action**

In the same file, immediately AFTER the `updateNodeConfig` action (after its closing `},` on line 737), add:

```ts
    appendAiGeneratorRun: (nodeId, type, values, executionId) => {
        const { currentWorkflow } = get();
        if (!currentWorkflow) return;
        const node = currentWorkflow.nodes.find((n) => n.id === nodeId);
        if (!node || node.type !== 'ai_generator') return;

        const incoming = buildOutputItems(type, values, executionId);
        if (incoming.length === 0) return;

        const oldConfig = (node.data?.config as any) || {};
        const mergedOutputs = mergeRunIntoCollection(oldConfig.outputs, incoming, executionId);

        // Newest run shows on front.
        get().updateNodeConfig(nodeId, {
            ...oldConfig,
            outputs: mergedOutputs,
            selected_output_index: 0,
            last_output: selectedValue(mergedOutputs, 0),
        });
    },
```

- [ ] **Step 3: Add the import**

At the top of `lib/store/slices/workflow-slice.ts`, add (next to existing imports):

```ts
import { buildOutputItems, mergeRunIntoCollection, selectedValue } from '@/lib/nodes/plugins/ai_generator/outputs';
```

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. (If `NodeResultType` isn't already exported from `@/lib/nodes/types`, confirm the export exists — it is used by `outputs.ts` in Task A1; if missing there too, the Task A1 type-check would have failed.)

- [ ] **Step 5: Commit**

```bash
git add lib/store/slices/workflow-slice.ts
git commit -m "feat(ai-node): appendAiGeneratorRun store action"
```

---

## Task A3: Append on realtime completion (not on hydration)

**Files:**
- Modify: `lib/hooks/use-execution-channel.ts:38-48` (inside `applyNodeResult`, the `status === 'completed'` branch)

- [ ] **Step 1: Append the run in the completed branch**

In `lib/hooks/use-execution-channel.ts`, the `applyNodeResult` function receives the full row as `record` and a `source` of `'realtime' | 'hydrate'`. Replace the `if (status === 'completed') { ... }` block (lines 38-48) with:

```ts
    if (status === 'completed') {
        store.setNodeStatus(nodeId, 'success');
        store.setNodeError(nodeId, null);
        const finalType = resultType
            ? normalizeNodeResultType(resultType)
            : inferResultTypeFromValue(resultData);
        const finalData = coerceResultDataArray(resultData ?? []);

        if (finalData.length > 0) {
            store.setNodeOutput(nodeId, toOutputEnvelope(finalType, finalData));

            // Accumulate into the node's persisted collection — ONLY for live
            // results. Hydration replays the latest DB rows on every page load;
            // config.outputs is already persisted in canvas_state, so appending
            // on 'hydrate' would double-count. appendAiGeneratorRun is a no-op
            // for non-ai_generator nodes and is idempotent per execution_id.
            if (source === 'realtime') {
                store.appendAiGeneratorRun(nodeId, finalType, finalData, record.execution_id);
            }
        }
    } else if (status === 'failed') {
```

(The `} else if (status === 'failed') {` line is the existing continuation — keep it; you are only inserting the `appendAiGeneratorRun` call and replacing the opening block.)

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. `record.execution_id` is available because the realtime postgres_changes payload carries the full row (the `record` already destructures `session_id` from it).

- [ ] **Step 3: Manual verification**

Run `npm run dev`. With an ai_generator node connected to a prompt, run it once. Then:
- Confirm the result appears (single view) — same as before.
- Run it again (a second execution). The node should now visibly hold the newer result on front (we wire the actual rendering in Task A4; for now, inspect the store): open React devtools or `console.log(useAppStore.getState().currentWorkflow.nodes.find(n=>n.id===<id>).data.config.outputs)` and confirm `outputs.length` grew by the run's item count and is newest-first.
- Reload the page and confirm `outputs.length` did NOT grow (hydration must not append).

- [ ] **Step 4: Commit**

```bash
git add lib/hooks/use-execution-channel.ts
git commit -m "feat(ai-node): accumulate completed runs into config.outputs (realtime only)"
```

---

## Task A4: Render the collection + single-view hover arrows + persist selection

**Files:**
- Modify: `lib/nodes/plugins/ai_generator/component.tsx` (the `AIGeneratorNode` function: lines 40-390, and `OutputPreview`: lines 400-636)

This task makes the node render from `config.outputs` and adds prev/next arrows in single view that change the persisted selection. Backward compatibility: nodes saved before Plan A have `last_output` but no `outputs[]` — treat that as a one-item collection.

- [ ] **Step 1: Derive the collection + selected index from config**

In `AIGeneratorNode`, after the existing line 47 (`const output = liveOutput || data.output || data.config?.last_output;`), add the collection derivation. Insert after line 67 (`const triggerRunFromNode = ...`):

```ts
    const updateNodeConfig = useAppStore(state => state.updateNodeConfig);

    // The persisted, newest-first collection. Backward-compat: a pre-Plan-A node
    // has only last_output — surface it as a single-item collection so old
    // workflows still render and are selectable.
    const persistedOutputs: GeneratedOutput[] = Array.isArray(data.config?.outputs)
        ? data.config.outputs
        : (data.config?.last_output != null
            ? [{ type: (inferResultTypeFromValue(data.config.last_output) ?? 'image') as any, value: data.config.last_output }]
            : []);

    const selectedIndex = clampSelectedIndex(data.config?.selected_output_index, persistedOutputs.length);

    const selectOutputIndex = (i: number) => {
        if (persistedOutputs.length === 0) return;
        const clamped = clampSelectedIndex(i, persistedOutputs.length);
        updateNodeConfig(id, {
            ...(data.config || {}),
            selected_output_index: clamped,
            last_output: selectedValue(persistedOutputs, clamped),
        });
    };
```

Add the imports at the top of the file (next to the existing `computeAiNodeCost` import on line 19):

```ts
import { clampSelectedIndex, selectedValue, type GeneratedOutput } from './outputs';
```

- [ ] **Step 2: Drive the preview from the collection**

Replace the preview-source derivation. The current code (lines 160-181) computes `previewOutput`/`previewType` from `output`. When we have a persisted collection, the preview source is the collection's VALUES array and the type is the SELECTED item's type. After the existing block that sets `previewOutput`/`previewType`/`activeType` (ends ~line 191), add an override:

```ts
    // Plan A: when a persisted collection exists, it is the source of truth for
    // the preview. The single view shows the selected item; the grid shows all.
    let collectionUrls: any[] | null = null;
    let collectionType: typeof activeType = activeType;
    if (persistedOutputs.length > 0) {
        collectionUrls = persistedOutputs.map((o) => o.value);
        const selType = persistedOutputs[selectedIndex]?.type;
        // Prefer the selected item's own type; fall back to data-inferred.
        collectionType = (selType as any) || activeType;
    }
    const effectiveOutput = collectionUrls ?? previewOutput;
    const effectiveType = collectionUrls ? collectionType : activeType;
    const effectiveIndex = collectionUrls ? selectedIndex : activeImageIndex;
```

- [ ] **Step 3: Pass collection + selection + arrow handlers to OutputPreview**

Update the `<OutputPreview .../>` props (lines 264-294). Change `output={previewOutput}` → `output={effectiveOutput}`, `type={activeType}` → `type={effectiveType}`, `activeImageIndex={activeImageIndex}` → `activeImageIndex={effectiveIndex}`, and add navigation props. Also change `onImageClick` so a grid click persists selection:

```tsx
                    <OutputPreview
                        nodeId={id}
                        output={effectiveOutput}
                        type={effectiveType}
                        previewMode={previewMode}
                        activeImageIndex={effectiveIndex}
                        itemCount={collectionUrls ? collectionUrls.length : (Array.isArray(previewOutput) ? previewOutput.length : 1)}
                        onImageLoad={handleImageLoad}
                        onSelectIndex={(i: number) => {
                            if (collectionUrls) selectOutputIndex(i);
                            else setActiveImageIndex(i);
                        }}
                        onImageClick={(idx: number, e: React.MouseEvent) => {
                            e.stopPropagation();
                            if (collectionUrls) selectOutputIndex(idx);
                            else setActiveImageIndex(idx);
                            if (previewMode === 'single') openLightbox(idx);
                        }}
                        onPreviewClick={(e: React.MouseEvent) => {
                            e.stopPropagation();
                            if (effectiveType === 'image' || effectiveType === 'video') {
                                openLightbox(effectiveIndex);
                            }
                        }}
                        onInteraction={(e: React.MouseEvent | React.PointerEvent) => e.stopPropagation()}
                        isDragging={isDragging}
                    />
```

Also update the lightbox props at the bottom (lines 376-386): `media={previewOutput}` → `media={effectiveOutput}`, `type={activeType as any}` → `type={effectiveType as any}`, `initialIndex={lightboxIndex}` stays.

And update the View Toggles condition (line 301) and the grid/single toggle to use the collection length:

```tsx
                {isMediaResultType(effectiveType as any) && Array.isArray(effectiveOutput) && effectiveOutput.length > 1 && (
```

- [ ] **Step 4: Add hover arrows to the single-image and single-video views**

In `OutputPreview`, the function signature (line 400) gains `itemCount` and `onSelectIndex`:

```ts
function OutputPreview({ nodeId, output, type, previewMode, activeImageIndex, itemCount, onImageLoad, onSelectIndex, onImageClick, onPreviewClick, onInteraction, isDragging }: any) {
```

Define a small arrows overlay near the top of the component body (after the `urls`/`extractedText` derivation, before the early returns):

```tsx
    const count = typeof itemCount === 'number' ? itemCount : urls.length;
    const canNavigate = count > 1 && previewMode === 'single';
    const go = (delta: number, e: React.MouseEvent) => {
        e.stopPropagation();
        const next = ((activeImageIndex ?? 0) + delta + count) % count;
        onSelectIndex?.(next);
    };
    const NavArrows = canNavigate ? (
        <>
            <button
                onMouseDown={onInteraction}
                onClick={(e) => go(-1, e)}
                className="absolute top-1/2 left-2 -translate-y-1/2 z-30 w-8 h-8 rounded-full bg-black/55 hover:bg-black/75 text-white flex items-center justify-center opacity-0 group-hover/preview:opacity-100 transition-opacity"
                title="Previous"
            >
                <ChevronLeft className="w-5 h-5" />
            </button>
            <button
                onMouseDown={onInteraction}
                onClick={(e) => go(1, e)}
                className="absolute top-1/2 right-2 -translate-y-1/2 z-30 w-8 h-8 rounded-full bg-black/55 hover:bg-black/75 text-white flex items-center justify-center opacity-0 group-hover/preview:opacity-100 transition-opacity"
                title="Next"
            >
                <ChevronRight className="w-5 h-5" />
            </button>
            <div className="absolute bottom-2 left-1/2 -translate-x-1/2 z-30 px-2 py-0.5 rounded-full bg-black/55 text-white text-[10px] font-mono opacity-0 group-hover/preview:opacity-100 transition-opacity">
                {(activeImageIndex ?? 0) + 1} / {count}
            </div>
        </>
    ) : null;
```

Add `ChevronLeft, ChevronRight` to the lucide-react import on line 5:

```ts
import { Zap, Check, Square, LayoutGrid, MoreHorizontal, Play, Coins, ChevronLeft, ChevronRight } from 'lucide-react';
```

Then render `{NavArrows}` inside BOTH single-view return blocks — the video block (the `<div className="w-full h-full relative group/preview ...">` at line 533) and the image block (line 583). Place `{NavArrows}` as the last child inside each of those `group/preview` containers (after the existing overlay/`BlurryImage`), so the arrows appear on hover over the preview.

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Manual verification**

Run `npm run dev`. On an ai_generator node that has produced ≥2 outputs (run it twice, or use a model that returns multiple):
- Single view shows the newest output on front.
- Hovering the preview reveals left/right arrows and an "N / M" counter.
- Clicking arrows changes the shown output and the counter; the change persists across a page reload (selection is in config).
- Reload: the same selected index is restored.

- [ ] **Step 7: Commit**

```bash
git add lib/nodes/plugins/ai_generator/component.tsx
git commit -m "feat(ai-node): render persisted outputs collection with single-view hover arrows + persisted selection"
```

---

## Task A5: Grid view — persisted selection + BlurryVideo for video tiles

**Files:**
- Modify: `lib/nodes/plugins/ai_generator/component.tsx` (the Grid View return in `OutputPreview`, lines 603-635)

- [ ] **Step 1: Mark the selected tile from the persisted index and use BlurryVideo**

Replace the Grid View block (lines 604-634) with:

```tsx
    // Grid View
    return (
        <div className="w-full h-full p-2 overflow-y-auto custom-scrollbar">
            <div className="grid grid-cols-3 gap-2">
                {urls.map((url: string, i: number) => {
                    const isActive = activeImageIndex === i;
                    return (
                        <button
                            key={i}
                            onMouseDown={onInteraction}
                            onPointerDown={onInteraction}
                            onClick={(e) => onImageClick(i, e)}
                            className={cn(
                                "relative aspect-square rounded-md overflow-hidden bg-white/5 border-2 transition-all",
                                isActive ? "border-accent-primary ring-2 ring-accent-primary/20 scale-[0.98]" : "border-white/5 hover:border-white/20"
                            )}
                        >
                            {type === 'video' ? (
                                <BlurryVideo src={url} muted loop playsInline preload="metadata" className="w-full h-full object-cover" containerClassName="w-full h-full" />
                            ) : (
                                <BlurryImage src={toThumbnailUrl(url, { width: 256 }) ?? url} fallbackSrc={url} alt="" onLoad={onImageLoad} className="w-full h-full object-cover" />
                            )}
                            {isActive && (
                                <div className="absolute inset-0 bg-accent-primary/10 flex items-center justify-center">
                                    <Check className="w-4 h-4 text-white drop-shadow-md" />
                                </div>
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
```

(`isActive` now reflects the persisted `selected_output_index` because Task A4 passes `activeImageIndex={effectiveIndex}`, and `onImageClick` persists via `selectOutputIndex`. `containerClassName="w-full h-full"` keeps the grid cell square — confirm `BlurryVideo` forwards `containerClassName`; per the codebase it does, used elsewhere in this file.)

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual verification**

Run `npm run dev`. On a node with ≥2 image outputs:
- Hover the preview → the Square/Grid toggle appears (bottom-right). Click Grid.
- All outputs show as tiles; the selected one has the accent border + Check.
- Click a different tile → it becomes selected (Check moves), and switching back to Single view shows that selected output on front.
- The selection persists across reload.
- For a video-producing node, grid tiles render via BlurryVideo (blur-up), not a raw black `<video>`.

- [ ] **Step 4: Commit**

```bash
git add lib/nodes/plugins/ai_generator/component.tsx
git commit -m "feat(ai-node): grid view persists selection + BlurryVideo tiles"
```

---

## Task A6: Text/prompt multi-output (arrows in single, stacked list in multi)

**Files:**
- Modify: `lib/nodes/plugins/ai_generator/component.tsx` (the `isTextType` branch in `OutputPreview`, lines 440-468)

Text nodes can produce multiple text outputs across runs. Single view shows one block with arrows; the multi-view (grid toggle) becomes a vertical stacked list of all text outputs, click to select.

- [ ] **Step 1: Render per-item text from the collection**

The `OutputPreview` `output` for a text collection is an array of strings (Task A4 passes `effectiveOutput = collectionUrls`, i.e. the values). Today the text branch joins ALL items into one textarea. Replace the `isTextType` return (lines 440-468) with:

```tsx
    if (isTextType) {
        const textItems: string[] = Array.isArray(output)
            ? output.map((o: any) => (typeof o === 'string' ? o : (o?.text ?? o?.value ?? '')))
            : [textContent ?? ''];
        const idx = Math.min(Math.max(activeImageIndex ?? 0, 0), Math.max(textItems.length - 1, 0));
        const single = textItems[idx] ?? '';

        if (previewMode === 'grid') {
            // Stacked-list multi-view: every text output, click to select.
            return (
                <div className="w-full p-2 space-y-1.5 max-h-[320px] overflow-y-auto custom-scrollbar" onMouseDown={onInteraction} onPointerDown={onInteraction}>
                    {textItems.map((t, i) => (
                        <button
                            key={i}
                            onMouseDown={onInteraction}
                            onClick={(e) => { e.stopPropagation(); onSelectIndex?.(i); }}
                            className={cn(
                                "block w-full text-left rounded-lg border p-2 text-xs whitespace-pre-wrap transition-all",
                                (activeImageIndex ?? 0) === i
                                    ? "border-accent-primary ring-2 ring-accent-primary/20 bg-accent-primary/5 text-content-primary"
                                    : "border-white/10 bg-white/5 text-content-secondary hover:border-white/20"
                            )}
                        >
                            {t.length > 240 ? `${t.slice(0, 240)}…` : (t || 'Empty output')}
                        </button>
                    ))}
                </div>
            );
        }

        return (
            <div
                className="relative w-full p-2.5 transition-all duration-300 bg-transparent group/preview"
                onMouseDown={onInteraction}
                onPointerDown={onInteraction}
                onClick={onInteraction}
            >
                <textarea
                    ref={textareaRef}
                    className="nodrag custom-scrollbar block w-full min-h-[140px] max-h-[300px] text-sm bg-transparent border-none focus:outline-none focus:ring-0 text-content-primary resize-none p-0"
                    value={single}
                    placeholder="Empty output"
                    onChange={(e) => {
                        // Editing a single text output writes back to live store only
                        // (parity with prior behavior). Persisted-collection editing is
                        // out of scope for Plan A.
                        setNodeOutput(nodeId, { type: 'text', data: [e.target.value] });
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Backspace' || e.key === 'Delete') e.stopPropagation();
                    }}
                    onWheel={(e) => {
                        if (!e.ctrlKey && !e.metaKey) e.stopPropagation();
                    }}
                />
                {NavArrows}
            </div>
        );
    }
```

(The `textareaRef` auto-resize effect at lines 422-438 keys off `textContent`; that still fires. `NavArrows` is defined in Task A4 and gated on `count > 1 && previewMode === 'single'`.)

- [ ] **Step 2: Ensure the view toggle shows for multi-text**

The toggle (component.tsx line 301, edited in Task A4) currently gates on `isMediaResultType(effectiveType)`. Text is not a media type, so the toggle wouldn't appear for text collections. Update that condition to also allow text collections:

```tsx
                {((isMediaResultType(effectiveType as any) || effectiveType === 'text') && Array.isArray(effectiveOutput) && effectiveOutput.length > 1) && (
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Run `npm run dev`. On a text-producing ai_generator node (e.g. a model whose output type is `text`), run it twice so the collection holds ≥2 text outputs:
- Single view shows one text block; hover reveals arrows + counter; arrows switch between text outputs and persist.
- The grid toggle appears; clicking it shows a vertical stacked list of all text outputs; clicking an item selects it (highlighted) and switching back to single shows it.

- [ ] **Step 5: Commit**

```bash
git add lib/nodes/plugins/ai_generator/component.tsx
git commit -m "feat(ai-node): text multi-output navigation (arrows + stacked list)"
```

---

## Task A7: Preseed prefers the selected output (selection flows downstream)

**Files:**
- Modify: `app/api/executions/start/route.ts:205-279` (the generative-ancestor preseed block)

When a downstream node runs WITHOUT re-running this ai_generator (the main "select then run downstream" case), the engine pre-seeds the downstream input from the ancestor's latest `node_results` row (primary = index 0). We make it prefer the ancestor's persisted selected output instead, so the user's selection is what flows.

- [ ] **Step 1: Build a per-ancestor selection override from the graph**

The route already has the full node list. Find where `executableNodes` / the full graph nodes are available in this function (the same source used to build `graphForCost.allNodes` around lines 417-436 — it reads `n.data.config`). Just BEFORE the `(ancestorResults || []).forEach(...)` loop (line 219), add a lookup of each generative ancestor's persisted selection:

```ts
        // Plan A: a node's persisted selected output is the authoritative value
        // it provides downstream (the user picked it; we do NOT re-run the node).
        // Prefer it over the latest node_results row when present.
        const selectionByNode = new Map<string, any>();
        for (const n of executableNodes as any[]) {
            if (!generativeAncestorIds.has(n.id)) continue;
            const cfg = n.data?.config || {};
            const outputs = Array.isArray(cfg.outputs) ? cfg.outputs : null;
            if (outputs && outputs.length > 0) {
                const idx = Math.max(0, Math.min((cfg.selected_output_index ?? 0), outputs.length - 1));
                const val = outputs[idx]?.value;
                if (val !== undefined && val !== null && val !== '') selectionByNode.set(n.id, val);
            } else if (cfg.last_output !== undefined && cfg.last_output !== null && cfg.last_output !== '') {
                selectionByNode.set(n.id, cfg.last_output);
            }
        }
```

(Use whatever variable holds the full set of workflow nodes in this scope. If it is not named `executableNodes`, use the same array referenced by the `graphForCost.allNodes` mapping. Confirm by reading lines ~410-436 of this file before editing.)

- [ ] **Step 2: Apply the override when building each ancestor's "latest result"**

In the `(ancestorResults || []).forEach((r) => { ... })` loop (lines 219-229), after computing `resultType`/`resultData`/`primary`, override `primary` and the head of `resultData` with the selection when present:

```ts
        (ancestorResults || []).forEach(r => {
          const resultType = normalizeNodeResultType(r.result_type);
          let resultData = coerceResultDataArray(r.result_data || []);
          let primary = getPrimaryInputValue(resultType, resultData);

          // Plan A override: honor the user's selected output for this ancestor.
          const selected = selectionByNode.get(r.node_id);
          if (selected !== undefined) {
            primary = selected;
            // Put the selection at the head so array-handle consumers (which use
            // resultData) also lead with it, while preserving the rest.
            resultData = [selected, ...resultData.filter((v) => v !== selected)];
          }

          if ((primary !== undefined && primary !== null) || resultData.length > 0) {
            if (!latestByNode.has(r.node_id)) {
              latestByNode.set(r.node_id, { resultType, resultData, primary });
            }
          }
        });
```

Also handle the case where a generative ancestor has a selection but NO completed `node_results` row (e.g. results were pruned): after the loop, seed any missing ancestors from the selection map:

```ts
        for (const [ancestorId, selected] of selectionByNode.entries()) {
          if (latestByNode.has(ancestorId)) continue;
          // Infer a usable type from the value; default to image for media URLs.
          const inferred = normalizeNodeResultType(undefined);
          latestByNode.set(ancestorId, { resultType: inferred, resultData: [selected], primary: selected });
        }
```

(`normalizeNodeResultType(undefined)` returns the codebase default — confirm what it returns by reading `result-format.ts`; if it does not default to a media-friendly type, pass the type from the ancestor's `config.outputs[idx].type` instead. Prefer reading the type from config when available.)

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification (the key behavior)**

Run `npm run dev`. Build: ai_generator (image) → a downstream ai_generator (image-to-image) or a blur node.
- Run the upstream node so it produces ≥2 outputs.
- In the upstream node, SELECT a non-default output (e.g. the 2nd) via arrows or grid.
- Run ONLY the downstream node (its "Run" / solo). Do NOT re-run the upstream.
- Confirm the downstream node consumes the **selected** upstream output (verify via the produced result, or add a temporary `console.log` of the dispatched `replicateInputs` image URL in the executor and confirm it matches the selected output's URL).
- Change the selection to a different output, re-run downstream, and confirm it now uses the newly selected one.

- [ ] **Step 5: Commit**

```bash
git add app/api/executions/start/route.ts
git commit -m "feat(ai-node): preseed prefers the parent's selected output (selection flows downstream)"
```

---

## Task A8: Full type-check + end-to-end manual pass + finalize

**Files:** none (verification only)

- [ ] **Step 1: Full type-check**

Run: `npx tsc --noEmit`
Expected: clean (no new errors introduced by Plan A).

- [ ] **Step 2: Re-run the pure-logic check**

Run: `npx tsx scripts/check-ai-outputs.ts`
Expected: `check-ai-outputs: ALL ASSERTIONS PASSED`.

- [ ] **Step 3: End-to-end manual checklist**

Run `npm run dev` and confirm all of:
- [ ] New run appends (newest on front); previous outputs remain navigable.
- [ ] Reload does NOT duplicate outputs.
- [ ] Single-view hover arrows navigate; counter shows position; selection persists across reload.
- [ ] Grid view shows all; click selects; Check marks the selected; selection persists.
- [ ] Switching grid → single shows the selected output on front.
- [ ] Video nodes: arrows + grid (BlurryVideo tiles) behave like images.
- [ ] Text nodes: arrows in single, stacked list in multi, selection persists.
- [ ] Selecting an upstream output and running a downstream node (without re-running upstream) feeds the SELECTED output downstream.
- [ ] A pre-Plan-A workflow (only `last_output`, no `outputs[]`) still renders its single output and is selectable.

- [ ] **Step 4: Final commit (if any cleanup was needed)**

```bash
git add -A
git commit -m "chore(ai-node): Plan A verification pass"
```

(If Step 3 found a defect, fix it in the relevant task's file, re-run Steps 1-3, and commit with a descriptive message before considering Plan A done.)

---

## Self-Review (completed by plan author)

**Spec coverage (Plan A scope):**
- Outputs collection + newest-first accumulation → Tasks A1, A2, A3. ✓
- Persistence across reload → A2 (`updateNodeConfig` → `isWorkflowDirty` → `saveWorkflow`), verified A3/A4. ✓
- Single-view hover arrows → A4. ✓
- Grid multi-view like media_input + click-to-select + selected = output → A5. ✓
- "Front image is the output; switching to single shows selected" → A4/A5 (selected_output_index drives both). ✓
- Videos handled same as images → A4 (single video block gets arrows) + A5 (BlurryVideo grid). ✓
- Text/prompt "in their own way" → A6 (arrows + stacked list). ✓
- Selected output flows downstream, no auto-rerun → A7 (preseed preference). ✓
- Hydration must not double-append (correctness) → A3 (`source === 'realtime'` guard + execution_id dedupe). ✓
- (Iterations control, cost multiplier, AI access, N-prediction fan-out are **Plan B** — intentionally excluded.)

**Placeholder scan:** No TBD/TODO; every code step shows full code. Two steps ask the implementer to confirm an in-scope existing detail before editing (the full-node-array variable name in A7 Step 1; `normalizeNodeResultType(undefined)`'s default in A7 Step 2) — these are verification instructions with explicit fallbacks, not missing content.

**Type consistency:** `GeneratedOutput`, `buildOutputItems`, `mergeRunIntoCollection`, `clampSelectedIndex`, `selectedValue`, `MAX_OUTPUTS_PER_NODE`, and `appendAiGeneratorRun(nodeId, type, values, executionId)` are named identically across A1, A2, A3, A4. `OutputPreview` prop additions (`itemCount`, `onSelectIndex`) are introduced in A4 and consumed in A4/A5/A6 consistently.
