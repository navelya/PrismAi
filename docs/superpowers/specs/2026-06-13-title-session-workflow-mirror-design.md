# Mirror the session title and the workflow title

## Problem

A workflow has two title fields that are meant to be the same thing but drift apart:

- `sessions.title` — shown in the **history / sidebar**, live-updated via Supabase realtime.
- `currentWorkflow.name` (persisted in `canvas_state.name`) — shown in the **editor toolbar**.

Today:

- Renaming the toolbar title pushes to `sessions.title` (`handleNameChange` in
  `SharedWorkflowEditor.tsx`), so history follows the editor. ✅
- Auto-title generation (`/api/session/generate-title`) writes `sessions.title`
  but never updates the in-memory workflow name, so after the first chat the
  **history shows the generated title while the editor still says "Untitled
  Workflow"** until reload.
- The chat engine writes `canvas_state` as `{ nodes, edges }` (no `name`), and the
  realtime handler replaces `currentWorkflow` wholesale, so any name we set gets
  wiped on the next chat turn.

## Desired behavior

1. The workflow title and the session/history title are always the same (mirror).
2. **Manual rename wins.** If the user renames the toolbar title before the first
   chat, history follows it, and the first chat must NOT auto-generate a title
   that overrides it — neither title changes.
3. **No manual rename → auto-title.** The first chat generates the session title,
   and because it is a mirror, the editor toolbar reflects it immediately (no
   reload).
4. Any workflow-title change always updates the history title.

The per-conversation *chat* title (History dropdown) is a separate concern and is
left unchanged.

## Approach

`sessions.title` stays the single source of truth; the in-memory workflow name
follows it. No DB migration, no schema change. A name is a "default placeholder"
(i.e. effectively unset) when it is `''`, `Untitled Workflow`, `New Workflow`, or
`New Session` — centralized in one helper so the client guard and the route agree.

### 1. Pass the workflow name into title generation, adopt the result

`lib/hooks/use-chat-messages.ts` (both `generateTitle` call sites): send
`workflowName: currentWorkflow?.name`. On resolve, if the route returned a real
title and the current workflow name is still a default placeholder, set
`currentWorkflow.name` to it via `setCurrentWorkflow(wf, false)` (not dirty — the
DB session title is already saved by the route, and load falls back to it).

The default-placeholder guard means a manual name is never clobbered (if the user
typed a name during the ~1s Gemini window, the guard skips).

### 2. Title route honors a manual name

`app/api/session/generate-title/route.ts`: accept `workflowName`. If it is a real
(non-default) name, use it as the mirror title and skip Gemini for the session
title — so a manual rename always wins with no debounce race. Otherwise generate
via Gemini as today. Set `sessions.title` to the mirror title (manual name always;
Gemini summary only when the session title is still unset). Return the mirror
title so the client can apply it. The per-chat `chats.title` is still summarized
from the message as before.

### 3. Preserve the name across chat-turn canvas updates

`lib/hooks/use-chat-realtime.ts`: just before `setCurrentWorkflow(newWorkflow,
false)`, if the incoming `canvas_state` has no `name`, carry over the existing
workflow name. Placed after the hash/echo guards so their behavior is unchanged.

### Already works (no change)

Forward mirror (toolbar rename → history) via `handleNameChange` +
sidebar realtime UPDATE subscription. Reload consistency via the load fallback
`name: rawCanvas.name || threadSession.title` in `use-session.ts`.

## Files touched

- `lib/utils/...` — small `isDefaultWorkflowTitle()` helper (new or colocated).
- `app/api/session/generate-title/route.ts`
- `lib/hooks/use-chat-messages.ts`
- `lib/hooks/use-chat-realtime.ts`

## Out of scope

- Per-conversation chat titles.
- Persisting `canvas_state.name` from the chat engine (load already falls back to
  the session title, so it is unnecessary).
- A dedicated `activeSessionTitle` store field (heavier rewire; rejected).
