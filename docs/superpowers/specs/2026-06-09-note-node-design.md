# Note Node — Design Spec

**Date:** 2026-06-09
**Status:** Approved, pending implementation plan

## Summary

A new **note node**: a non-runnable canvas annotation that displays user-typed
text, shows the author's profile picture, and reveals the author's name on
hover. It has no inputs, no outputs, and cannot run — structurally identical to
the existing `group_container` node. It is added via a small inline button in
the node-library search-bar header.

## Goals

- Let users drop free-text notes onto the workflow canvas to annotate / explain
  structure.
- Show *who wrote the note* via a snapshotted author avatar (name on hover).
- Match the existing node design system (no bespoke "sticky note" styling).
- Add it from a compact button inline with the node-library search bar, without
  expanding the panel.

## Non-Goals (YAGNI)

- The chat/AI brain creating note nodes (manual button only).
- Color / style / theme options for the note.
- Resizing handles.
- Multiple authors / editing attribution.
- Any execution, cost, or dispatch behavior.

## Architecture

The note node follows the **`group_container` pattern exactly**: it is a pure
client-side UI node registered only in the shared registry and wired directly
into the React Flow node-type map. It is NOT added to the client or server
plugin registries.

### 1. Registry

**`lib/nodes/core/shared-registry.ts`** — add a `note` entry:

```ts
note: {
  type: 'note',
  family: 'organization',
  category: 'organization',
  meta: {
    label: 'Note',
    color: 'rgb(var(--stroke-subtle))',
    icon: 'StickyNote',
  },
  handles: { inputs: [], outputs: [] },
  defaultConfig: { text: '', author: null },
  aiSchema: {
    type: 'object',
    properties: { text: { type: 'string' } },
  },
  nonExecutable: true,
} as any,
```

The `aiSchema` is included for registry-shape consistency but the note is NOT
advertised in the chat system prompt, so the brain will not emit notes.

### 2. Type union

**`lib/nodes/types.ts`** — add `'note'` to the `NodeType` union.

### 3. Node factory default

**`lib/editor/node-factory.ts`** — add to `defaultConfigs`:

```ts
note: { text: '', author: null },
```

Caller-supplied `initialConfig` (carrying the snapshotted author) merges over
this default via the existing merge logic.

### 4. React Flow component wiring

**`components/editor/reactflow-types.ts`** — import the new component and add it
to `concreteNodeTypes` alongside `group_container`:

```ts
import NoteNode from '@/components/editor/NoteNode';
// ...
const concreteNodeTypes = {
  ...baseNodeTypes,
  ai_generator: AIGeneratorNode,
  legacy: FallbackNode,
  group_container: GroupNode,
  note: NoteNode,
};
```

Note: the existing Proxy resolves *unknown* types to `AIGeneratorNode`, so an
explicit entry here is required to prevent a note rendering as an AI generator.

## Data Shape

```ts
config: {
  text: string;
  author: {
    id: string;
    name: string;
    avatarUrl: string | null;
  } | null;
}
```

- `author` is **snapshotted at creation** from the current logged-in user and
  frozen thereafter. It does not change when a collaborator later opens the
  workflow — it represents *who wrote the note*. (Consistent with the
  `character` node's frozen-snapshot principle.)
- `author` may be `null` if the user could not be resolved at creation; the
  component degrades gracefully (no avatar, or a generic user icon).

## Component — `components/editor/NoteNode.tsx`

Signature mirrors GroupNode: `function NoteNode({ id, data, selected }: NodeProps<NoteNodeData>)`.

- **No handles** rendered (no `<Handle>` elements).
- **Chrome:** compact card using existing design tokens (`surface-elevated`,
  `stroke-subtle`, `content-primary` text). Matches the system node look; not a
  yellow sticky note.
- **Inline editing:** the note text is editable in place. Clicking the note
  focuses a borderless, transparent `<textarea>` pre-filled with
  `config.text`. The textarea auto-sizes to its content. On blur (and/or
  Cmd/Ctrl+Enter), commit via `updateNodeConfig(id, { ...config, text })`.
  - While editing, stop React Flow from hijacking pointer/key events (use the
    `nodrag`/`nopan` class conventions already used by other editable nodes such
    as `prompt`).
- **Avatar:** a small round avatar pinned in a corner of the card.
  - Source: `config.author.avatarUrl`. Fallback: first initial of
    `config.author.name`. Fallback: generic user icon when `author` is null.
  - **Name on hover:** native `title` attribute (or a lightweight tooltip)
    showing `config.author.name`.

## Add Button — node-library search-bar header

**`components/editor/NodeLibraryPanel.tsx`** (header row at the search bar):

- Add a `StickyNote` icon button **inline** in the header row, between the
  search field wrapper and the existing close (`X`) button.
- The search `<input>` wrapper is `flex-1`, so it shrinks automatically to make
  room. The panel does NOT expand and no flyout opens.
- Click handler:
  1. Resolve the current user snapshot: `{ id, name, avatarUrl }`.
  2. `handleAdd({ type: 'note', initialConfig: { author } })` — reuses the
     existing `requestAddNode` → `pendingAddNode` → drop-at-viewport-center
     flow, which calls `createNodeFromType` and closes the panel.

### Current-user avatar resolution

`useCurrentUser` (`lib/hooks/use-current-user.ts`) currently returns only
`{ id, name }`. Extend it (or add a sibling helper) to also resolve
`avatarUrl`, following the same precedence as `UserAvatar`:

1. `profile.avatar_url` (custom profile avatar), if available client-side.
2. `user.user_metadata.avatar_url` (OAuth provider avatar).
3. `null` (component falls back to initials).

The resolved `avatarUrl` is a plain string captured into the note's config at
creation time.

## Non-Execution Safety

Because the note has no handles, no edges can attach to it, so it never enters
the execution graph built from edges (`validate-execution`, `dispatch-v2`). No
changes to those modules are expected. During implementation, confirm that an
isolated, edge-less, `nonExecutable` node is ignored by run/validation paths
(it should be, by construction). If any path enumerates *all* nodes rather than
edge-connected ones, add a `type === 'note'` guard mirroring the existing
`group_container` guards.

## Persistence

Note text and author snapshot live in `node.data.config` and persist through
the existing workflow save/load path (`updateNodeConfig` → `currentWorkflow`
dirty → Supabase workflow row → `loadSession` rehydrate). No schema/migration
changes — the workflow graph is stored as JSON.

## Testing / Verification

No test runner in this repo. Verify with:

- `npx tsc --noEmit` (the reliable type check here; `npm run lint`/`build` are
  unreliable in this environment).
- Manual E2E: add a note via the header button, type text, blur to persist,
  confirm avatar renders and name shows on hover, refresh and confirm text +
  author survive, confirm the note cannot be run and does not appear in run
  plans, confirm copy/paste and group-wrap interactions don't break.

## Files Touched

- `lib/nodes/core/shared-registry.ts` — add `note` shared def.
- `lib/nodes/types.ts` — add `'note'` to `NodeType`.
- `lib/editor/node-factory.ts` — add `note` default config.
- `components/editor/reactflow-types.ts` — wire `NoteNode` into the node map.
- `components/editor/NoteNode.tsx` — **new** component.
- `components/editor/NodeLibraryPanel.tsx` — inline add button in the header.
- `lib/hooks/use-current-user.ts` — extend to resolve `avatarUrl` (or add a
  sibling helper).
