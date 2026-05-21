# Chat ↔ Canvas Selection Reference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the user selects nodes on the canvas, the chat shows a live pill of that selection, sends those nodes to the brain as a focus hint, and stamps each sent message with a persistent node-reference marker.

**Architecture:** A new `currentSelectedNodeIds: string[]` field in the Zustand workflow slice is the single source of truth, fed from React Flow's selection in `EditorCanvas`. The chat input reads it live to render a pill; on send, a pure helper expands groups + caps the list into `NodeRef[]`, which goes both into the request body (→ brain system prompt) and into `messages.metadata.node_refs` (→ persistent past-bubble markers).

**Tech Stack:** Next.js 14 App Router, React, Zustand (with `persist` middleware), React Flow (`reactflow`), TypeScript. No test runner exists — verification is `npx tsc --noEmit` plus the manual UI checks listed in each task.

> **Verification note:** This repo has NO test framework (see CLAUDE.md). Do not write or run unit tests. Every task's verification is `npx tsc --noEmit` (must report zero errors) plus the manual browser check stated in the task. `npm run lint`/`npm run build` are unreliable here — use `npx tsc --noEmit`.

---

## File Structure

| File | Responsibility | Created/Modified |
|---|---|---|
| `lib/utils/selection-refs.ts` | `NodeRef` type + `expandSelectionForChat()` pure helper (group expansion, cap, label resolution). Import-safe on client and server. | Create |
| `lib/store/types.ts` | Add slice field/action signatures; add `nodeRefs` to `Message`. | Modify |
| `lib/store/slices/workflow-slice.ts` | Implement `currentSelectedNodeIds`, `setCurrentSelectedNodeIds`, `clearCanvasSelection`, `selectionClearToken`. | Modify |
| `lib/store/app-store.ts` | Exclude the two new ephemeral fields from persistence + reset on rehydrate. | Modify |
| `components/editor/EditorCanvas.tsx` | Push React Flow selection into the slice; deselect when `selectionClearToken` bumps. | Modify |
| `components/chat/ChatInput.tsx` | Render the live selection pill row above the attached-images row. | Modify |
| `components/chat/ChatInterface.tsx` | Wire selection state + clear action from store into `ChatInput`. | Modify |
| `lib/hooks/use-chat-messages.ts` | Build `nodeRefs` via the helper; add to request body and to the local user message. | Modify |
| `app/api/chat/stream/route.ts` | Destructure + validate `nodeRefs`; pass to `runBrain`; persist into `messages.metadata.node_refs`. | Modify |
| `lib/chat/brain.ts` | Thread `nodeRefs` from `BrainInput` into `buildSystemPrompt`. | Modify |
| `lib/chat/prompt/system.ts` | `formatSelectionFocus()` + append a focus block when refs present. | Modify |
| `lib/hooks/use-session.ts` | Read `metadata.node_refs` into the rehydrated message on reload. | Modify |
| `components/chat/Message.tsx` | Render the past-bubble marker strip (live vs. deleted) with click-to-center. | Modify |

---

## Task 1: NodeRef type + group-expansion helper

This is a pure, dependency-light module both client and server import. Do it first so every later task can reference the `NodeRef` type and the helper.

**Files:**
- Create: `lib/utils/selection-refs.ts`

- [ ] **Step 1: Create the helper module**

Create `lib/utils/selection-refs.ts` with this exact content:

```ts
import type { Workflow } from '@/lib/nodes/types';
import { sharedRegistry } from '@/lib/nodes/core/shared-registry';

/** A node the user pointed at in chat. Snapshotted at send-time so labels
 *  survive later renames/deletes. Shared by client (chip/send) and server
 *  (prompt/persist). */
export interface NodeRef {
  id: string;
  label: string;
  type: string;
  isGroup?: boolean;
  fromGroup?: string;
}

/** Hard cap on how many refs we send/persist — guards against Ctrl+A on a
 *  huge graph blowing up the prompt. Expansion happens BEFORE the cap. */
export const MAX_NODE_REFS = 25;

/** Resolve a node's display name: user label → registry label → raw type. */
function resolveLabel(node: any): string {
  return (
    (typeof node?.data?.label === 'string' && node.data.label.trim().length > 0
      ? node.data.label
      : undefined) ??
    sharedRegistry[node?.type as string]?.meta?.label ??
    String(node?.type ?? 'node')
  );
}

/**
 * Turn the live selected ID set into a capped, group-expanded NodeRef list.
 * - Filters out IDs not present in the workflow (delete-race safety).
 * - Expands any group_container to include its children (parentNode === group id),
 *   tagging each child with `fromGroup`. Mirrors the duplicate/delete expansion
 *   pattern in EditorCanvas.
 * - Sorts by (position.y, position.x) so the first N kept after the cap are the
 *   visually top-left ones (matching what the chip previews).
 */
export function expandSelectionForChat(
  selectedIds: string[],
  workflow: Workflow | null | undefined,
): NodeRef[] {
  if (!workflow || !Array.isArray(workflow.nodes) || selectedIds.length === 0) {
    return [];
  }
  const byId = new Map<string, any>(workflow.nodes.map((n: any) => [n.id, n]));
  const collected = new Map<string, NodeRef>();

  for (const id of selectedIds) {
    const node = byId.get(id);
    if (!node) continue; // dropped between select and send
    const isGroup = node.type === 'group_container';
    if (!collected.has(id)) {
      collected.set(id, { id, label: resolveLabel(node), type: node.type, isGroup: isGroup || undefined });
    }
    if (isGroup) {
      for (const child of workflow.nodes as any[]) {
        if (child.parentNode === id && !collected.has(child.id)) {
          collected.set(child.id, {
            id: child.id,
            label: resolveLabel(child),
            type: child.type,
            fromGroup: id,
          });
        }
      }
    }
  }

  const refs = Array.from(collected.values());
  refs.sort((a, b) => {
    const na = byId.get(a.id);
    const nb = byId.get(b.id);
    const ay = na?.position?.y ?? 0;
    const by = nb?.position?.y ?? 0;
    if (ay !== by) return ay - by;
    return (na?.position?.x ?? 0) - (nb?.position?.x ?? 0);
  });
  return refs.slice(0, MAX_NODE_REFS);
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: zero errors. (If `sharedRegistry[...]?.meta?.label` errors on the `any`-typed registry, that's fine — the index is `Record<string, NodeSharedDef<any>>` and `meta.label` exists; no cast needed.)

- [ ] **Step 3: Commit**

```bash
git add lib/utils/selection-refs.ts
git commit -m "feat(selection): add NodeRef type and group-expansion helper for chat"
```

---

## Task 2: Store — selection state, actions, and Message field

Add the single source of truth and the clear-trigger token. Also extend the `Message` type with `nodeRefs` so later tasks can attach/read it.

**Files:**
- Modify: `lib/store/types.ts`
- Modify: `lib/store/slices/workflow-slice.ts`
- Modify: `lib/store/app-store.ts`

- [ ] **Step 1: Add field/action signatures to the slice interface**

In `lib/store/types.ts`, inside `export interface WorkflowSlice {`, immediately after the existing `pendingCenterNodeId` block (the `clearPendingCenterNodeId: () => void;` line, currently line 96), add:

```ts
    // Live multi-select set, mirrored from React Flow's per-node `selected`
    // flag in EditorCanvas. Read by the chat to render the selection pill and
    // to build the NodeRef focus hint on send. Ephemeral — never persisted.
    currentSelectedNodeIds: string[];
    setCurrentSelectedNodeIds: (ids: string[]) => void;
    // One-shot trigger: bumping this counter tells EditorCanvas to deselect
    // every node. Used by the chat pill's clear (X) button, since emptying
    // currentSelectedNodeIds alone would be re-filled by the canvas on next render.
    selectionClearToken: number;
    clearCanvasSelection: () => void;
```

- [ ] **Step 2: Add `nodeRefs` to the Message interface**

In `lib/store/types.ts`, inside `export interface Message {`, after the `images?: string[];` line (line 10), add:

```ts
    // Snapshot of canvas nodes the user referenced when sending this message.
    // Captured at send-time so labels survive later renames/deletes. Persisted
    // to messages.metadata.node_refs. Rendered as a marker strip on the bubble.
    nodeRefs?: import('@/lib/utils/selection-refs').NodeRef[];
```

- [ ] **Step 3: Implement the slice state + actions**

In `lib/store/slices/workflow-slice.ts`, find the `// Selection` block (currently lines 71-77, the `selectedNodeId` / `pendingCenterNodeId` group). Immediately after the `clearPendingCenterNodeId: () => set({ pendingCenterNodeId: null }),` line, add:

```ts

    currentSelectedNodeIds: [],
    setCurrentSelectedNodeIds: (ids) => set({ currentSelectedNodeIds: ids }),
    selectionClearToken: 0,
    clearCanvasSelection: () =>
        set((s) => ({
            currentSelectedNodeIds: [],
            selectionClearToken: s.selectionClearToken + 1,
        })),
```

- [ ] **Step 4: Exclude the new ephemeral fields from persistence**

In `lib/store/app-store.ts`, inside the `partialize` exclude array, after the `'pendingCenterNodeId',` entry (line 132), add:

```ts
                    // Live canvas selection + its clear trigger — ephemeral UI
                    // state like cursor position. Resurrecting on refresh would
                    // show a stale chip referencing nodes the user isn't looking at.
                    'currentSelectedNodeIds',
                    'selectionClearToken',
```

- [ ] **Step 5: Reset selection on rehydrate**

In `lib/store/app-store.ts`, inside `onRehydrateStorage`'s `if (state) {` block, after the `state.runSelectionIds = null;` line (line 167), add:

```ts
                    state.currentSelectedNodeIds = [];
```

(`selectionClearToken` keeps its persisted-default of 0 via the slice initializer; no reset needed since it's a monotonic trigger, not state.)

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add lib/store/types.ts lib/store/slices/workflow-slice.ts lib/store/app-store.ts
git commit -m "feat(store): add ephemeral canvas-selection state and Message.nodeRefs"
```

---

## Task 3: Feed React Flow selection into the store

`EditorCanvas` already computes a memoized `selectedNodeIds` (line 258). Push it to the slice via an effect, and react to the clear token by deselecting all nodes.

**Files:**
- Modify: `components/editor/EditorCanvas.tsx`

- [ ] **Step 1: Pull the new store actions/values into the component**

In `components/editor/EditorCanvas.tsx`, locate where the component already reads workflow-slice values (search for `pendingCenterNodeId` and `clearPendingCenterNodeId` usage near the top of the component body). Add reads for the three new members alongside them. If the component uses `useAppStore((s) => s.x)` selectors, add:

```ts
    const setCurrentSelectedNodeIds = useAppStore((s) => s.setCurrentSelectedNodeIds);
    const selectionClearToken = useAppStore((s) => s.selectionClearToken);
```

(Use the same selector style already present in this file. Do NOT destructure the whole store.)

- [ ] **Step 2: Sync the memoized selection into the store**

Immediately after the existing `selectedNodeIds` `useMemo` (ends at line 264), add:

```ts
    // Mirror the live React Flow selection into the global store so the chat
    // can render the selection pill and build the NodeRef focus hint. Depends
    // on the same stable string key the memo uses, so it only fires when the
    // selected SET changes — not on drag/hover re-renders.
    useEffect(() => {
        setCurrentSelectedNodeIds(selectedNodeIds);
    }, [selectedNodeIds, setCurrentSelectedNodeIds]);
```

- [ ] **Step 3: React to the clear token**

After the effect from Step 2, add:

```ts
    // When the chat pill's X button bumps selectionClearToken, deselect every
    // node on the canvas. Skip the initial mount (token 0) so we don't fight
    // an existing selection on load. Mirrors the pendingCenterNodeId pattern.
    const lastClearTokenRef = useRef(selectionClearToken);
    useEffect(() => {
        if (selectionClearToken === lastClearTokenRef.current) return;
        lastClearTokenRef.current = selectionClearToken;
        reactFlowInstance.setNodes((nds: any[]) =>
            nds.map((n) => (n.selected ? { ...n, selected: false } : n)),
        );
    }, [selectionClearToken, reactFlowInstance]);
```

(`useEffect` and `useRef` are already imported in this file — it uses hooks throughout. If `useRef` is somehow not imported, add it to the existing `react` import.)

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: zero errors.

Manual check: open `/editor` (or a chat session with canvas), shift-click two nodes, open React DevTools / the store, confirm `currentSelectedNodeIds` updates to those two IDs and clears to `[]` when you click empty canvas.

- [ ] **Step 5: Commit**

```bash
git add components/editor/EditorCanvas.tsx
git commit -m "feat(canvas): mirror node selection into store and honor clear token"
```

---

## Task 4: Live selection pill in the chat input

Render a pill row above the attached-images row. The label/icon data comes from a prop (resolved by `ChatInterface` in Task 5's wiring). To keep `ChatInput` dumb, it receives ready-to-render ref data and an `onClearSelection` callback.

**Files:**
- Modify: `components/chat/ChatInput.tsx`

- [ ] **Step 1: Extend `ChatInputProps`**

In `components/chat/ChatInput.tsx`, add to the `interface ChatInputProps` (after `hasMessages?: boolean;`, line 75):

```ts
    selectedNodeRefs?: import('@/lib/utils/selection-refs').NodeRef[];
    onClearSelection?: () => void;
```

- [ ] **Step 2: Destructure the new props**

In the `function ChatInput({ ... }, ref)` parameter destructuring, after `hasMessages = false,` (line 96), add:

```ts
            selectedNodeRefs = [],
            onClearSelection,
```

- [ ] **Step 3: Render the pill row**

Inside the input container `<div className={`relative flex flex-col ...`}>`, immediately BEFORE the `{attachedImages.length > 0 && (` block (line 248), insert:

```tsx
                    {selectedNodeRefs.length > 0 && (
                        <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-0.5 overflow-x-auto [&::-webkit-scrollbar]:hidden">
                            <span className="text-[10px] font-semibold uppercase tracking-wider text-content-tertiary shrink-0">
                                Editing
                            </span>
                            {selectedNodeRefs.slice(0, 5).map((ref) => (
                                <span
                                    key={ref.id}
                                    className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-md
                                               bg-accent-primary/10 border border-accent-primary/20
                                               text-[11px] text-content-secondary max-w-[140px]"
                                    title={ref.label}
                                >
                                    <span className="truncate">{ref.label}</span>
                                </span>
                            ))}
                            {selectedNodeRefs.length > 5 && (
                                <span className="shrink-0 text-[11px] text-content-tertiary">
                                    … +{selectedNodeRefs.length - 5} more
                                </span>
                            )}
                            {onClearSelection && (
                                <button
                                    type="button"
                                    onClick={onClearSelection}
                                    aria-label="Clear node selection"
                                    className="shrink-0 ml-auto p-1 rounded-md text-content-tertiary
                                               hover:text-content-primary hover:bg-surface-tertiary transition-colors"
                                >
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            )}
                        </div>
                    )}

```

(`X` is already imported from `lucide-react` at the top of this file, line 17.)

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add components/chat/ChatInput.tsx
git commit -m "feat(chat): render live selection pill row in chat input"
```

---

## Task 5: Wire selection from store into ChatInput + send pipeline

`ChatInterface` resolves `currentSelectedNodeIds` into displayable `NodeRef[]` (capped/expanded via the helper) for the pill and passes the clear action. `use-chat-messages` builds the same `NodeRef[]` at send-time and includes it in the body + the local message.

**Files:**
- Modify: `components/chat/ChatInterface.tsx`
- Modify: `lib/hooks/use-chat-messages.ts`

- [ ] **Step 1: Resolve refs in ChatInterface and pass to ChatInput**

In `components/chat/ChatInterface.tsx`, add these imports near the top (after the existing `useAppStore` import, line 15):

```ts
import { expandSelectionForChat } from '@/lib/utils/selection-refs';
```

Inside the `ChatInterface` component body, where other store values are read (near `const messages = useAppStore(...)`, line 82), add:

```ts
    const currentSelectedNodeIds = useAppStore((state) => state.currentSelectedNodeIds);
    const currentWorkflowForRefs = useAppStore((state) => state.currentWorkflow);
    const clearCanvasSelection = useAppStore((state) => state.clearCanvasSelection);
    const selectedNodeRefs = React.useMemo(
        () => expandSelectionForChat(currentSelectedNodeIds, currentWorkflowForRefs),
        [currentSelectedNodeIds, currentWorkflowForRefs],
    );
```

Then find the `<ChatInput ... />` JSX in this file and add these two props to it:

```tsx
                selectedNodeRefs={selectedNodeRefs}
                onClearSelection={clearCanvasSelection}
```

- [ ] **Step 2: Build nodeRefs at send-time in use-chat-messages**

In `lib/hooks/use-chat-messages.ts`, add the import near the other `@/lib` imports at the top of the file:

```ts
import { expandSelectionForChat } from '@/lib/utils/selection-refs';
```

In the send function, immediately before the `const userMsg: Message = {` declaration (line 286), add:

```ts
            // Snapshot the canvas selection as NodeRefs for this turn. Same
            // expansion/cap the chat pill uses, computed against the workflow
            // at send-time so labels are accurate even if nodes change later.
            const nodeRefs = expandSelectionForChat(
                useAppStore.getState().currentSelectedNodeIds,
                useAppStore.getState().currentWorkflow,
            );
```

- [ ] **Step 3: Attach nodeRefs to the local user message**

Still in `use-chat-messages.ts`, the optimistic `addMessage({ id: userMsgId, type: 'user', ... })` call (line 224) and the `userMsg` object (line 286) both build the user message. Add `nodeRefs: nodeRefs.length > 0 ? nodeRefs : undefined,` to the `userMsg` object (the one sent in history). For the earlier optimistic `addMessage` at line 224, the `nodeRefs` const is declared later (line 286) — move the `const nodeRefs = ...` block from Step 2 to BEFORE the `addMessage({ id: userMsgId ...})` call at line 224 instead, and add `nodeRefs: nodeRefs.length > 0 ? nodeRefs : undefined,` to BOTH that `addMessage` object and the `userMsg` object.

Concretely, the optimistic call becomes:

```ts
        const nodeRefs = expandSelectionForChat(
            useAppStore.getState().currentSelectedNodeIds,
            useAppStore.getState().currentWorkflow,
        );

        addMessage({
            id: userMsgId,
            type: 'user',
            content: trimmedInput,
            images: imagesToSend.length > 0 ? imagesToSend : undefined,
            nodeRefs: nodeRefs.length > 0 ? nodeRefs : undefined,
            timestamp: new Date(),
        });
```

and the later `userMsg`:

```ts
            const userMsg: Message = {
                id: userMsgId,
                type: 'user',
                content: trimmedInput,
                images: imagesToSend.length > 0 ? imagesToSend : undefined,
                nodeRefs: nodeRefs.length > 0 ? nodeRefs : undefined,
                timestamp: new Date(),
            };
```

(Delete the duplicate `const nodeRefs` from Step 2's location — it must be declared once, before line 224.)

- [ ] **Step 4: Include nodeRefs in the request body**

In the `fetch('/api/chat/stream', { ... body: JSON.stringify({ ... }) })` call, add to the body object (after `selectedModel: ...`, line 309):

```ts
                    nodeRefs: nodeRefs.length > 0 ? nodeRefs : undefined,
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit`
Expected: zero errors.

Manual check: select 2 nodes → the pill row shows "Editing • <label> <label>" above the input. Click the X → pill disappears and canvas deselects. Select a group → pill shows the group label (children are not shown in the pill).

- [ ] **Step 6: Commit**

```bash
git add components/chat/ChatInterface.tsx lib/hooks/use-chat-messages.ts
git commit -m "feat(chat): wire selection into chat input and send NodeRefs in body"
```

---

## Task 6: Server route — accept, validate, persist, pass to brain

**Files:**
- Modify: `app/api/chat/stream/route.ts`

- [ ] **Step 1: Destructure and validate `nodeRefs`**

In `app/api/chat/stream/route.ts`, the `handleWithNewBrain` function destructures the body at line 325:

```ts
  const { messages, sessionId, previousWorkflow, attachedImages } = body ?? {};
```

Change it to also pull `nodeRefs`, and add a validated, capped copy right after:

```ts
  const { messages, sessionId, previousWorkflow, attachedImages } = body ?? {};
  const nodeRefs: import('@/lib/utils/selection-refs').NodeRef[] = Array.isArray(body?.nodeRefs)
    ? body.nodeRefs
        .filter(
          (r: any) =>
            r && typeof r.id === 'string' && typeof r.label === 'string' && typeof r.type === 'string',
        )
        .slice(0, 25)
        .map((r: any) => ({
          id: r.id,
          label: r.label,
          type: r.type,
          ...(r.isGroup === true ? { isGroup: true } : {}),
          ...(typeof r.fromGroup === 'string' ? { fromGroup: r.fromGroup } : {}),
        }))
    : [];
```

- [ ] **Step 2: Pass nodeRefs into runBrain**

In the same function, the `runBrain({ ... })` call (line 460) currently passes `turns, workflow, registry, encoder, attachedImageUrls, model`. Add `nodeRefs` to that object:

```ts
        const result = await runBrain({
          turns,
          workflow: previousWorkflow,
          registry,
          encoder,
          attachedImageUrls,
          model,
          nodeRefs,
        });
```

- [ ] **Step 3: Persist nodeRefs into the user message metadata**

In the user-message DB insert, the `userMetadata` object is built around line 474 (`const userMetadata: Record<string, any> = {};`). After the existing `if (clarificationAnswer ...)` and `if (planAnswer ...)` blocks that populate it, add:

```ts
            if (nodeRefs.length > 0) {
              userMetadata.node_refs = nodeRefs;
            }
```

(This sits inside the same `if (lastUserMsg.role === 'user' ...)` block, before the `dbOps.push(...)` insert call so the metadata is written.)

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add app/api/chat/stream/route.ts
git commit -m "feat(chat-api): accept, validate, persist, and forward NodeRefs"
```

---

## Task 7: Brain — surface selection as a focus block in the system prompt

**Files:**
- Modify: `lib/chat/brain.ts`
- Modify: `lib/chat/prompt/system.ts`

- [ ] **Step 1: Add nodeRefs to BrainInput and thread it through**

In `lib/chat/brain.ts`, add to the `export interface BrainInput {` block (after `model?: 'haiku' | 'sonnet';`, line 30):

```ts
  /** Nodes the user has selected on the canvas this turn. Surfaced to the
   *  model as a focus hint; does NOT restrict scope. */
  nodeRefs?: import('@/lib/utils/selection-refs').NodeRef[];
```

Then update the `buildSystemPrompt({ ... })` call (line 65) to pass it:

```ts
  const system = buildSystemPrompt({
    workflow: baseWorkflow,
    registry: input.registry,
    attachedImageUrls: input.attachedImageUrls ?? [],
    nodeRefs: input.nodeRefs ?? [],
  });
```

- [ ] **Step 2: Add the focus-block formatter and input field in system.ts**

In `lib/chat/prompt/system.ts`, add to `export interface BuildSystemInput {` (after `attachedImageUrls?: string[];`, line 140):

```ts
  nodeRefs?: import('@/lib/utils/selection-refs').NodeRef[];
```

Then add this formatter next to `formatAttachedImagesBlock` (after that function, around line 150):

```ts
function formatSelectionFocusBlock(
  refs: import('@/lib/utils/selection-refs').NodeRef[] | undefined,
): string {
  if (!refs || refs.length === 0) return '';
  const list = refs
    .map((r) => `- "${r.label}" (id: ${r.id}, type: ${r.type})${r.fromGroup ? ` [in group ${r.fromGroup}]` : ''}`)
    .join('\n');
  return `USER'S CURRENT SELECTION (focus hint — NOT a scope restriction):
The user has these nodes selected on the canvas right now:
${list}

Treat these as the user's focus. When their request is ambiguous about which
nodes to modify (e.g. "make it stronger", "remove that one"), prefer this set.
You can still see and edit the entire workflow when the request calls for it.`;
}
```

- [ ] **Step 3: Push the block into the returned system blocks**

In `buildSystemPrompt`, after the `attachedBlock` push (line 182), add:

```ts
  const selectionBlock = formatSelectionFocusBlock(input.nodeRefs);
  if (selectionBlock) blocks.push({ type: 'text', text: selectionBlock });
```

(This is a per-turn dynamic block — keep it AFTER the cached stable block so it never pollutes the prompt cache.)

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: zero errors.

Manual check: select a node, send "make it bigger" with no other context, confirm in the network tab the request carries `nodeRefs`, and the assistant's reply targets that node rather than asking which one.

- [ ] **Step 5: Commit**

```bash
git add lib/chat/brain.ts lib/chat/prompt/system.ts
git commit -m "feat(brain): surface canvas selection as a focus hint in the system prompt"
```

---

## Task 8: Past-bubble markers + reload round-trip

Render the marker strip on user bubbles (live node → clickable/center, deleted node → greyed/strikethrough), and read `metadata.node_refs` back on session reload.

**Files:**
- Modify: `lib/hooks/use-session.ts`
- Modify: `components/chat/Message.tsx`

- [ ] **Step 1: Read node_refs on reload**

In `lib/hooks/use-session.ts`, extend the `metadata` type cast (the object literal type starting line 168) by adding to it:

```ts
                        node_refs?: import('@/lib/utils/selection-refs').NodeRef[] | null;
```

Then, where the `formatted` object is built (after line 199) — specifically after the `if (msg.role === 'assistant' && metadata.clarification ...)` blocks but it's simplest to add right after `formatted` is created — add:

```ts
                    if (msg.role === 'user' && Array.isArray(metadata.node_refs) && metadata.node_refs.length > 0) {
                        formatted.nodeRefs = metadata.node_refs;
                    }
```

- [ ] **Step 2: Add the marker strip to Message.tsx**

In `components/chat/Message.tsx`, add these imports at the top (after the existing `lucide-react` import, line 4 — add the needed icon, and the store hook + NodeRef type):

```ts
import { useAppStore } from '@/lib/store/app-store';
import type { NodeRef } from '@/lib/utils/selection-refs';
```

Add `MapPin` to the existing lucide import on line 4 (or reuse an existing icon — use `Pen`/`Maximize2` already imported; here we add a small subcomponent that needs no new icon).

Define a marker-strip subcomponent above `ChatMessageContent` (before line 57):

```tsx
function NodeRefStrip({ refs }: { refs: NodeRef[] }) {
    const currentWorkflow = useAppStore((s) => s.currentWorkflow);
    const selectNodeAndCenter = useAppStore((s) => s.selectNodeAndCenter);
    const liveIds = React.useMemo(
        () => new Set((currentWorkflow?.nodes ?? []).map((n: any) => n.id)),
        [currentWorkflow],
    );
    if (refs.length === 0) return null;
    return (
        <div className="flex flex-wrap gap-1.5 mb-1.5">
            {refs.map((ref) => {
                const exists = liveIds.has(ref.id);
                return (
                    <button
                        key={ref.id}
                        type="button"
                        disabled={!exists}
                        onClick={() => exists && selectNodeAndCenter(ref.id)}
                        title={exists ? `Show "${ref.label}" on canvas` : 'Deleted'}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] border max-w-[160px]
                            ${exists
                                ? 'bg-accent-primary/10 border-accent-primary/20 text-content-secondary hover:bg-accent-primary/20 cursor-pointer'
                                : 'bg-surface-tertiary/40 border-stroke-subtle text-content-tertiary line-through cursor-default'
                            }`}
                    >
                        <span className="truncate">{ref.label}</span>
                    </button>
                );
            })}
        </div>
    );
}
```

(`React` is already imported at line 3. Remove the `MapPin` mention above — no new icon is required; the subcomponent uses only a label. Do not add unused imports.)

- [ ] **Step 3: Render the strip in the user bubble**

In `components/chat/Message.tsx`, inside the user bubble, immediately BEFORE the `{message.type === 'user' && message.images && message.images.length > 0 && (` block (line 245), add:

```tsx
                    {message.type === 'user' && message.nodeRefs && message.nodeRefs.length > 0 && (
                        <NodeRefStrip refs={message.nodeRefs} />
                    )}
```

(`message.nodeRefs` requires the local `Message` interface in this file to allow it. The file declares its own `interface Message {` at line 19 — add `nodeRefs?: import('@/lib/utils/selection-refs').NodeRef[];` to it, after `images?: string[];` on line 23.)

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: zero errors.

Manual check (full feature):
- Select two nodes → pill shows in input.
- Type "tweak these" + send → the sent user bubble shows two clickable markers above the text.
- Click a marker → canvas pans/zooms to that node (via existing `selectNodeAndCenter`).
- Delete one referenced node → its marker greys out with strikethrough and is no longer clickable.
- Reload the page → the bubble still shows the markers (deleted one stays greyed).
- Select a `group_container` and send → the brain receives group + children (verify in network tab `nodeRefs`); the bubble markers include the children.

- [ ] **Step 5: Commit**

```bash
git add lib/hooks/use-session.ts components/chat/Message.tsx
git commit -m "feat(chat): render persistent node-reference markers on user bubbles"
```

---

## Self-Review (completed by plan author)

**Spec coverage:**
- Live pill above textarea → Task 4 + Task 5. ✓
- Pill updates live with canvas selection → Task 3 (effect on memoized selection) + Task 5 (memo). ✓
- Pill persists after send (mirrors live selection, send doesn't clear) → no clear-on-send code added anywhere; selection only changes via canvas or X button. ✓
- Cap at 25 with "+N more" → `MAX_NODE_REFS` in Task 1, chip "+N more" in Task 4, server re-cap in Task 6. ✓
- Group expansion → Task 1 helper, exercised at send (Task 5) and shown in markers (Task 8). ✓
- Structured `nodeRefs` to model → Task 5 (body) + Task 6 (validate/forward) + Task 7 (prompt block). ✓
- Persistent bubble markers, deleted-node greyed, click-to-center → Task 8. ✓
- DB round-trip via `messages.metadata.node_refs` (no migration) → Task 6 (write) + Task 8 (read). ✓
- Not persisted across reload (live selection) → Task 2 partialize + onRehydrate. ✓
- `clearCanvasSelection` via token (avoids React Flow refill) → Task 2 + Task 3. ✓
- Existing singular `selectedNodeId` left untouched → no task modifies it. ✓
- Empty input still un-sendable → no change to the send-button gate (untouched in ChatInput). ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✓

**Type consistency:** `NodeRef` defined once in `lib/utils/selection-refs.ts`; all consumers import it. `currentSelectedNodeIds` / `setCurrentSelectedNodeIds` / `selectionClearToken` / `clearCanvasSelection` names match across types.ts, slice, canvas, and ChatInterface. `nodeRefs` field name consistent in body, BrainInput, BuildSystemInput, Message (store + Message.tsx local), and `metadata.node_refs` (DB key) consistently snake_cased only at the DB boundary. ✓
