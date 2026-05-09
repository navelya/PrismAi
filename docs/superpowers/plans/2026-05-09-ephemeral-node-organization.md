# Ephemeral Node Reorganization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate every ephemeral-node plugin into a single self-contained folder under `lib/nodes/plugins/<name>/` with uniform file names, delete the duplicate `lib/workflow/handlers.ts` runtime registry, fold per-node UI from `components/canvas/` and `components/compositor/` into each plugin folder, and unify server execution behind `serverRegistry[type].executor`.

**Architecture:** Each plugin folder owns `definition.ts` (shared def + AI schema + config TS), `executor.server.ts` (Sharp/upload, self-contained), optional `executor.client.ts` (live preview), `component.tsx` (canvas card), optional `properties.tsx` and `ui/` and `shared.ts`, plus a barrel `index.ts`. Three barrel registries (`shared-registry.ts`, `client-registry.ts`, `server-registry.ts`) import each plugin's `index.ts`. The runtime (`ephemeral-executor.ts`, `dispatch-ephemeral` route) calls `serverRegistry[type].executor(config, inputs, context)` and consumes the returned `NodeExecutionResult` directly — no parallel handler map, no in-line buffer-upload loop.

**Tech Stack:** Next.js 14 App Router, TypeScript, React Flow, Sharp, Supabase, Zustand. There is no test runner — verification uses `npm run lint`, `npm run build`, `grep` for orphan references, and a manual smoke test of the end-to-end execution flow.

**Source spec:** [`docs/superpowers/specs/2026-05-09-ephemeral-node-organization-design.md`](../specs/2026-05-09-ephemeral-node-organization-design.md)

**Behavior-preservation rule (recurring):** the consolidated `executor.server.ts` for each existing plugin must match the *current runtime behavior*, which is what `lib/workflow/handlers.ts` produces — NOT what the plugin's `executor.ts` server-branch produces. The two diverge in subtle ways (blur radius scaling, compositor upload bucket, prompt config-key fallbacks). Tasks below explicitly call out which side wins for each plugin.

---

## Phase A — Cross-node primitives

Move shared canvas primitives out of `components/canvas/` into `lib/nodes/core/canvas/` so the plugin folders can import them without crossing the `lib/` boundary.

### Task 1: Create the cross-node canvas folder

**Files:**
- Create: `lib/nodes/core/canvas/` (directory only — placeholder created by Task 2)

- [ ] **Step 1: Verify the directory does not yet exist**

Run: `ls lib/nodes/core/canvas 2>&1`
Expected: error "No such file or directory" (this is a sanity check before Task 2 creates files inside it).

### Task 2: Move BaseNode into the core canvas folder

`BaseNode.tsx` is the shared shell every node renders inside (header, status border, handles wrapper). It belongs to `core/canvas/` because it's used by every plugin.

**Files:**
- Create: `lib/nodes/core/canvas/BaseNode.tsx` (move from `components/canvas/BaseNode.tsx`)
- Delete: `components/canvas/BaseNode.tsx`
- Modify importers:
  - `components/canvas/AIGeneratorNode.tsx:10`
  - `components/canvas/BlurNode.tsx:8`
  - `components/canvas/CompositorNode.tsx` (verify import line via grep)
  - `components/canvas/MediaInputNode.tsx` (verify)
  - `components/canvas/PromptNode.tsx:7`
  - `components/canvas/CustomNode.tsx:8` (will be deleted in Task 4 — update anyway for consistency)
  - any other file importing `@/components/canvas/BaseNode` or `./BaseNode`

- [ ] **Step 1: List every importer of BaseNode**

Run: `grep -rn "components/canvas/BaseNode\|from '\./BaseNode'\|from '\.\./BaseNode'" lib components app hooks --include="*.ts" --include="*.tsx"`
Record every file path and line number returned. The exhaustive list must be patched in Step 3.

- [ ] **Step 2: Move the file**

Run: `git mv components/canvas/BaseNode.tsx lib/nodes/core/canvas/BaseNode.tsx`

- [ ] **Step 3: Update every importer to use the new path**

For each file recorded in Step 1, replace the import path with `@/lib/nodes/core/canvas/BaseNode`. Example:

```diff
- import BaseNode from '@/components/canvas/BaseNode';
+ import BaseNode from '@/lib/nodes/core/canvas/BaseNode';
```

The relative-path importers inside `components/canvas/` (e.g. `import BaseNode from './BaseNode'`) also switch to the absolute alias because those source files are about to move in later tasks.

- [ ] **Step 4: Verify no stale references remain**

Run: `grep -rn "components/canvas/BaseNode\|from '\./BaseNode'" lib components app hooks --include="*.ts" --include="*.tsx"`
Expected: no output.

- [ ] **Step 5: Lint and build**

Run: `npm run lint`
Expected: passes (or the same lint warnings as the pre-task baseline; do not introduce new ones).

Run: `npm run build`
Expected: builds successfully.

- [ ] **Step 6: Commit**

```bash
git add lib/nodes/core/canvas/BaseNode.tsx components app hooks lib
git commit -m "refactor(nodes): move BaseNode to lib/nodes/core/canvas"
```

### Task 3: Move NodeHeader into the core canvas folder

Same pattern as Task 2 — `NodeHeader.tsx` is a cross-node primitive.

**Files:**
- Create: `lib/nodes/core/canvas/NodeHeader.tsx` (move from `components/canvas/NodeHeader.tsx`)
- Delete: `components/canvas/NodeHeader.tsx`
- Modify: every importer of `@/components/canvas/NodeHeader` or `./NodeHeader`.

- [ ] **Step 1: List every importer of NodeHeader**

Run: `grep -rn "components/canvas/NodeHeader\|from '\./NodeHeader'\|from '\.\./NodeHeader'" lib components app hooks --include="*.ts" --include="*.tsx"`
Record results.

- [ ] **Step 2: Move the file**

Run: `git mv components/canvas/NodeHeader.tsx lib/nodes/core/canvas/NodeHeader.tsx`

- [ ] **Step 3: Update every importer**

Replace path with `@/lib/nodes/core/canvas/NodeHeader` in each file recorded in Step 1.

- [ ] **Step 4: Verify no stale references**

Run: `grep -rn "components/canvas/NodeHeader\|from '\./NodeHeader'" lib components app hooks --include="*.ts" --include="*.tsx"`
Expected: no output.

- [ ] **Step 5: Lint and build**

Run: `npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add lib/nodes/core/canvas/NodeHeader.tsx components app hooks lib
git commit -m "refactor(nodes): move NodeHeader to lib/nodes/core/canvas"
```

### Task 4: Move GroupNode out of components/canvas/ and delete unused CustomNode

`GroupNode.tsx` is an editor primitive (visual grouping layout), not a workflow plugin — no executor, no shared def. It belongs to `components/editor/`. `CustomNode.tsx` is referenced only in a code comment in `AIGeneratorNode.tsx` and is otherwise unused.

**Files:**
- Move: `components/canvas/GroupNode.tsx` → `components/editor/GroupNode.tsx`
- Modify: `components/editor/reactflow-types.ts:4` (importer of GroupNode)
- Delete: `components/canvas/CustomNode.tsx`

- [ ] **Step 1: Verify CustomNode has no real importers**

Run: `grep -rn "from.*['\"].*canvas/CustomNode['\"]\|import CustomNode" lib components app hooks --include="*.ts" --include="*.tsx"`
Expected: no output (the comment-only mention in `AIGeneratorNode.tsx` does not match this pattern; if any real import shows up, stop and report).

- [ ] **Step 2: Move GroupNode**

Run: `git mv components/canvas/GroupNode.tsx components/editor/GroupNode.tsx`

- [ ] **Step 3: Update GroupNode's importer**

In `components/editor/reactflow-types.ts:4`, change:

```diff
- import GroupNode from '@/components/canvas/GroupNode';
+ import GroupNode from '@/components/editor/GroupNode';
```

- [ ] **Step 4: Delete CustomNode**

Run: `git rm components/canvas/CustomNode.tsx`

- [ ] **Step 5: Verify no stale references**

Run: `grep -rn "components/canvas/GroupNode\|components/canvas/CustomNode" lib components app hooks --include="*.ts" --include="*.tsx"`
Expected: no output.

- [ ] **Step 6: Lint and build**

Run: `npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add components
git commit -m "refactor(canvas): move GroupNode to editor folder, delete unused CustomNode"
```

---

## Phase B — Migrate Blur

Migrate the blur plugin to the target structure (definition.ts, executor.server.ts, executor.client.ts, component.tsx, index.ts) without yet changing the runtime path. `handlers.ts` keeps working; the plugin folder's `executor.ts` continues to be the registered server executor (it just gets renamed).

### Task 5: Move BlurNode into the blur plugin folder

The current `lib/nodes/plugins/blur/component.tsx` is a one-line wrapper around `components/canvas/BlurNode.tsx`. We collapse them into a single file.

**Files:**
- Move: `components/canvas/BlurNode.tsx` → `lib/nodes/plugins/blur/component.tsx` (overwriting the wrapper)
- Delete: previously-existing `lib/nodes/plugins/blur/component.tsx` content (overwritten by the move)
- Modify: `lib/nodes/core/client-registry.ts` (already imports from the plugin folder via `blurClientDef` — no change to the registry needed; only the plugin internals change)

- [ ] **Step 1: Read the existing wrapper to capture its public surface**

Run: `cat lib/nodes/plugins/blur/component.tsx`
Capture: it currently exports `blurClientDef: NodeClientDef`. The new file must keep this export.

- [ ] **Step 2: Move BlurNode.tsx into the plugin folder, overwriting the wrapper**

Run:
```
git mv -f components/canvas/BlurNode.tsx lib/nodes/plugins/blur/component.tsx.tmp
git rm lib/nodes/plugins/blur/component.tsx
git mv lib/nodes/plugins/blur/component.tsx.tmp lib/nodes/plugins/blur/component.tsx
```

- [ ] **Step 3: Append the `blurClientDef` export to the moved file**

Open `lib/nodes/plugins/blur/component.tsx` and at the top of the file replace any existing imports of `BaseNode` (`@/components/canvas/BaseNode`) with `@/lib/nodes/core/canvas/BaseNode` (already done in Task 2 for the source file, but this is in a new path now — verify). Also update:

```diff
- import { BlurConfig } from '@/lib/nodes/plugins/blur/types';
+ import { BlurConfig } from './types';
```

```diff
- import { ImageObject } from '@/lib/nodes/types';
+ import { ImageObject } from '@/lib/nodes/types'; // unchanged for now; moved to definition.ts in Phase H
```

At the bottom of the file, append the client-def export:

```ts
import React, { memo as memoForDef } from 'react';
import { NodeClientDef } from '../../core/types';
import { blurSharedDef } from './index';
import { blurClientExecutor } from './client-blur';

export const blurClientDef: NodeClientDef = {
    ...blurSharedDef,
    component: memoForDef((props: any) => <BlurNode {...props} type="blur" />),
    clientExecutor: blurClientExecutor,
};

export default BlurNode;
```

(If the file already has a default export of `BlurNode` from the previous `export default memo(BlurNode)` line, keep it and just add the named `blurClientDef` export.)

- [ ] **Step 4: Update consumers of the OLD BlurNode path**

The only consumers should be the plugin folder itself (the now-deleted wrapper) and any test/scratch files. Verify with grep:

Run: `grep -rn "components/canvas/BlurNode" lib components app hooks --include="*.ts" --include="*.tsx"`
Expected: no output.

- [ ] **Step 5: Lint and build**

Run: `npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add lib components
git commit -m "refactor(blur): collapse canvas component into plugin folder"
```

### Task 6: Rename Blur plugin files to the uniform convention

Rename `index.ts` → `definition.ts` (will absorb `types.ts` later in Task 7), `executor.ts` → `executor.server.ts`, `client-blur.ts` → `executor.client.ts`. Add a new minimal `index.ts` barrel.

**Files:**
- Rename: `lib/nodes/plugins/blur/index.ts` → `lib/nodes/plugins/blur/definition.ts`
- Rename: `lib/nodes/plugins/blur/executor.ts` → `lib/nodes/plugins/blur/executor.server.ts`
- Rename: `lib/nodes/plugins/blur/client-blur.ts` → `lib/nodes/plugins/blur/executor.client.ts`
- Create: `lib/nodes/plugins/blur/index.ts` (new barrel)
- Modify importers of `'@/lib/nodes/plugins/blur'`, `'../plugins/blur'`, etc.

- [ ] **Step 1: Identify importers of the old paths**

Run: `grep -rn "plugins/blur/executor\|plugins/blur/client-blur\|plugins/blur'\|plugins/blur\"" lib components app hooks --include="*.ts" --include="*.tsx"`
Record the results.

- [ ] **Step 2: Rename the files**

Run:
```
git mv lib/nodes/plugins/blur/index.ts lib/nodes/plugins/blur/definition.ts
git mv lib/nodes/plugins/blur/executor.ts lib/nodes/plugins/blur/executor.server.ts
git mv lib/nodes/plugins/blur/client-blur.ts lib/nodes/plugins/blur/executor.client.ts
```

- [ ] **Step 3: Create the new barrel `index.ts`**

Write `lib/nodes/plugins/blur/index.ts`:

```ts
// Public surface of the blur plugin.
// IMPORTANT: this barrel must NOT export executor.server.ts.
// executor.server.ts imports `sharp`, which is server-only and would leak
// into the client bundle if surfaced here. Server code imports from
// './executor.server' explicitly via the server-registry barrel.
export { blurSharedDef, type BlurConfig } from './definition';
export { blurClientDef, default as BlurNode } from './component';
export { blurClientExecutor } from './executor.client';
```

- [ ] **Step 4: Update intra-plugin imports inside the renamed files**

In `lib/nodes/plugins/blur/component.tsx`, change:

```diff
- import { blurSharedDef } from './index';
+ import { blurSharedDef } from './definition';
```

```diff
- import { blurClientExecutor } from './client-blur';
+ import { blurClientExecutor } from './executor.client';
```

In `lib/nodes/plugins/blur/executor.client.ts` and `lib/nodes/plugins/blur/executor.server.ts`, leave imports of `./types` alone for now (Task 7 absorbs `types.ts` into `definition.ts`).

- [ ] **Step 5: Update the three core registries**

In `lib/nodes/core/shared-registry.ts:5`, change:

```diff
- import { blurSharedDef } from '../plugins/blur';
+ import { blurSharedDef } from '../plugins/blur/definition';
```

In `lib/nodes/core/client-registry.ts:5`, change:

```diff
- import { blurClientDef } from '../plugins/blur/component';
+ import { blurClientDef } from '../plugins/blur';
```

In `lib/nodes/core/server-registry.ts:8-9`, change:

```diff
- import { blurSharedDef } from '../plugins/blur';
- import { blurExecutor } from '../plugins/blur/executor';
+ import { blurSharedDef } from '../plugins/blur/definition';
+ import { blurExecutor } from '../plugins/blur/executor.server';
```

- [ ] **Step 6: Verify no other importers reference the old paths**

Run: `grep -rn "plugins/blur/executor[^.]\|plugins/blur/client-blur" lib components app hooks --include="*.ts" --include="*.tsx"`
Expected: no output.

Run: `grep -rn "plugins/blur/index" lib components app hooks --include="*.ts" --include="*.tsx"`
Expected: no output (importers should use either `'./blur/definition'` or the bare `'./blur'` directory).

- [ ] **Step 7: Lint and build**

Run: `npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add lib
git commit -m "refactor(blur): rename plugin files to uniform convention"
```

### Task 7: Merge BlurConfig type into definition.ts

The `types.ts` file holds only `BlurConfig`. Inline it into `definition.ts` so all "what is this node" lives in one file.

**Files:**
- Modify: `lib/nodes/plugins/blur/definition.ts` (absorb types)
- Delete: `lib/nodes/plugins/blur/types.ts`
- Modify importers of `'./types'` inside the blur folder

- [ ] **Step 1: Read the current types.ts content**

Run: `cat lib/nodes/plugins/blur/types.ts`

Expected content (verify before merging):

```ts
export interface BlurConfig {
    radius: number;
    edgeMode?: 'clamp' | 'wrap' | 'mirror';
}
```

- [ ] **Step 2: Append the BlurConfig interface to definition.ts**

In `lib/nodes/plugins/blur/definition.ts`, replace:

```diff
- import { BlurConfig } from './types';
+ // BlurConfig is defined below — this plugin's config TS lives with the shared def.
+ export interface BlurConfig {
+     radius: number;
+     edgeMode?: 'clamp' | 'wrap' | 'mirror';
+ }
```

Also remove the `export * from './types';` line if present.

- [ ] **Step 3: Update intra-plugin importers of `./types`**

In `lib/nodes/plugins/blur/executor.server.ts`:

```diff
- import { BlurConfig } from './types';
+ import { BlurConfig } from './definition';
```

In `lib/nodes/plugins/blur/executor.client.ts`:

```diff
- import { BlurConfig } from './types';
+ import { BlurConfig } from './definition';
```

In `lib/nodes/plugins/blur/component.tsx`:

```diff
- import { BlurConfig } from './types';
+ import { BlurConfig } from './definition';
```

- [ ] **Step 4: Update external importers of the old path**

Run: `grep -rn "plugins/blur/types" lib components app hooks --include="*.ts" --include="*.tsx"`

For each result, change `@/lib/nodes/plugins/blur/types` → `@/lib/nodes/plugins/blur/definition`.

- [ ] **Step 5: Delete types.ts**

Run: `git rm lib/nodes/plugins/blur/types.ts`

- [ ] **Step 6: Lint and build**

Run: `npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add lib
git commit -m "refactor(blur): merge types.ts into definition.ts"
```

---

## Phase C — Migrate Compositor

### Task 8: Move CompositorNode into the compositor plugin folder

**Files:**
- Move: `components/canvas/CompositorNode.tsx` → `lib/nodes/plugins/compositor/component.tsx` (overwriting the wrapper)
- Modify: imports inside the moved file

- [ ] **Step 1: Read the wrapper to capture its public surface**

Run: `cat lib/nodes/plugins/compositor/component.tsx`
Capture: it exports `compositorClientDef: NodeClientDef`.

- [ ] **Step 2: Move CompositorNode**

Run:
```
git rm lib/nodes/plugins/compositor/component.tsx
git mv components/canvas/CompositorNode.tsx lib/nodes/plugins/compositor/component.tsx
```

- [ ] **Step 3: Append the `compositorClientDef` export and fix imports**

Open `lib/nodes/plugins/compositor/component.tsx`:

- Update relative paths inside the file:
  - `import BaseNode from '@/components/canvas/BaseNode'` → `import BaseNode from '@/lib/nodes/core/canvas/BaseNode'` (Task 2 already moved BaseNode — confirm path)
  - `import CompositorEditorModal from '@/components/compositor/CompositorEditorModal'` — leave for now; Task 9 moves it.
  - `import { CompositorLayerNodes, RenderableLayer } from '@/components/compositor/CompositorRenderer'` — leave for now; Task 9 moves it.
  - `import { CompositorConfig, CompositorLayer, calculateInitialTransform } from '@/lib/nodes/types'` — leave for now; Phase H moves it.

- At the end of the file, append:

```ts
import { memo as memoForDef } from 'react';
import { NodeClientDef } from '../../core/types';
import { compositorSharedDef } from './definition'; // file rename happens in Task 10; this import will resolve after Task 10 if executed in order
import { compositorClientExecutor } from './executor.client';

export const compositorClientDef: NodeClientDef = {
    ...compositorSharedDef,
    component: memoForDef((props: any) => <CompositorNode {...props} type="compositor" />),
    clientExecutor: compositorClientExecutor,
};

export default CompositorNode;
```

If executing Task 8 alone before Task 10, temporarily import from `./index` and `./client-compositor` instead, then re-update after Task 10. To avoid ordering pain, **prefer to execute Tasks 8, 9, and 10 in one commit unit** (one logical migration).

- [ ] **Step 4: Verify no stale `components/canvas/CompositorNode` references**

Run: `grep -rn "components/canvas/CompositorNode" lib components app hooks --include="*.ts" --include="*.tsx"`
Expected: no output.

- [ ] **Step 5: Lint and build**

Run: `npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add lib components
git commit -m "refactor(compositor): collapse canvas component into plugin folder"
```

### Task 9: Move components/compositor/ into plugins/compositor/ui/

The Konva editor modal and renderer are compositor-specific heavy UI. Per spec, they live inside the plugin folder under `ui/`.

**Files:**
- Create: `lib/nodes/plugins/compositor/ui/EditorModal.tsx` (move from `components/compositor/CompositorEditorModal.tsx`)
- Create: `lib/nodes/plugins/compositor/ui/Renderer.tsx` (move from `components/compositor/CompositorRenderer.tsx`)
- Delete: `components/compositor/` (entire folder once empty)
- Modify importers — at minimum:
  - `lib/nodes/plugins/compositor/component.tsx` (just-moved file)
  - any other consumer found by grep

- [ ] **Step 1: Identify all importers of components/compositor/**

Run: `grep -rn "components/compositor/" lib components app hooks --include="*.ts" --include="*.tsx"`
Record results. The expected set is just `lib/nodes/plugins/compositor/component.tsx`.

- [ ] **Step 2: Create the ui subfolder and move files**

Run:
```
mkdir -p lib/nodes/plugins/compositor/ui
git mv components/compositor/CompositorEditorModal.tsx lib/nodes/plugins/compositor/ui/EditorModal.tsx
git mv components/compositor/CompositorRenderer.tsx lib/nodes/plugins/compositor/ui/Renderer.tsx
```

- [ ] **Step 3: Update internal imports in the moved files**

In `lib/nodes/plugins/compositor/ui/EditorModal.tsx`:

```diff
- import { CompositorConfig, CompositorLayer, LayerTransform, calculateInitialTransform } from '@/lib/nodes/types';
+ import { CompositorConfig, CompositorLayer, LayerTransform, calculateInitialTransform } from '@/lib/nodes/types'; // unchanged for now; Phase H moves these
```

(Other imports — Konva, framer-motion, lucide, etc. — stay the same.)

In `lib/nodes/plugins/compositor/ui/Renderer.tsx`:

```diff
- import { CompositorLayer, LayerTransform } from '@/lib/nodes/types';
+ import { CompositorLayer, LayerTransform } from '@/lib/nodes/types'; // unchanged for now; Phase H moves these
```

- [ ] **Step 4: Update component.tsx to import from the new ui paths**

In `lib/nodes/plugins/compositor/component.tsx`:

```diff
- import CompositorEditorModal from '@/components/compositor/CompositorEditorModal';
+ import CompositorEditorModal from './ui/EditorModal';
```

```diff
- import { CompositorLayerNodes, RenderableLayer } from '@/components/compositor/CompositorRenderer';
+ import { CompositorLayerNodes, RenderableLayer } from './ui/Renderer';
```

- [ ] **Step 5: Delete the now-empty components/compositor/ folder**

Run:
```
rmdir components/compositor 2>/dev/null || true
```

(`git mv` already staged the deletes — `rmdir` just clears the empty directory if any local untracked files remain.)

- [ ] **Step 6: Verify no stale references**

Run: `grep -rn "components/compositor" lib components app hooks --include="*.ts" --include="*.tsx"`
Expected: no output.

- [ ] **Step 7: Lint and build**

Run: `npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add lib components
git commit -m "refactor(compositor): move Konva editor + renderer into plugin ui subfolder"
```

### Task 10: Rename Compositor plugin files to the uniform convention

**Files:**
- Rename: `lib/nodes/plugins/compositor/index.ts` → `lib/nodes/plugins/compositor/definition.ts`
- Rename: `lib/nodes/plugins/compositor/executor.ts` → `lib/nodes/plugins/compositor/executor.server.ts`
- Rename: `lib/nodes/plugins/compositor/client-compositor.ts` → `lib/nodes/plugins/compositor/executor.client.ts`
- Create: `lib/nodes/plugins/compositor/index.ts` (new barrel)
- Modify: registries + intra-plugin imports

- [ ] **Step 1: Identify importers of old compositor paths**

Run: `grep -rn "plugins/compositor/executor\|plugins/compositor/client-compositor\|plugins/compositor'\|plugins/compositor\"" lib components app hooks --include="*.ts" --include="*.tsx"`

- [ ] **Step 2: Rename files**

Run:
```
git mv lib/nodes/plugins/compositor/index.ts lib/nodes/plugins/compositor/definition.ts
git mv lib/nodes/plugins/compositor/executor.ts lib/nodes/plugins/compositor/executor.server.ts
git mv lib/nodes/plugins/compositor/client-compositor.ts lib/nodes/plugins/compositor/executor.client.ts
```

- [ ] **Step 3: Create the new barrel `index.ts`**

Write `lib/nodes/plugins/compositor/index.ts`:

```ts
// Public surface of the compositor plugin.
// IMPORTANT: this barrel must NOT export executor.server.ts (server-only).
export { compositorSharedDef } from './definition';
export { compositorClientDef, default as CompositorNode } from './component';
export { compositorClientExecutor } from './executor.client';
```

(`CompositorConfig`, `CompositorLayer`, etc. are re-exported here only after Phase H, when they move into `definition.ts`.)

- [ ] **Step 4: Update intra-plugin imports**

In `lib/nodes/plugins/compositor/component.tsx`:

```diff
- import { compositorSharedDef } from './index';
+ import { compositorSharedDef } from './definition';
```

```diff
- import { compositorClientExecutor } from './client-compositor';
+ import { compositorClientExecutor } from './executor.client';
```

- [ ] **Step 5: Update the three core registries**

`lib/nodes/core/shared-registry.ts:4`:

```diff
- import { compositorSharedDef } from '../plugins/compositor';
+ import { compositorSharedDef } from '../plugins/compositor/definition';
```

`lib/nodes/core/client-registry.ts:4`:

```diff
- import { compositorClientDef } from '../plugins/compositor/component';
+ import { compositorClientDef } from '../plugins/compositor';
```

`lib/nodes/core/server-registry.ts:6-7`:

```diff
- import { compositorSharedDef } from '../plugins/compositor';
- import { compositorExecutor } from '../plugins/compositor/executor';
+ import { compositorSharedDef } from '../plugins/compositor/definition';
+ import { compositorExecutor } from '../plugins/compositor/executor.server';
```

- [ ] **Step 6: Verify no stale references**

Run: `grep -rn "plugins/compositor/executor[^.]\|plugins/compositor/client-compositor\|plugins/compositor/index" lib components app hooks --include="*.ts" --include="*.tsx"`
Expected: no output.

- [ ] **Step 7: Lint and build**

Run: `npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add lib
git commit -m "refactor(compositor): rename plugin files to uniform convention"
```

---

## Phase D — Migrate MediaInput

### Task 11: Move MediaInputNode and rename plugin files

**Files:**
- Move: `components/canvas/MediaInputNode.tsx` → `lib/nodes/plugins/media_input/component.tsx` (overwriting the wrapper)
- Rename: `lib/nodes/plugins/media_input/index.ts` → `lib/nodes/plugins/media_input/definition.ts`
- Rename: `lib/nodes/plugins/media_input/executor.ts` → `lib/nodes/plugins/media_input/executor.server.ts`
- Create: `lib/nodes/plugins/media_input/index.ts` (new barrel)
- Modify: registries + intra-plugin imports

- [ ] **Step 1: Read the existing wrapper to capture exports**

Run: `cat lib/nodes/plugins/media_input/component.tsx`
Capture: it exports `mediaInputClientDef: NodeClientDef`.

- [ ] **Step 2: Identify external importers of the old paths**

Run: `grep -rn "plugins/media_input/executor\|plugins/media_input'\|plugins/media_input\"" lib components app hooks --include="*.ts" --include="*.tsx"`

Run: `grep -rn "components/canvas/MediaInputNode" lib components app hooks --include="*.ts" --include="*.tsx"`

- [ ] **Step 3: Move and rename files**

Run:
```
git rm lib/nodes/plugins/media_input/component.tsx
git mv components/canvas/MediaInputNode.tsx lib/nodes/plugins/media_input/component.tsx
git mv lib/nodes/plugins/media_input/index.ts lib/nodes/plugins/media_input/definition.ts
git mv lib/nodes/plugins/media_input/executor.ts lib/nodes/plugins/media_input/executor.server.ts
```

- [ ] **Step 4: Append the `mediaInputClientDef` export to the moved component**

Open `lib/nodes/plugins/media_input/component.tsx`. Update internal imports:
- `BaseNode` import → `@/lib/nodes/core/canvas/BaseNode` (already moved in Task 2).
- Append at the bottom:

```ts
import { memo as memoForDef } from 'react';
import { NodeClientDef } from '../../core/types';
import { mediaInputSharedDef } from './definition';

export const mediaInputClientDef: NodeClientDef = {
    ...mediaInputSharedDef,
    component: memoForDef((props: any) => <MediaInputNode {...props} type="media_input" />),
};

export default MediaInputNode;
```

(Media Input has no client executor — the field is omitted.)

- [ ] **Step 5: Create the new barrel `index.ts`**

Write `lib/nodes/plugins/media_input/index.ts`:

```ts
export { mediaInputSharedDef } from './definition';
export { mediaInputClientDef, default as MediaInputNode } from './component';
```

- [ ] **Step 6: Update the three core registries**

`lib/nodes/core/shared-registry.ts:3`:

```diff
- import { mediaInputSharedDef } from '../plugins/media_input';
+ import { mediaInputSharedDef } from '../plugins/media_input/definition';
```

`lib/nodes/core/client-registry.ts:2`:

```diff
- import { mediaInputClientDef } from '../plugins/media_input/component';
+ import { mediaInputClientDef } from '../plugins/media_input';
```

`lib/nodes/core/server-registry.ts:2-3`:

```diff
- import { mediaInputSharedDef } from '../plugins/media_input';
- import { mediaInputExecutor } from '../plugins/media_input/executor';
+ import { mediaInputSharedDef } from '../plugins/media_input/definition';
+ import { mediaInputExecutor } from '../plugins/media_input/executor.server';
```

- [ ] **Step 7: Update other consumers**

`lib/workflow/handlers.ts:9`:

```diff
- import { mediaInputExecutor } from '../nodes/plugins/media_input/executor';
+ import { mediaInputExecutor } from '../nodes/plugins/media_input/executor.server';
```

(Note: `handlers.ts` will be deleted in Phase G, but it must keep building during Phase D.)

- [ ] **Step 8: Verify no stale references**

Run: `grep -rn "components/canvas/MediaInputNode\|plugins/media_input/executor[^.]\|plugins/media_input/index" lib components app hooks --include="*.ts" --include="*.tsx"`
Expected: no output.

- [ ] **Step 9: Lint and build**

Run: `npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 10: Commit**

```bash
git add lib components
git commit -m "refactor(media_input): consolidate plugin into uniform structure"
```

---

## Phase E — Migrate Prompt

### Task 12: Move PromptNode and rename plugin files

**Files:**
- Move: `components/canvas/PromptNode.tsx` → `lib/nodes/plugins/prompt/component.tsx` (overwriting the wrapper)
- Rename: `lib/nodes/plugins/prompt/index.ts` → `lib/nodes/plugins/prompt/definition.ts`
- Rename: `lib/nodes/plugins/prompt/executor.ts` → `lib/nodes/plugins/prompt/executor.server.ts`
- Create: `lib/nodes/plugins/prompt/index.ts` (new barrel)
- Modify: registries + intra-plugin imports

- [ ] **Step 1: Read the existing wrapper to capture exports**

Run: `cat lib/nodes/plugins/prompt/component.tsx`
Capture: it exports `promptClientDef: NodeClientDef`.

- [ ] **Step 2: Identify external importers of the old paths**

Run: `grep -rn "plugins/prompt/executor\|plugins/prompt'\|plugins/prompt\"\|components/canvas/PromptNode" lib components app hooks --include="*.ts" --include="*.tsx"`

- [ ] **Step 3: Move and rename files**

Run:
```
git rm lib/nodes/plugins/prompt/component.tsx
git mv components/canvas/PromptNode.tsx lib/nodes/plugins/prompt/component.tsx
git mv lib/nodes/plugins/prompt/index.ts lib/nodes/plugins/prompt/definition.ts
git mv lib/nodes/plugins/prompt/executor.ts lib/nodes/plugins/prompt/executor.server.ts
```

- [ ] **Step 4: Append the `promptClientDef` export**

Open `lib/nodes/plugins/prompt/component.tsx`. Update:
- `BaseNode` import → `@/lib/nodes/core/canvas/BaseNode`.
- Append at the bottom:

```ts
import { memo as memoForDef } from 'react';
import { NodeClientDef } from '../../core/types';
import { promptSharedDef } from './definition';

export const promptClientDef: NodeClientDef = {
    ...promptSharedDef,
    component: memoForDef((props: any) => <PromptNode {...props} type="prompt" />),
};

export default PromptNode;
```

- [ ] **Step 5: Create the new barrel `index.ts`**

Write `lib/nodes/plugins/prompt/index.ts`:

```ts
export { promptSharedDef } from './definition';
export { promptClientDef, default as PromptNode } from './component';
```

- [ ] **Step 6: Update the three core registries**

`lib/nodes/core/shared-registry.ts:2`:

```diff
- import { promptSharedDef } from '../plugins/prompt';
+ import { promptSharedDef } from '../plugins/prompt/definition';
```

`lib/nodes/core/client-registry.ts:3`:

```diff
- import { promptClientDef } from '../plugins/prompt/component';
+ import { promptClientDef } from '../plugins/prompt';
```

`lib/nodes/core/server-registry.ts:4-5`:

```diff
- import { promptSharedDef } from '../plugins/prompt';
- import { promptExecutor } from '../plugins/prompt/executor';
+ import { promptSharedDef } from '../plugins/prompt/definition';
+ import { promptExecutor } from '../plugins/prompt/executor.server';
```

- [ ] **Step 7: Verify no stale references**

Run: `grep -rn "components/canvas/PromptNode\|plugins/prompt/executor[^.]\|plugins/prompt/index" lib components app hooks --include="*.ts" --include="*.tsx"`
Expected: no output.

- [ ] **Step 8: Lint and build**

Run: `npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 9: Commit**

```bash
git add lib components
git commit -m "refactor(prompt): consolidate plugin into uniform structure"
```

---

## Phase F — Migrate AI Generator (build new plugin folder)

`ai_generator` does not currently have a plugin folder. We create one and migrate four scattered pieces into it: the inline shared def, the standalone executor, the canvas component, and the property panel.

### Task 13: Scaffold the ai_generator plugin folder skeleton

**Files:**
- Create: `lib/nodes/plugins/ai_generator/definition.ts`
- Create: `lib/nodes/plugins/ai_generator/index.ts`

- [ ] **Step 1: Create the folder**

Run: `mkdir -p lib/nodes/plugins/ai_generator`

- [ ] **Step 2: Create definition.ts with the inline shared def from shared-registry.ts**

Write `lib/nodes/plugins/ai_generator/definition.ts` with the contents currently inlined at `lib/nodes/core/shared-registry.ts:15-74`:

```ts
import { NodeSharedDef } from '../../core/types';

export interface AIGeneratorConfig {
    model_id?: number;
    node_type_id?: string;
    control_values?: Record<string, any>;
    last_output?: any;
}

export const aiGeneratorSharedDef: NodeSharedDef<AIGeneratorConfig> = {
    type: 'ai_generator',
    family: 'generative',
    category: 'generative',
    meta: {
        label: 'AI Model',
        // The original inline def used color: 'rgb(var(--accent-primary))'.
        // Preserve that value verbatim. description and icon also preserved.
        description: '', // (none currently set)
        color: 'rgb(var(--accent-primary))',
        icon: 'Zap',
    } as any,
    handles: {
        inputs: [
            { id: 'trigger', label: 'Trigger', expectedType: 'any', isMandatory: false } as any,
            { id: 'prompt', label: 'Prompt', expectedType: 'text', isMandatory: false } as any,
            { id: 'image', label: 'Image Input', expectedType: 'image', isMandatory: false } as any,
        ],
        outputs: [
            { id: 'output', label: 'Result', dataType: 'any' } as any,
            { id: 'trigger_out', label: 'Complete', dataType: 'any' } as any,
        ],
    },
    defaultConfig: {
        model_id: undefined,
        control_values: {},
    },
    aiSchema: {
        type: 'object',
        properties: {
            model_id: { type: 'number', description: 'ID of the selected ai_models row.' },
            control_values: { type: 'object', description: 'Per-model control values keyed by api_mapping_key.' },
        },
    },
};
```

(The `as any` casts replicate the same casts used inline today — the inline literal also used `as any`. Behavior is preserved exactly.)

- [ ] **Step 3: Create a placeholder index.ts**

Write `lib/nodes/plugins/ai_generator/index.ts`:

```ts
export { aiGeneratorSharedDef, type AIGeneratorConfig } from './definition';
// component, properties, and executor exports added in subsequent tasks.
```

- [ ] **Step 4: Lint and build**

Run: `npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add lib/nodes/plugins/ai_generator
git commit -m "refactor(ai_generator): scaffold plugin folder with definition extracted from shared-registry"
```

### Task 14: Move ai-generator-executor.ts into the plugin folder

**Files:**
- Move: `lib/nodes/core/ai-generator-executor.ts` → `lib/nodes/plugins/ai_generator/executor.server.ts`
- Modify: `lib/nodes/core/server-registry.ts:10` (importer)

- [ ] **Step 1: Identify all importers**

Run: `grep -rn "core/ai-generator-executor\|aiGeneratorExecutor" lib components app hooks --include="*.ts" --include="*.tsx"`

Expected importers:
- `lib/nodes/core/server-registry.ts:10` (`import { aiGeneratorExecutor } from './ai-generator-executor';`)
- the file itself

- [ ] **Step 2: Move the file**

Run: `git mv lib/nodes/core/ai-generator-executor.ts lib/nodes/plugins/ai_generator/executor.server.ts`

- [ ] **Step 3: Fix relative imports inside the moved file**

Open `lib/nodes/plugins/ai_generator/executor.server.ts`. The file uses these imports:

```ts
import { NodeExecutor, NodeExecutionResult, ExecutionContext } from '../types';
import { replicate, normalizeReplicateOutput } from '@/lib/ai/replicate-client';
import { isOutputEnvelope } from '@/lib/workflow/result-format';
```

After the move, the relative import path is one extra level deep. Update:

```diff
- import { NodeExecutor, NodeExecutionResult, ExecutionContext } from '../types';
+ import { NodeExecutor, NodeExecutionResult, ExecutionContext } from '../../types';
```

The two `@/`-prefixed imports do not change.

- [ ] **Step 4: Update server-registry.ts**

`lib/nodes/core/server-registry.ts:10`:

```diff
- import { aiGeneratorExecutor } from './ai-generator-executor';
+ import { aiGeneratorExecutor } from '../plugins/ai_generator/executor.server';
```

- [ ] **Step 5: Verify no stale references**

Run: `grep -rn "core/ai-generator-executor" lib components app hooks --include="*.ts" --include="*.tsx"`
Expected: no output.

- [ ] **Step 6: Lint and build**

Run: `npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add lib
git commit -m "refactor(ai_generator): move executor into plugin folder"
```

### Task 15: Move AIGeneratorNode and AIGeneratorProperties into the plugin folder

**Files:**
- Move: `components/canvas/AIGeneratorNode.tsx` → `lib/nodes/plugins/ai_generator/component.tsx`
- Move: `components/canvas/AIGeneratorProperties.tsx` → `lib/nodes/plugins/ai_generator/properties.tsx`
- Modify: every importer (client-registry.ts, ModelForm.tsx, reactflow-types.ts)

- [ ] **Step 1: Identify all importers**

Run: `grep -rn "components/canvas/AIGeneratorNode\|components/canvas/AIGeneratorProperties" lib components app hooks --include="*.ts" --include="*.tsx"`

Expected importers:
- `lib/nodes/core/client-registry.ts:6-7`
- `components/admin/ModelForm.tsx:14`
- `components/editor/reactflow-types.ts:3` (AIGeneratorNode only)

- [ ] **Step 2: Move the files**

Run:
```
git mv components/canvas/AIGeneratorNode.tsx lib/nodes/plugins/ai_generator/component.tsx
git mv components/canvas/AIGeneratorProperties.tsx lib/nodes/plugins/ai_generator/properties.tsx
```

- [ ] **Step 3: Fix imports inside the moved files**

In `lib/nodes/plugins/ai_generator/component.tsx`:
- `import BaseNode from '@/components/canvas/BaseNode'` → `import BaseNode from '@/lib/nodes/core/canvas/BaseNode'`
- All other imports already use `@/...` aliases — leave them.

In `lib/nodes/plugins/ai_generator/properties.tsx`:
- Replace any `./AIGeneratorNode` relative import with `./component` (verify by grep; the file may not have this).

- [ ] **Step 4: Update external importers to the new paths**

In `lib/nodes/core/client-registry.ts:6-7`:

```diff
- import AIGeneratorNode from '@/components/canvas/AIGeneratorNode';
- import AIGeneratorProperties from '@/components/canvas/AIGeneratorProperties';
+ import AIGeneratorNode from '@/lib/nodes/plugins/ai_generator/component';
+ import AIGeneratorProperties from '@/lib/nodes/plugins/ai_generator/properties';
```

In `components/admin/ModelForm.tsx:14`:

```diff
- import AIGeneratorProperties from '@/components/canvas/AIGeneratorProperties';
+ import AIGeneratorProperties from '@/lib/nodes/plugins/ai_generator/properties';
```

In `components/editor/reactflow-types.ts:3`:

```diff
- import AIGeneratorNode from '@/components/canvas/AIGeneratorNode';
+ import AIGeneratorNode from '@/lib/nodes/plugins/ai_generator/component';
```

- [ ] **Step 5: Append AI generator exports to the plugin barrel**

Edit `lib/nodes/plugins/ai_generator/index.ts`:

```ts
export { aiGeneratorSharedDef, type AIGeneratorConfig } from './definition';
export { default as AIGeneratorNode } from './component';
export { default as AIGeneratorProperties } from './properties';
```

- [ ] **Step 6: Verify no stale references**

Run: `grep -rn "components/canvas/AIGenerator" lib components app hooks --include="*.ts" --include="*.tsx"`
Expected: no output.

- [ ] **Step 7: Lint and build**

Run: `npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add lib components
git commit -m "refactor(ai_generator): move canvas component and properties into plugin folder"
```

### Task 16: Replace inline ai_generator def in shared-registry.ts with the plugin import

**Files:**
- Modify: `lib/nodes/core/shared-registry.ts` (drop the inline `ai_generator` literal, import from the plugin)
- Modify: `lib/nodes/core/client-registry.ts` (use a single `aiGeneratorClientDef` instead of inline `{ component, propertyPanel }`)

- [ ] **Step 1: Add a clientDef export in the ai_generator plugin**

Append to `lib/nodes/plugins/ai_generator/component.tsx`:

```ts
import { memo as memoForDef } from 'react';
import { NodeClientDef } from '../../core/types';
import { aiGeneratorSharedDef } from './definition';
import AIGeneratorPropertiesImport from './properties';

export const aiGeneratorClientDef: NodeClientDef = {
    ...aiGeneratorSharedDef,
    component: memoForDef((props: any) => <AIGeneratorNode {...props} type="ai_generator" />),
    propertyPanel: AIGeneratorPropertiesImport,
} as any;
```

The `as any` mirrors the cast used in the previous inline registration (`{ component, propertyPanel } as any`).

- [ ] **Step 2: Re-export the clientDef from the plugin barrel**

Update `lib/nodes/plugins/ai_generator/index.ts`:

```ts
export { aiGeneratorSharedDef, type AIGeneratorConfig } from './definition';
export { default as AIGeneratorNode, aiGeneratorClientDef } from './component';
export { default as AIGeneratorProperties } from './properties';
```

- [ ] **Step 3: Replace the inline def in shared-registry.ts**

Open `lib/nodes/core/shared-registry.ts`. Replace the entire file with:

```ts
import { NodeSharedDef } from './types';
import { promptSharedDef } from '../plugins/prompt/definition';
import { mediaInputSharedDef } from '../plugins/media_input/definition';
import { compositorSharedDef } from '../plugins/compositor/definition';
import { blurSharedDef } from '../plugins/blur/definition';
import { aiGeneratorSharedDef } from '../plugins/ai_generator/definition';

export const sharedRegistry: Record<string, NodeSharedDef<any>> = {
    prompt: promptSharedDef,
    media_input: mediaInputSharedDef,
    compositor: compositorSharedDef,
    blur: blurSharedDef,
    ai_generator: aiGeneratorSharedDef,
};
```

- [ ] **Step 4: Replace the inline ai_generator entry in client-registry.ts**

Open `lib/nodes/core/client-registry.ts`. Replace the entire file with:

```ts
import { NodeClientDef } from './types';
import { mediaInputClientDef } from '../plugins/media_input';
import { compositorClientDef } from '../plugins/compositor';
import { promptClientDef } from '../plugins/prompt';
import { blurClientDef } from '../plugins/blur';
import { aiGeneratorClientDef, AIGeneratorNode } from '../plugins/ai_generator';

export const clientRegistry: Record<string, NodeClientDef> = {
    prompt: promptClientDef,
    media_input: mediaInputClientDef,
    compositor: compositorClientDef,
    blur: blurClientDef,
    ai_generator: aiGeneratorClientDef,
};

export const FallbackNode = AIGeneratorNode;
```

- [ ] **Step 5: Update server-registry.ts to import the shared def from its new home**

`lib/nodes/core/server-registry.ts`. Replace the inline `ai_generator` entry. The file becomes:

```ts
import { NodeServerDef } from './types';
import { mediaInputSharedDef } from '../plugins/media_input/definition';
import { mediaInputExecutor } from '../plugins/media_input/executor.server';
import { promptSharedDef } from '../plugins/prompt/definition';
import { promptExecutor } from '../plugins/prompt/executor.server';
import { compositorSharedDef } from '../plugins/compositor/definition';
import { compositorExecutor } from '../plugins/compositor/executor.server';
import { blurSharedDef } from '../plugins/blur/definition';
import { blurExecutor } from '../plugins/blur/executor.server';
import { aiGeneratorSharedDef } from '../plugins/ai_generator/definition';
import { aiGeneratorExecutor } from '../plugins/ai_generator/executor.server';

export const serverRegistry: Record<string, NodeServerDef> = {
    prompt: { ...promptSharedDef, executor: promptExecutor },
    media_input: { ...mediaInputSharedDef, executor: mediaInputExecutor },
    compositor: { ...compositorSharedDef, executor: compositorExecutor },
    blur: { ...blurSharedDef, executor: blurExecutor },
    ai_generator: { ...aiGeneratorSharedDef, executor: aiGeneratorExecutor },
};

export function isEphemeralNode(type: string): boolean {
    const def = serverRegistry[type];
    return !!def && def.family !== 'generative';
}
```

(The new `isEphemeralNode` export is added now; callers are switched over in Phase G.)

- [ ] **Step 6: Lint and build**

Run: `npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add lib
git commit -m "refactor(ai_generator): replace inline shared/client defs with plugin imports"
```

---

## Phase G — Server-execution unification

This is the highest-risk phase: switch the runtime to call `serverRegistry[type].executor` directly and delete `handlers.ts`. The behavior contract: **the post-refactor flow must produce the same `node_results` rows (same `result_type`, same URLs in `result_data`, same upload bucket) as today's `handlers.ts` flow**.

The current runtime flow today:
1. `EPHEMERAL_HANDLERS[type](properties, inputs)` returns `Buffer | string | object`.
2. `ephemeral-executor.ts` (and `dispatch-ephemeral/route.ts`) interprets that result: if Buffer → upload to `workflow-ephemeral-tmp`, set `result_type='image'`, `result_data=[publicUrl]`. If string → `result_type='text'`. Otherwise infer.

The post-refactor flow:
1. `serverRegistry[type].executor(config, inputs, context)` returns `NodeExecutionResult { success, data, error?, status? }`.
2. The plugin executor performs its own upload (when applicable) and returns `data` already populated with URLs / text / structured output.
3. `ephemeral-executor.ts` reads `result.data`, infers `result_type` (image/text/json/etc.) using existing helpers, and writes the row.

Each plugin's `executor.server.ts` is rewritten in-place to match `handlers.ts` behavior verbatim, with the upload + envelope wrap folded in.

### Task 17: Rewrite blur/executor.server.ts to match handlers.ts behavior + self-upload

**Files:**
- Modify: `lib/nodes/plugins/blur/executor.server.ts` (full rewrite — replace the dual-environment file)

**Source of truth:** `lib/workflow/handlers.ts:60-89` (`handleBlur`). Notably:
- Reads `imageUrl` from `inputs.image`.
- `radius = config.radius || 5` — passed directly to `sharp().blur()`. **No** `(radius/100)*20` rescale.
- **No** `type` switch (`gaussian`/`box`/`stack`) — the old plugin executor's `type` branching is dead and is dropped.
- Returns the buffer; the wrapper uploads to `workflow-ephemeral-tmp`.

The new executor folds the upload in.

- [ ] **Step 1: Replace the entire file content**

Overwrite `lib/nodes/plugins/blur/executor.server.ts` with:

```ts
import sharp from 'sharp';
import { ExecutionContext, NodeExecutionResult, ImageObject } from '../../types';
import { BlurConfig } from './definition';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * Blur server executor.
 *
 * Behavior preserved from the previous lib/workflow/handlers.ts handleBlur:
 *   - Reads imageUrl from inputs.image
 *   - Uses config.radius directly (no UI rescale, no type switch)
 *   - Uploads the result PNG to the workflow-ephemeral-tmp bucket
 *   - Returns NodeExecutionResult with data: [ImageObject]
 */
export const blurExecutor = async (
    config: BlurConfig,
    inputs: Record<string, any>,
    context: ExecutionContext,
): Promise<NodeExecutionResult> => {
    try {
        const imageUrl = inputs?.image;
        if (!imageUrl || typeof imageUrl !== 'string') {
            return { success: false, data: null, error: 'Blur node requires "image" input' };
        }

        const radius = (config?.radius ?? 5) as number;

        console.log(`[BlurExecutor] Applying blur with radius ${radius} to ${imageUrl}`);

        const imageResponse = await fetch(imageUrl);
        if (!imageResponse.ok) {
            return { success: false, data: null, error: `Failed to fetch image: ${imageResponse.statusText}` };
        }
        const inputBuffer = Buffer.from(await imageResponse.arrayBuffer());

        const outputBuffer = await sharp(inputBuffer).blur(radius).toBuffer({ resolveWithObject: true });
        const meta = await sharp(outputBuffer.data).metadata();

        const supabase = createServiceClient();
        const filename = `${context.executionId}/${context.nodeId}/blur_${Date.now()}.png`;

        const { error: uploadError } = await supabase.storage
            .from('workflow-ephemeral-tmp')
            .upload(filename, outputBuffer.data, { contentType: 'image/png', cacheControl: '3600' });
        if (uploadError) {
            return { success: false, data: null, error: `Storage upload failed: ${uploadError.message}` };
        }

        const { data: urlData } = supabase.storage.from('workflow-ephemeral-tmp').getPublicUrl(filename);

        const result: ImageObject = {
            url: urlData.publicUrl,
            resolution: { width: meta.width || 0, height: meta.height || 0 },
            metadata: {
                format: meta.format || 'png',
                size: outputBuffer.info.size,
                hasTransparency: meta.hasAlpha || false,
            },
        };

        return { success: true, data: [result] };
    } catch (err) {
        return { success: false, data: null, error: err instanceof Error ? err.message : 'Unknown blur error' };
    }
};
```

- [ ] **Step 2: Confirm no client-side code path remains in this file**

Run: `grep -n "isBrowser\|window\|document\|canvas" lib/nodes/plugins/blur/executor.server.ts`
Expected: no output. The browser branch lives in `executor.client.ts`.

- [ ] **Step 3: Lint and build**

Run: `npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add lib/nodes/plugins/blur/executor.server.ts
git commit -m "refactor(blur): make server executor self-contained, match handlers.ts behavior"
```

### Task 18: Rewrite compositor/executor.server.ts to match handlers.ts behavior + self-upload

**Source of truth:** `lib/workflow/handlers.ts:313-404` (`handleCompositor`). Notably:
- Canvas size from `config.canvasWidth`/`canvasHeight` defaulting to 1080×1080, rounded.
- Layers from `config.layers || []`.
- Per-layer image URL is `inputs[layer.sourceHandleId]` (a single URL string, NOT an array indexed by `layer.selectedIndex`).
- Per-layer transform uses `tf.width`, `tf.height`, `tf.x`, `tf.y`, `tf.rotation`, `tf.flipX`, `tf.flipY`.
- Layers processed via `Promise.all`.
- Output format: `config.outputFormat` ('png'|'jpg'|'jpeg'|'webp'), default 'png'. JPEG/WebP quality = `Math.round((config.outputQuality || 1) * 100)`.
- Returns the buffer; the wrapper uploads to `workflow-ephemeral-tmp`.

The new executor folds the upload in. **It does NOT use the plugin's previous `chat-assets` upload path** — that diverges from runtime behavior.

- [ ] **Step 1: Overwrite the file**

Replace `lib/nodes/plugins/compositor/executor.server.ts` with:

```ts
import sharp from 'sharp';
import { ExecutionContext, NodeExecutionResult, CompositorConfig, ImageObject } from '../../types';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * Compositor server executor.
 *
 * Behavior preserved from the previous lib/workflow/handlers.ts handleCompositor:
 *   - Reads each layer's source URL from inputs[layer.sourceHandleId] (NOT an array index)
 *   - Layers processed in parallel via Promise.all
 *   - Skips invisible layers and layers with no input mapped
 *   - Per-layer fetch + resize/rotate/flip pipeline
 *   - Output format from config.outputFormat (png/jpg/jpeg/webp), default png
 *   - Uploads result to workflow-ephemeral-tmp (NOT chat-assets — that was the dead plugin executor path)
 */
export const compositorExecutor = async (
    config: CompositorConfig,
    inputs: Record<string, any>,
    context: ExecutionContext,
): Promise<NodeExecutionResult> => {
    try {
        const width = Math.round(config?.canvasWidth || 1080);
        const height = Math.round(config?.canvasHeight || 1080);
        const layers = (config?.layers || []) as any[];
        const outputFormat = (config?.outputFormat || 'png') as string;
        const outputQuality = config?.outputQuality ?? 1.0;

        console.log(`[CompositorExecutor] Canvas ${width}x${height}, ${layers.length} layers`);

        let baseCanvas = sharp({
            create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
        });

        const layerResults = await Promise.all(
            layers.map(async (layer: any) => {
                if (!layer.visible) return null;
                const imageUrl = inputs[layer.sourceHandleId];
                if (!imageUrl || typeof imageUrl !== 'string') return null;
                try {
                    const response = await fetch(imageUrl);
                    if (!response.ok) throw new Error(`Failed to fetch image: ${response.statusText}`);
                    const inputBuffer = Buffer.from(await response.arrayBuffer());
                    const tf = layer.transform || {};
                    const targetW = Math.max(1, Math.round(tf.width || width));
                    const targetH = Math.max(1, Math.round(tf.height || height));
                    const rotation = tf.rotation || 0;

                    let imgSharp = sharp(inputBuffer).resize(targetW, targetH, { fit: 'fill' });
                    if (tf.flipX) imgSharp = imgSharp.flop();
                    if (tf.flipY) imgSharp = imgSharp.flip();
                    if (rotation !== 0) {
                        imgSharp = imgSharp.rotate(rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } });
                    }

                    const processedBuffer = await imgSharp.toBuffer();
                    return {
                        input: processedBuffer,
                        left: Math.round(tf.x || 0),
                        top: Math.round(tf.y || 0),
                    };
                } catch (err) {
                    console.error(`[CompositorExecutor] Layer ${layer.name} failed:`, err);
                    return null;
                }
            }),
        );

        const overlays = layerResults.filter(
            (o): o is { input: Buffer; left: number; top: number } => o !== null,
        );
        if (overlays.length > 0) baseCanvas = baseCanvas.composite(overlays);

        let finalBuffer: Buffer;
        let contentType: string;
        if (outputFormat === 'jpg' || outputFormat === 'jpeg') {
            finalBuffer = await baseCanvas.jpeg({ quality: Math.round(outputQuality * 100) }).toBuffer();
            contentType = 'image/jpeg';
        } else if (outputFormat === 'webp') {
            finalBuffer = await baseCanvas.webp({ quality: Math.round(outputQuality * 100) }).toBuffer();
            contentType = 'image/webp';
        } else {
            finalBuffer = await baseCanvas.png().toBuffer();
            contentType = 'image/png';
        }

        const supabase = createServiceClient();
        const ext = outputFormat === 'jpg' ? 'jpg' : outputFormat === 'jpeg' ? 'jpeg' : outputFormat === 'webp' ? 'webp' : 'png';
        const filename = `${context.executionId}/${context.nodeId}/compositor_${Date.now()}.${ext}`;

        const { error: uploadError } = await supabase.storage
            .from('workflow-ephemeral-tmp')
            .upload(filename, finalBuffer, { contentType, cacheControl: '3600' });
        if (uploadError) {
            return { success: false, data: null, error: `Storage upload failed: ${uploadError.message}` };
        }

        const { data: urlData } = supabase.storage.from('workflow-ephemeral-tmp').getPublicUrl(filename);

        const result: ImageObject = {
            url: urlData.publicUrl,
            resolution: { width, height },
            metadata: { format: outputFormat, source: 'Compositor', processedBy: 'ServerSharp' },
        };

        return { success: true, data: [result] };
    } catch (err) {
        return { success: false, data: null, error: err instanceof Error ? err.message : 'Compositor failed' };
    }
};
```

- [ ] **Step 2: Confirm no client-side branches remain**

Run: `grep -n "isBrowser\|window\|document\|chat-assets" lib/nodes/plugins/compositor/executor.server.ts`
Expected: no output.

- [ ] **Step 3: Lint and build**

Run: `npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add lib/nodes/plugins/compositor/executor.server.ts
git commit -m "refactor(compositor): make server executor self-contained, match handlers.ts behavior"
```

### Task 19: Verify media_input/executor.server.ts produces a self-contained NodeExecutionResult

The current `mediaInputExecutor` already returns `{ success, data: ImageObject[] }`. `handleMediaInput` just unwraps that. So nothing changes for media_input — but verify.

- [ ] **Step 1: Read the current executor**

Run: `cat lib/nodes/plugins/media_input/executor.server.ts`

Verify it returns `{ success: true, data: imageObjects }` on success and `{ success: false, data: null, error }` on failure. No upload involved (Media Input passes through user-provided URLs unchanged).

- [ ] **Step 2: No code change required for this task — only verification**

If the file has any divergence from this contract, document it and stop. Otherwise no commit is produced for Task 19.

### Task 20: Rewrite prompt/executor.server.ts to match handlers.ts behavior

**Source of truth:** `lib/workflow/handlers.ts:292-307` (`handlePrompt`). Notably:
- Reads `text` from `properties.prompt`, then `properties.text`, then `properties.config?.text`, then `properties.config?.prompt`, falling back to `''`.
- Returns the string directly; the wrapper sets `result_type='text'`, `result_data=[text]`.

The current `promptExecutor` only reads `config.text` — narrower than the runtime path. Restore the broader fallback set, and return `NodeExecutionResult` with `data: [text]`.

- [ ] **Step 1: Replace the file**

Overwrite `lib/nodes/plugins/prompt/executor.server.ts`:

```ts
import { NodeExecutionResult, ExecutionContext, PromptConfig } from '../../types';

/**
 * Prompt server executor.
 *
 * Behavior preserved from the previous lib/workflow/handlers.ts handlePrompt —
 * checks four config-key locations because historically the prompt text has
 * lived under any of these keys.
 */
export const promptExecutor = async (
    config: PromptConfig & { prompt?: string; config?: { text?: string; prompt?: string } },
    _inputs: Record<string, any>,
    _context: ExecutionContext,
): Promise<NodeExecutionResult> => {
    const text =
        (config as any)?.prompt ||
        (config as any)?.text ||
        (config as any)?.config?.text ||
        (config as any)?.config?.prompt ||
        '';

    return { success: true, data: [String(text)] };
};
```

- [ ] **Step 2: Lint and build**

Run: `npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add lib/nodes/plugins/prompt/executor.server.ts
git commit -m "refactor(prompt): match handlers.ts fallback config-key behavior"
```

### Task 21: Update ephemeral-executor.ts to call serverRegistry directly

**Files:**
- Modify: `lib/workflow/ephemeral-executor.ts`

The new flow: load graph → build inputs → call `serverRegistry[type].executor` → consume `NodeExecutionResult` → infer `result_type` → write `node_results` row. The old buffer-upload-loop is removed because each plugin executor now uploads internally.

- [ ] **Step 1: Replace the file's logic**

Overwrite `lib/workflow/ephemeral-executor.ts` with:

```ts
/**
 * Workflow Engine v2 — Ephemeral Node Executor (post-refactor).
 *
 * Executes ephemeral nodes by calling serverRegistry[type].executor directly.
 * Each plugin's server executor is responsible for uploading any binary
 * outputs it produces. This wrapper only handles graph loading, input
 * gathering, and writing the final node_results row.
 */
import { createServiceClient } from '@/lib/supabase/service';
import { serverRegistry } from '@/lib/nodes/core/server-registry';
import { GraphJson, NodeState } from './types-v2';
import {
  NodeResultType,
  getPrimaryInputValue,
  inferResultTypeFromValue,
  normalizeNodeResultType,
  toResultDataForType,
} from './result-format';
import type { ExecutionContext, NodeExecutionResult } from '@/lib/nodes/types';

export async function executeEphemeralNode(
  executionId: string,
  nodeId: string,
  sessionId?: string,
  providedInputs?: Record<string, any>,
): Promise<{ success: boolean; result_type?: NodeResultType; result_data?: any[]; error?: string }> {
  console.log(`[EphemeralExecutor] Processing node ${nodeId} in execution ${executionId} (Session: ${sessionId})`);

  const supabase = createServiceClient();
  let currentSessionId = sessionId;

  try {
    const { data: execution, error: fetchError } = await supabase
      .from('executions').select('*').eq('id', executionId).single();
    if (fetchError || !execution) throw new Error(`Execution ${executionId} not found`);

    if (!currentSessionId) currentSessionId = execution.session_id;

    let graph: GraphJson = execution.graph_json;
    if (!graph) {
      const { data: session } = await supabase
        .from('sessions').select('canvas_state').eq('id', execution.session_id).single();
      graph = session?.canvas_state;
    }
    if (!graph) throw new Error(`Graph not found for execution ${executionId}`);

    let inputs = providedInputs;
    if (!inputs) {
      const { data: results } = await supabase
        .from('node_results').select('*').eq('execution_id', executionId);
      const nodeStates: Record<string, any> = {};
      (results || []).forEach((r: any) => {
        nodeStates[r.node_id] = {
          status: r.status,
          result_type: r.result_type,
          result_data: r.result_data,
          error: r.error,
        };
      });
      inputs = buildNodeInputs(nodeId, graph, nodeStates);
    }

    const node = graph.nodes.find((n) => n.id === nodeId);
    if (!node) throw new Error(`Node ${nodeId} not found in graph`);

    const def = serverRegistry[node.type];
    if (!def) throw new Error(`No server registry entry for node type: ${node.type}`);

    // The plugin executor sees the same shape it used to — `node.data` is the
    // node's full data envelope (containing `config`, `label`, etc.). Plugins
    // historically read either `properties.config` or `properties` directly,
    // so we pass `node.data` as the first arg, matching the previous
    // EPHEMERAL_HANDLERS convention.
    const config = (node.data as any)?.config ?? node.data ?? {};
    const ctx: ExecutionContext = {
      workflowId: graph.id || '',
      executionId,
      sessionId: currentSessionId,
      userId: execution.user_id,
      nodeId,
      data: {},
    };

    console.log(`[EphemeralExecutor] Executing ${node.type} with inputs:`, Object.keys(inputs || {}));

    const result: NodeExecutionResult = await def.executor(config, inputs || {}, ctx);

    if (!result?.success) {
      throw new Error(result?.error || 'Executor returned failure');
    }

    // Infer result_type and result_data from the executor's `data` payload.
    let resultType: NodeResultType = 'json';
    let resultData: any[] = [];

    if (Array.isArray(result.data)) {
      // Conventional plugin shape: array of items (ImageObject[], string[], etc.).
      const first = result.data[0];
      if (first && typeof first === 'object' && typeof (first as any).url === 'string') {
        resultType = 'image';
        resultData = result.data.map((d: any) => d.url);
      } else if (typeof first === 'string') {
        resultType = 'text';
        resultData = result.data;
      } else {
        resultType = inferResultTypeFromValue(result.data);
        resultData = toResultDataForType(resultType, result.data);
      }
    } else if (typeof result.data === 'string') {
      resultType = 'text';
      resultData = [result.data];
    } else if (result.data !== null && result.data !== undefined) {
      resultType = inferResultTypeFromValue(result.data);
      resultData = toResultDataForType(resultType, result.data);
    }

    const { error: updateError } = await supabase.from('node_results').upsert({
      execution_id: executionId,
      node_id: nodeId,
      session_id: currentSessionId,
      status: 'completed',
      result_type: resultType,
      result_data: resultData,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'execution_id,node_id' });

    if (updateError) throw new Error(`Failed to update node state: ${updateError.message}`);

    console.log(`[EphemeralExecutor] Node ${nodeId} completed`);
    return { success: true, result_type: resultType, result_data: resultData };
  } catch (error) {
    console.error(`[EphemeralExecutor] Error in node ${nodeId}:`, error);
    try {
      await supabase.from('node_results').upsert({
        execution_id: executionId,
        node_id: nodeId,
        session_id: currentSessionId,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Execution failed',
        updated_at: new Date().toISOString(),
      }, { onConflict: 'execution_id,node_id' });
    } catch (dbErr) {
      console.error('[EphemeralExecutor] Could not update failed status:', dbErr);
    }
    return { success: false, error: error instanceof Error ? error.message : 'Internal server error' };
  }
}

function buildNodeInputs(
  nodeId: string,
  graph: GraphJson,
  nodeStates: Record<string, NodeState>,
): Record<string, any> {
  const inputs: Record<string, any> = {};
  const incomingEdges = (graph.edges || []).filter((edge) => edge.target === nodeId);
  for (const edge of incomingEdges) {
    const sourceNodeState = nodeStates[edge.source];
    if (sourceNodeState?.status === 'completed') {
      const inputKey = edge.targetHandle || edge.sourceHandle || 'image';
      if (sourceNodeState.result_type && sourceNodeState.result_data) {
        inputs[inputKey] = getPrimaryInputValue(
          normalizeNodeResultType(sourceNodeState.result_type),
          sourceNodeState.result_data,
        );
      } else if ((sourceNodeState as any).result_url) {
        inputs[inputKey] = (sourceNodeState as any).result_url;
      } else {
        inputs[inputKey] = (sourceNodeState as any).output;
      }
    }
  }
  return inputs;
}
```

- [ ] **Step 2: Lint and build**

Run: `npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 3: Commit**

```bash
git add lib/workflow/ephemeral-executor.ts
git commit -m "refactor(workflow): ephemeral-executor calls serverRegistry directly"
```

### Task 22: Update dispatch-ephemeral/route.ts to use serverRegistry

**Files:**
- Modify: `app/api/executions/dispatch-ephemeral/route.ts`

Same pattern as Task 21 — replace the `EPHEMERAL_HANDLERS[type]` call site and the buffer-upload loop with a single `serverRegistry[type].executor(config, inputs, context)` call followed by the same `node_results` write logic.

- [ ] **Step 1: Read the current file fully**

Run: `cat app/api/executions/dispatch-ephemeral/route.ts`

Note: this file is parallel to `ephemeral-executor.ts` — it duplicates much of the same logic for the HTTP-triggered dispatch path. Apply the same conversion.

- [ ] **Step 2: Replace the EPHEMERAL_HANDLERS call**

In the route handler, replace:

```diff
- import { EPHEMERAL_HANDLERS } from '@/lib/workflow/handlers';
+ import { serverRegistry } from '@/lib/nodes/core/server-registry';
+ import type { ExecutionContext, NodeExecutionResult } from '@/lib/nodes/types';
```

```diff
- const handler = EPHEMERAL_HANDLERS[node.type];
- if (!handler) {
-   return NextResponse.json({ error: `No handler for node type: ${node.type}` }, { status: 400 });
- }
- const output = await handler(node.data || {}, inputs);
+ const def = serverRegistry[node.type];
+ if (!def) {
+   return NextResponse.json({ error: `No registry entry for node type: ${node.type}` }, { status: 400 });
+ }
+ const config = (node.data as any)?.config ?? node.data ?? {};
+ const ctx: ExecutionContext = {
+   workflowId: graph.id || '',
+   executionId: execution_id,
+   sessionId: execution.session_id,
+   userId: execution.user_id,
+   nodeId: node_id,
+   data: {},
+ };
+ const result: NodeExecutionResult = await def.executor(config, inputs || {}, ctx);
+ if (!result?.success) {
+   throw new Error(result?.error || 'Executor returned failure');
+ }
+ const output = result.data; // remainder of the function reads `output` to derive result_type/result_data
```

Then replace the buffer-handling block (which today uploads to `workflow-ephemeral-tmp`) with the same `result.data`-shape inference logic from Task 21:

```ts
let resultType: NodeResultType = 'json';
let resultData: any[] = [];

if (Array.isArray(output)) {
  const first = output[0];
  if (first && typeof first === 'object' && typeof (first as any).url === 'string') {
    resultType = 'image';
    resultData = output.map((d: any) => d.url);
  } else if (typeof first === 'string') {
    resultType = 'text';
    resultData = output;
  } else {
    resultType = inferResultTypeFromValue(output);
    resultData = toResultDataForType(resultType, output);
  }
} else if (typeof output === 'string') {
  resultType = 'text';
  resultData = [output];
} else if (output !== null && output !== undefined) {
  resultType = inferResultTypeFromValue(output);
  resultData = toResultDataForType(resultType, output);
}
```

(The exact code structure depends on how the route currently writes the row. Preserve whatever post-success logic the file has — `checkAndDispatchChildren`, response shape, etc. Only the executor call + result interpretation are swapped.)

- [ ] **Step 3: Lint and build**

Run: `npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add app/api/executions/dispatch-ephemeral/route.ts
git commit -m "refactor(api): dispatch-ephemeral route uses serverRegistry directly"
```

### Task 23: Switch isEphemeralNode callers to the server-registry implementation

**Files:**
- Modify: `lib/workflow/dispatch-v2.ts:9` (importer)
- Modify: `app/api/executions/start/route.ts:23` (importer)

- [ ] **Step 1: Replace the import in dispatch-v2.ts**

```diff
- import { isEphemeralNode } from './handlers';
+ import { isEphemeralNode } from '@/lib/nodes/core/server-registry';
```

- [ ] **Step 2: Replace the import in start/route.ts**

```diff
- import { isEphemeralNode } from '@/lib/workflow/handlers';
+ import { isEphemeralNode } from '@/lib/nodes/core/server-registry';
```

- [ ] **Step 3: Verify behavior parity**

The new `isEphemeralNode(type)` returns `serverRegistry[type] && family !== 'generative'`. The old version returned `type in EPHEMERAL_HANDLERS`, which contained `blur`, `levels`, `brightness`, `contrast`, `grayscale`, `invert`, `rotate`, `resize`, `prompt`, `compositor`, `media_input`. The orphan handlers (levels, brightness, contrast, grayscale, invert, rotate, resize) are **deleted** by Phase G's end — they were not in the canvas/AI surface anyway, and per Q1 (spec) they go away. So the post-refactor `isEphemeralNode` returns `true` for `blur`, `compositor`, `media_input`, `prompt`, and `false` for `ai_generator` (`family === 'generative'`).

This is the intended set. Confirm by checking each consumer's logic does not rely on the deleted orphan types being ephemeral.

Run: `grep -rn "'levels'\|'brightness'\|'contrast'\|'grayscale'\|'invert'\|'rotate'\|'resize'" lib components app hooks --include="*.ts" --include="*.tsx"`
Expected: no functional consumer (only string-equality checks would matter — none should exist since these never had UI/AI presence).

- [ ] **Step 4: Lint and build**

Run: `npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add lib app
git commit -m "refactor(workflow): isEphemeralNode now imported from server-registry"
```

### Task 24: Delete handlers.ts

Now that nothing imports it, the file goes.

**Files:**
- Delete: `lib/workflow/handlers.ts`

- [ ] **Step 1: Verify no remaining imports**

Run: `grep -rn "lib/workflow/handlers\|from '\./handlers'\|from '\.\./workflow/handlers'\|from '@/lib/workflow/handlers'" lib components app hooks --include="*.ts" --include="*.tsx"`
Expected: no output. (`lib/chat/tools/handlers.ts` is a different file — make sure the grep result is filtered for the workflow path only.)

- [ ] **Step 2: Delete the file**

Run: `git rm lib/workflow/handlers.ts`

- [ ] **Step 3: Verify orphan handler types are not referenced elsewhere**

Run: `grep -rn "handleBlur\|handleLevels\|handleBrightness\|handleContrast\|handleGrayscale\|handleInvert\|handleRotate\|handleResize\|handleCompositor\|handleMediaInput\|handlePrompt\|EPHEMERAL_HANDLERS\|HandlerFunction" lib components app hooks --include="*.ts" --include="*.tsx"`
Expected: no output.

- [ ] **Step 4: Lint and build**

Run: `npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add lib
git commit -m "refactor(workflow): delete handlers.ts (consolidated into serverRegistry)"
```

### Task 25: End-to-end smoke test

Manual verification that the runtime path still works for every node type. Run the dev server and exercise each node through the chat flow.

- [ ] **Step 1: Start the dev server**

Run: `npm run dev`
Expected: server starts on port 3000 with no compile errors.

- [ ] **Step 2: Smoke test — Prompt + AI Generator**

In a browser, open a fresh chat session. Send: "generate a picture of a cat." Wait for the workflow to render (Prompt → AI Generator). Click Run.

Expected:
- Both nodes turn `running`, then `completed`.
- AI Generator output renders an image in chat.
- No errors in browser console or dev-server logs.

- [ ] **Step 3: Smoke test — Blur**

In the same chat: "now blur it." Verify the workflow grows a Blur node downstream of AI Generator. Click Run.

Expected:
- Blur turns `running`, then `completed`.
- Output image is the blurred version.
- The dev-server logs show `[BlurExecutor] Applying blur with radius ...` (not `[Handler/Blur]`).

- [ ] **Step 4: Smoke test — Compositor**

Open the Compositor node's editor (Konva modal). Verify it loads without errors and that adding/moving a layer + clicking "Run" produces a composited PNG with the correct layout.

Expected:
- The Konva editor renders.
- Server-side compositor runs to completion.
- The output appears identical to pre-refactor behavior.

- [ ] **Step 5: Smoke test — Media Input**

Drop a Media Input node, upload an image, connect it to Blur, run. Verify the uploaded image flows through.

- [ ] **Step 6: If any smoke test fails, capture logs and stop**

The implementation is incorrect — return to the failing task and reconcile behavior with `git log -p` against the deleted `handlers.ts` to find the divergence.

- [ ] **Step 7: No commit produced for this task** (verification only).

---

## Phase H — Type cleanup

`lib/nodes/types.ts` currently mixes per-plugin configs with cross-cutting types. Move each per-plugin config into its plugin's `definition.ts` and update all importers.

### Task 26: Move BlurConfig out of lib/nodes/types.ts

`BlurConfig` already exists in `lib/nodes/plugins/blur/definition.ts` (added in Task 7). The duplicate copy in `lib/nodes/types.ts` is removed.

**Files:**
- Modify: `lib/nodes/types.ts` (remove BlurConfig)
- Modify: any importer of `BlurConfig` from `lib/nodes/types`

- [ ] **Step 1: List importers of BlurConfig**

Run: `grep -rn "BlurConfig.*from.*'@/lib/nodes/types'\|BlurConfig.*from.*'\.\./types'" lib components app hooks --include="*.ts" --include="*.tsx"`

- [ ] **Step 2: Update each importer to use the plugin's definition**

For each result, change the import to `'@/lib/nodes/plugins/blur/definition'`.

- [ ] **Step 3: Remove BlurConfig from lib/nodes/types.ts**

Open `lib/nodes/types.ts` and delete the `BlurConfig` interface declaration. Also remove `BlurConfig` from the `NodeConfig` union type if present:

```diff
- export type NodeConfig =
-     | AIGenerateImageConfig
-     | MediaInputConfig
-     | CompositorConfig
-     | PromptConfig
-     | AIGeneratorConfig
-     | BlurConfig;
+ export type NodeConfig =
+     | AIGenerateImageConfig
+     | MediaInputConfig
+     | CompositorConfig
+     | PromptConfig
+     | AIGeneratorConfig;
```

(Successive tasks below will collapse this union further; for now BlurConfig leaves the union, the others stay until their tasks.)

- [ ] **Step 4: Lint and build**

Run: `npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add lib
git commit -m "refactor(types): BlurConfig lives only in blur/definition.ts"
```

### Task 27: Move CompositorConfig + LayerTransform + CompositorLayer + calculateInitialTransform out of lib/nodes/types.ts

**Files:**
- Modify: `lib/nodes/plugins/compositor/definition.ts` (add the four exports)
- Modify: `lib/nodes/types.ts` (remove them)
- Modify: every importer

- [ ] **Step 1: List importers**

Run: `grep -rn "CompositorConfig\|CompositorLayer\|LayerTransform\|calculateInitialTransform" lib components app hooks --include="*.ts" --include="*.tsx"`
Record results.

- [ ] **Step 2: Move the type declarations and `calculateInitialTransform` function into compositor/definition.ts**

Cut the four declarations from `lib/nodes/types.ts` (verbatim, including JSDoc comments) and paste them into `lib/nodes/plugins/compositor/definition.ts` above the `compositorSharedDef` literal.

- [ ] **Step 3: Update importers to use the plugin path**

For every file in Step 1's grep that imports any of the four from `'@/lib/nodes/types'`, change to `'@/lib/nodes/plugins/compositor/definition'`. Importers inside the compositor plugin itself can use relative paths (`'./definition'`).

Importers known from earlier exploration:
- `components/canvas/CompositorNode.tsx` (now `lib/nodes/plugins/compositor/component.tsx`)
- `components/compositor/CompositorEditorModal.tsx` (now `lib/nodes/plugins/compositor/ui/EditorModal.tsx`)
- `components/compositor/CompositorRenderer.tsx` (now `lib/nodes/plugins/compositor/ui/Renderer.tsx`)
- `lib/store/slices/workflow-slice.ts:8`
- the compositor plugin's own files

- [ ] **Step 4: Update the NodeConfig union**

In `lib/nodes/types.ts`, remove `CompositorConfig` from the union.

- [ ] **Step 5: Re-export from the plugin barrel**

Update `lib/nodes/plugins/compositor/index.ts`:

```ts
export {
    compositorSharedDef,
    type CompositorConfig,
    type CompositorLayer,
    type LayerTransform,
    calculateInitialTransform,
} from './definition';
export { compositorClientDef, default as CompositorNode } from './component';
export { compositorClientExecutor } from './executor.client';
```

- [ ] **Step 6: Lint and build**

Run: `npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add lib components
git commit -m "refactor(types): compositor types live in plugin definition.ts"
```

### Task 28: Move MediaInputConfig out of lib/nodes/types.ts

- [ ] **Step 1: Move the interface**

Cut the `MediaInputConfig` interface from `lib/nodes/types.ts` and paste it into `lib/nodes/plugins/media_input/definition.ts`.

- [ ] **Step 2: Update importers**

Run: `grep -rn "MediaInputConfig" lib components app hooks --include="*.ts" --include="*.tsx"`

For each importer, change `'@/lib/nodes/types'` to `'@/lib/nodes/plugins/media_input/definition'` (or relative path within the plugin).

- [ ] **Step 3: Update the NodeConfig union**

Remove `MediaInputConfig` from the union in `lib/nodes/types.ts`.

- [ ] **Step 4: Re-export from the plugin barrel**

```ts
// lib/nodes/plugins/media_input/index.ts
export { mediaInputSharedDef, type MediaInputConfig } from './definition';
export { mediaInputClientDef, default as MediaInputNode } from './component';
```

- [ ] **Step 5: Lint and build**

Run: `npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add lib components
git commit -m "refactor(types): MediaInputConfig lives in plugin definition.ts"
```

### Task 29: Move PromptConfig out of lib/nodes/types.ts

**Files:**
- Modify: `lib/nodes/plugins/prompt/definition.ts` (add `PromptConfig` export)
- Modify: `lib/nodes/types.ts` (remove `PromptConfig` and drop it from the `NodeConfig` union)
- Modify: every importer of `PromptConfig` from `lib/nodes/types`
- Modify: `lib/nodes/plugins/prompt/index.ts` (re-export `PromptConfig` from the barrel)

- [ ] **Step 1: Cut the PromptConfig interface from lib/nodes/types.ts**

Open `lib/nodes/types.ts` and remove this block:

```ts
/**
 * Prompt Node Configuration
 * Provides a string output to be used as a prompt or search term
 */
export interface PromptConfig {
    text: string;
}
```

- [ ] **Step 2: Paste it into lib/nodes/plugins/prompt/definition.ts**

Add the same block (with its JSDoc) above the `promptSharedDef` literal in `lib/nodes/plugins/prompt/definition.ts`. Update any nearby imports if the file previously pulled `PromptConfig` from `'../../types'` — change those to a local reference.

- [ ] **Step 3: Drop PromptConfig from the NodeConfig union in types.ts**

```diff
  export type NodeConfig =
      | AIGenerateImageConfig
      | MediaInputConfig
      | CompositorConfig
-     | PromptConfig
      | AIGeneratorConfig;
```

(Tasks 27, 28, and 30 may have already removed other entries from this union — apply this change relative to the current state of the file.)

- [ ] **Step 4: List external importers of PromptConfig**

Run: `grep -rn "PromptConfig.*from.*'@/lib/nodes/types'\|PromptConfig.*from.*'\.\./types'\|PromptConfig.*from.*'\.\./\.\./types'" lib components app hooks --include="*.ts" --include="*.tsx"`

For each result, change the import path to `'@/lib/nodes/plugins/prompt/definition'` (or the appropriate relative path for files inside the plugin folder).

- [ ] **Step 5: Re-export from the plugin barrel**

Update `lib/nodes/plugins/prompt/index.ts`:

```ts
export { promptSharedDef, type PromptConfig } from './definition';
export { promptClientDef, default as PromptNode } from './component';
```

- [ ] **Step 6: Lint and build**

Run: `npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add lib components
git commit -m "refactor(types): PromptConfig lives in plugin definition.ts"
```

### Task 30: Move AIGeneratorConfig + AIGenerateImageConfig out of lib/nodes/types.ts

`AIGeneratorConfig` already exists in `lib/nodes/plugins/ai_generator/definition.ts` (Task 13). The duplicate in `lib/nodes/types.ts` is removed.

`AIGenerateImageConfig` is a small legacy type — verify if it's used anywhere first. If unused, delete; if used, move to `lib/nodes/plugins/ai_generator/definition.ts`.

- [ ] **Step 1: Check usage**

Run: `grep -rn "AIGenerateImageConfig\|AIGeneratorConfig" lib components app hooks --include="*.ts" --include="*.tsx"`

- [ ] **Step 2: Move (or delete) and update importers, then drop both from the NodeConfig union**

After this task the `NodeConfig` union is empty (or near-empty). Decide:
- If empty, delete `NodeConfig` entirely. Update `WorkflowNode.data.config` to be typed as `Record<string, any>` or specifically the union of plugin config types via a registry-derived helper.
- If not empty, keep the union with whatever's left.

- [ ] **Step 3: Lint and build**

Run: `npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add lib components
git commit -m "refactor(types): ai_generator types live in plugin definition.ts"
```

### Task 31: Final verification — types.ts is now cross-cutting only

- [ ] **Step 1: Read the current types.ts**

Run: `cat lib/nodes/types.ts`

Expected remaining exports:
- `NodeType`
- `InputHandle`, `OutputHandle`, `Control`, `InputsSchema`, `OutputsSchema`
- `Category`, `NodeTypeRecord`, `AiModel`
- `NodeStatus`
- `ImageObject`
- `WorkflowNode`, `WorkflowEdge`, `Workflow`
- `ExecutionContext`, `NodeExecutionResult`, `NodeExecutor`
- `ExecutionStatus`, `ExecutionRecord`

If any per-plugin type remains, return to the relevant Phase H task.

- [ ] **Step 2: Lint and build**

Run: `npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 3: No commit produced for this task** (verification only).

---

## Phase I — Final cleanup

### Task 32: Remove the empty levels plugin folder and confirm components/canvas/ is empty

- [ ] **Step 1: Confirm components/canvas/ is empty**

Run: `ls components/canvas 2>&1`
Expected: directory does not exist OR contains zero files. Every file should have moved in Phases A–F.

If files remain, list and resolve before proceeding.

- [ ] **Step 2: Delete the empty levels plugin folder**

Run: `ls lib/nodes/plugins/levels 2>&1`
If directory is empty, run: `rmdir lib/nodes/plugins/levels`

- [ ] **Step 3: Confirm components/compositor/ does not exist**

Run: `ls components/compositor 2>&1`
Expected: directory does not exist (deleted in Task 9).

- [ ] **Step 4: Lint and build**

Run: `npm run lint && npm run build`
Expected: both pass.

- [ ] **Step 5: Commit (if any deletes occurred)**

```bash
git add lib components
git commit -m "refactor(nodes): remove empty levels plugin folder and stale canvas dirs"
```

### Task 33: Final lint + build + smoke test pass

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: no new warnings or errors compared to the pre-refactor baseline.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Smoke test (repeat Task 25 in full)**

Re-run all five smoke-test steps from Task 25. Every existing node must execute end-to-end with no observable behavior change.

- [ ] **Step 4: Confirm acceptance criteria from the spec**

Re-read the spec's "Acceptance criteria" section. Verify each item is true:

1. `lib/workflow/handlers.ts` does not exist. → `ls lib/workflow/handlers.ts` should error.
2. Every node in `serverRegistry` has a folder with `definition.ts`, `executor.server.ts`, `component.tsx`, `index.ts`. → `ls lib/nodes/plugins/<name>/` for each of `blur`, `compositor`, `media_input`, `prompt`, `ai_generator`.
3. No file outside `lib/nodes/plugins/` and `lib/nodes/core/canvas/` references a node-specific React component. → grep for any `*Node\.tsx` import outside those paths.
4. `components/canvas/` and `components/compositor/` no longer exist. → `ls` both.
5. `lib/nodes/types.ts` contains only cross-cutting types. → confirmed in Task 31.
6. End-to-end execution flow works for every node. → confirmed in Step 3 above.
7. Adding a new ephemeral node requires creating one folder and appending three lines (one per registry). → no automated check; this is validated when the scaffolding skill is later built against the structure.

- [ ] **Step 5: No commit produced for this task** (verification only).

---

## Self-review checklist (already run)

**Spec coverage:** Every section of the spec maps to at least one task. Specifically — phase A covers cross-node primitives; phases B–F cover the per-plugin migrations enumerated in the spec's "Migration mapping" table; phase G implements the unified runtime path defined in the spec's "Runtime execution path" section; phase H satisfies the spec's `lib/nodes/types.ts` cleanup; phase I validates the final acceptance criteria.

**Placeholder scan:** The plan contains code blocks for every code change, exact file paths, and exact verification commands. There are no "TBD" / "TODO" / "implement later" markers.

**Type consistency:** Across the plan, the executor signature is uniformly `(config, inputs, context) => Promise<NodeExecutionResult>` and `NodeExecutionResult` is `{ success, data, error?, status? }` everywhere. The plugin barrel signature is uniform. `isEphemeralNode` is consistently a function imported from `@/lib/nodes/core/server-registry`. `serverRegistry[type].executor` is the single runtime call site.

**Out-of-scope reminders:** This plan deliberately does NOT introduce the `DefaultNode` / `NodePreview` / `NodeControls` / `AutoPropertyPanel` abstractions described in the spec's "DefaultNode opt-in" section. Per the spec's risk-mitigation, those are left for after the structural move is verified — they are a separate, smaller refactor that converts existing custom components into thin re-exports of `DefaultNode`. Adding them here would inflate scope and risk regressions in current node UIs.
