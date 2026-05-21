# Chat ↔ Canvas Selection Reference

When the user selects nodes on the canvas, the chat shows a live indicator of that selection. When they send a message, those nodes are referenced both in the prompt sent to the brain and as a visual marker on the resulting user message bubble. The model's scope stays the whole workflow — the selection is a *focus hint*, not a hard scope.

## Goals

- A user looking at the chat input should be able to tell, at a glance, that the canvas selection is in play.
- The brain should know which nodes the user is pointing at so ambiguous requests ("make it stronger", "remove that one") resolve to the right targets.
- Past messages should remain truthful: if a turn referenced specific nodes, the bubble keeps that fact visible — even after nodes are renamed or deleted.
- Selection must never override the brain's ability to see/edit the whole workflow.

## Non-goals

- No @-mention typeahead syntax in the textarea.
- No new chat command for "only operate on selection" (selection is a hint, not a hard scope).
- No DB schema migration — `messages.metadata` is already JSONB.
- No new test suite (repo has no runner; verification is `npx tsc --noEmit` + manual).

## Architecture

One source of truth for "what's selected right now." React Flow's per-node `selected` flag lives in `EditorCanvas`'s `localNodes`; chat cannot see it directly. We lift it into the Zustand workflow slice as `currentSelectedNodeIds: string[]`, updated from `EditorCanvas` via React Flow's `onSelectionChange` callback. Chat reads from the slice — no React Flow imports leak into the chat tree.

```
┌─────────────────┐    onSelectionChange   ┌────────────────────────┐
│ EditorCanvas    │ ─────────────────────▶ │ workflow-slice         │
│ (React Flow)    │ ◀──── clear/center ─── │ currentSelectedNodeIds │
└─────────────────┘                        └───┬────────────────────┘
                                               │
                ┌──────────────────────────────┼──────────────────────┐
                ▼                              ▼                      ▼
        ChatInput chip row          send body + msg metadata    Message bubble
        (live, persists)             (expanded + capped)        (past refs)
```

`currentSelectedNodeIds` is **not** persisted across page reload. It joins `runFromNodeId` and `runMode` in the persistence-excluded list in [lib/store/app-store.ts](../../../lib/store/app-store.ts) — selection is ephemeral UI state, like cursor position. Past message refs persist independently via `messages.metadata.node_refs`.

The existing singular `selectedNodeId` in the workflow slice (used by the property panel) is left untouched. We add a new field rather than repurposing it — they serve different concerns and conflating them would break the property panel.

## UI

### Live chip row in ChatInput

A new row directly above the existing `attachedImages` row in [components/chat/ChatInput.tsx](../../../components/chat/ChatInput.tsx), rendered only when `currentSelectedNodeIds.length > 0`.

Each entry is a small pill: node-type icon + display name (resolved as `config.name || sharedRegistry[type].label`). Groups show as one pill with a stacked-square icon — we do not visually expand them in the chip; expansion happens at send time. A single X button on the right of the row triggers `clearCanvasSelection()`.

Selection-cap behavior: if `currentSelectedNodeIds.length > 25`, the chip shows the first 5 pills sorted by canvas position `(position.y, position.x)` followed by `… +N more`. The visible 5 match the first 5 nodes that will be sent.

### Past-bubble node markers

User message bubbles render a small chip strip *above* the message text when `message.metadata.node_refs` is non-empty. Markers come from the snapshot captured at send-time (so labels survive node renames and deletions).

For each marker:
- **Node still exists** → normal pill; click centers the canvas on the node via existing `setPendingCenterNodeId(id)` flow.
- **Node deleted** → greyed pill with strikethrough label and tooltip "Deleted"; no click action.

Marker styling reuses the existing `ChipCard` family used by task-progress and plan cards, keeping chat visually consistent.

## Data contracts

### Request body addition

[lib/hooks/use-chat-messages.ts](../../../lib/hooks/use-chat-messages.ts) extends the existing send body:

```ts
body: JSON.stringify({
  // …existing fields…
  nodeRefs: NodeRef[],  // capped at 25, group-expanded
})

type NodeRef = {
  id: string;
  label: string;        // resolved display name at send-time
  type: string;         // node type, e.g. 'blur', 'ai_generator'
  isGroup?: boolean;    // true if this entry IS a group_container
  fromGroup?: string;   // group id this node was expanded from (if any)
};
```

### Group expansion helper

`expandSelectionForChat(nodeIds: string[], workflow: Workflow): NodeRef[]` lives in [lib/utils/](../../../lib/utils/) (next to existing graph utilities). Given the live IDs plus the current workflow, it:

1. Filters out IDs not present in `workflow.nodes` (handles delete-race).
2. For each remaining ID: if it is a `group_container`, also include its child nodes with `fromGroup` set; otherwise include as-is.
3. Sorts the combined list by `(position.y, position.x)`.
4. Takes the first 25 entries.
5. Resolves `label` from each node's config.

This mirrors the duplicate/delete expansion pattern in [components/editor/EditorCanvas.tsx](../../../components/editor/EditorCanvas.tsx).

### Server-side prompt injection

[app/api/chat/stream/route.ts](../../../app/api/chat/stream/route.ts) destructures `nodeRefs` from the body, validates shape (array of objects with string `id`, `label`, `type`), and passes through to `runBrain`. In the brain's system prompt assembly, when `nodeRefs.length > 0`, we append:

```
The user currently has these nodes selected on the canvas:
- "Blur" (id: blur-abc, type: blur)
- "Cat Image" (id: ai-def, type: ai_generator)

Treat these as the user's focus. When their request is ambiguous
about which nodes to modify, prefer this set. You can still see
and edit the whole workflow if needed.
```

When `nodeRefs` is empty or absent, this section is omitted entirely.

### Persistence

`nodeRefs` is written into `messages.metadata.node_refs` on the user-message DB insert (the existing `userMetadata` construction around [app/api/chat/stream/route.ts](../../../app/api/chat/stream/route.ts) line 474). No schema migration: `metadata` is already JSONB.

The Message renderer ([components/chat/Message.tsx](../../../components/chat/Message.tsx) and/or its renderer dependents) reads `metadata.node_refs` and renders the marker strip.

## Edge cases

**Selection-vs-deletion race.** If a node is deleted while in `currentSelectedNodeIds`, React Flow's next `onSelectionChange` drops it naturally. The slice setter is the single point that overwrites the array, so stale IDs cannot survive a real selection event. If a node disappears between "user selected" and "user clicked Send" (rare), `expandSelectionForChat` filters IDs not present in `workflow.nodes`.

**Clear-selection action.** The chip's X cannot simply empty the slice array — React Flow would refill it on next render from `localNodes`. The slice exposes `clearCanvasSelection()` which (a) sets `currentSelectedNodeIds = []` and (b) bumps a `selectionClearToken` counter that `EditorCanvas` watches; on bump, the canvas calls `reactFlowInstance.setNodes(nds => nds.map(n => ({...n, selected: false})))`. Same one-shot-trigger pattern as `pendingCenterNodeId`.

**Empty input + send.** A message with no text and no attached images is still not sendable, even with selection present. Selection alone is not a message — matches today's send-button gate.

**Click-to-center on a deleted node.** No-op; the marker is already greyed. No error toast.

**Cap with group expansion.** Expansion can blow past 25. We expand first, then sort by position, then take the first 25. The chip's "+N more" reflects the over-cap count after expansion.

**Selection persists across send.** The chip mirrors live canvas selection — sending does not clear it. Iterative editing ("now make it stronger") references the same nodes by default. Users clear via the X button or by clicking empty canvas.

## Files affected

| File | Change |
|---|---|
| [lib/store/slices/workflow-slice.ts](../../../lib/store/slices/workflow-slice.ts) | Add `currentSelectedNodeIds: string[]`, `setCurrentSelectedNodeIds`, `clearCanvasSelection`, `selectionClearToken`. |
| [lib/store/types.ts](../../../lib/store/types.ts) | Add the new field/action signatures. |
| [lib/store/app-store.ts](../../../lib/store/app-store.ts) | Add `currentSelectedNodeIds` and `selectionClearToken` to the persist-exclude list. |
| [components/editor/EditorCanvas.tsx](../../../components/editor/EditorCanvas.tsx) | Wire React Flow `onSelectionChange` → store; watch `selectionClearToken` to deselect on bump. |
| [components/chat/ChatInput.tsx](../../../components/chat/ChatInput.tsx) | Render selection chip row above attached-images row when selection is non-empty. |
| [components/chat/Message.tsx](../../../components/chat/Message.tsx) | Render past-bubble marker strip from `message.metadata.node_refs`. |
| [components/chat/ChatInterface.tsx](../../../components/chat/ChatInterface.tsx) | Read `currentSelectedNodeIds` from store; pass through to send pipeline. |
| [lib/hooks/use-chat-messages.ts](../../../lib/hooks/use-chat-messages.ts) | Call `expandSelectionForChat`; include `nodeRefs` in body and in user message's local metadata. |
| `lib/utils/selection-refs.ts` (new) | `expandSelectionForChat(ids, workflow): NodeRef[]` helper. |
| [app/api/chat/stream/route.ts](../../../app/api/chat/stream/route.ts) | Destructure and validate `nodeRefs`; pass into `runBrain`; persist into `messages.metadata.node_refs`. |
| Brain prompt assembly (wherever `runBrain` composes its system prompt) | Append the "currently selected" block when `nodeRefs` is non-empty. |

## Verification

No test runner exists in this repo. After implementation:

1. `npx tsc --noEmit` passes.
2. Manual flow:
   - Select one node → chip appears with its label.
   - Shift-click another → chip updates live.
   - Lasso a group of 30 nodes → chip shows 5 pills + `… +25 more`.
   - Click X → all canvas nodes deselect, chip disappears.
   - Type "make it stronger" + send → user bubble shows marker strip; brain reply addresses the selected nodes.
   - Reload page → chat history preserves the marker; canvas selection is empty.
   - Delete a referenced node → past bubble's marker greys out with strikethrough.
   - Click a (non-deleted) marker → canvas centers on that node.
   - Select a group → send → brain sees the group + its children in the focus list.
