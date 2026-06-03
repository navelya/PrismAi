# Workflow Versions & Checkpoints — Design

**Date:** 2026-06-03
**Status:** Approved (pending spec review)

## Problem

Today a workflow's graph lives in `sessions.canvas_state` (JSONB). Persistence is:

- **Autosave** ([hooks/useAutoSave.ts](../../../hooks/useAutoSave.ts)) — debounced remote save to Supabase (2s) + throttled IndexedDB local backup (1s).
- **Undo/redo** (`past`/`future` in [lib/store/slices/workflow-slice.ts](../../../lib/store/slices/workflow-slice.ts)) — in-session only, **wiped on refresh** (deliberately excluded from persistence).

There is no durable, cross-device way for a user to return to an earlier state of a workflow once the browser session ends. This feature adds:

1. **Auto-versions** — full graph snapshots captured automatically at a milestone, so a user can roll back.
2. **Checkpoints** — user-named snapshots, created on demand, accessible instantly at any time.

Both are durable (Supabase), cross-device, and survive refresh.

## Scope decisions (locked)

These were settled during brainstorming and are not open for re-litigation in the plan:

- **Snapshot scope:** canvas graph only (`canvas_state`). Restore does **not** touch chat history or `node_results`; previously generated outputs are left as-is.
- **Auto-version trigger:** **AI-only** — captured server-side right before the chat brain applies a graph-modifying patch. Manual (hand) edits are **not** auto-versioned; the user preserves hand-edits via manual checkpoints.
- **Restore behavior:** overwrite the current canvas, but first capture the current state as a safety auto-version so restore is reversible.
- **Retention:** keep the last **20** auto-versions per canvas (prune oldest). Checkpoints are never auto-pruned.
- **Collaboration:** listing/reading visible to all canvas members; **creating checkpoints and restoring are owner-only**. Restore broadcasts to peers via the existing realtime sync.
- **Storage model:** a dedicated `workflow_versions` table (not a JSONB array on `sessions`, not client-only). Mirrors how volatile execution state (`node_results`) is split out of the hot `canvas_state` row.

## Keying: canvas_id, not session_id

The graph is keyed by **canvas_id** — the owner's session that holds the canvas. For an owner, `canvas_id == session_id`; collaborators share the owner's canvas (see [lib/hooks/use-session.ts](../../../lib/hooks/use-session.ts), the `open` route returns `{ threadId, canvasId, role }`). Autosave already writes to `activeCanvasId || sessionId`. Versions follow the same rule: **always key on `canvas_id`.**

## Data model

New table `workflow_versions`:

| column | type | notes |
|---|---|---|
| `id` | uuid pk default gen_random_uuid() | |
| `canvas_id` | uuid not null | FK → `sessions.id` on delete cascade |
| `kind` | text not null | `'auto'` \| `'checkpoint'` (check constraint) |
| `label` | text null | user name for checkpoints; null for auto |
| `canvas_state` | jsonb not null | full graph snapshot (nodes, edges, configs) |
| `content_hash` | text not null | stable hash of `canvas_state` for dedup |
| `created_by` | uuid null | user who triggered it (null for system) |
| `created_at` | timestamptz not null default now() | |

Indexes:
- `(canvas_id, created_at desc)` — listing.
- `(canvas_id, content_hash)` — dedup lookups.

`content_hash` is computed with the same `stableStringify` already used by autosave ([lib/utils/stable-stringify.ts](../../../lib/utils/stable-stringify.ts)) so hashing is consistent with the existing dirty-check. Hash the **same sanitized shape** autosave persists (status/output stripped) to avoid spurious diffs.

### RLS

- **SELECT:** canvas owner + members. Reuse the membership predicate the collaboration feature already uses for `sessions`/`node_results` (do not invent a new one).
- **INSERT / DELETE:** owner only.
- Server-side auto-version writes happen in the chat route with the **service-role client** (already used there), so they bypass RLS — RLS only gates the user-facing API routes.

Per [memory: admin-routes-need-rls-policies], user-facing routes use the RLS-scoped session client; this table needs real owner/member policies, not reliance on the service client.

## Capture points

### Auto (server-side, chat route)

In [app/api/chat/stream/route.ts](../../../app/api/chat/stream/route.ts): the route loads `canvas_state`, applies tool dispatches that mutate `state.workflow`, then persists the modified `canvas_state`. Insert one `kind:'auto'` row holding the **pre-edit** `canvas_state`, gated by:

1. A tool actually modified the graph (a patch was produced), **and**
2. `content_hash(pre-edit state)` ≠ the latest existing version row for this canvas (dedup — avoids stacking identical snapshots across turns).

Written with the service-role client. After insert, run retention pruning (below). Capture happens **once per turn** at the first graph-modifying tool, holding the state as it was when the turn began.

Failure of the version insert must **never** block the chat turn or the canvas persist — wrap in try/catch and log; a missed version is acceptable, a broken chat turn is not.

### Checkpoint (manual)

User clicks "Save checkpoint" in the History panel → `POST /api/versions/checkpoint { canvasId, label }` → insert `kind:'checkpoint'` with the **current** `canvas_state` (read from the DB row, the source of truth) + label + `created_by`. Owner-only. Not subject to dedup (a user may deliberately checkpoint an unchanged graph) and never pruned.

### Safety snapshot on restore

The restore route (below) captures the current canvas as a `kind:'auto'` version before overwriting, so a restore is itself reversible.

## Restore flow

`POST /api/versions/[id]/restore` (owner only):

1. Load the target version row; verify it belongs to a canvas the caller owns.
2. Read the current `sessions.canvas_state`; insert it as a `kind:'auto'` safety version (subject to retention pruning).
3. Write the target version's `canvas_state` into `sessions.canvas_state` (+ bump `updated_at`).
4. Return the restored `canvas_state` to the client.

Client:
- Loads the restored workflow into the store via `setCurrentWorkflow(workflow, false)` (not dirty — it's the new server baseline).
- Clears the undo stack (`past`/`future`) — restore is a fresh baseline, not an undoable in-session edit.
- In a shared canvas, the existing realtime channel ([lib/hooks/use-workflow-collaboration.ts](../../../lib/hooks/use-workflow-collaboration.ts)) broadcasts the new `canvas_state` so peers update. Reuse the same broadcast/echo-suppression path autosave uses (`markLocalSave` / server hash) so the restore doesn't bounce back as a remote change.

Restore deliberately does **not** modify chat messages or `node_results`.

## Retention / pruning

After inserting any `kind:'auto'` row for a `canvas_id`, delete `auto` rows beyond the newest 20:

```sql
DELETE FROM workflow_versions
WHERE canvas_id = $1 AND kind = 'auto'
  AND id NOT IN (
    SELECT id FROM workflow_versions
    WHERE canvas_id = $1 AND kind = 'auto'
    ORDER BY created_at DESC
    LIMIT 20
  );
```

Checkpoints are excluded from the count and never pruned. Pruning runs in the same code path as the auto insert (chat route for AI auto-versions; restore route for safety snapshots).

## API surface

New routes under `app/api/versions/`, all using the RLS-scoped **session** client (not service-role — these are user-facing):

| route | method | purpose | auth |
|---|---|---|---|
| `/api/versions?canvasId=…` | GET | list versions, newest first, **without** `canvas_state` payload (light) | member |
| `/api/versions/[id]` | GET | fetch one version's full `canvas_state` (preview/debug) | member |
| `/api/versions/checkpoint` | POST | create manual checkpoint `{ canvasId, label }` | owner |
| `/api/versions/[id]/restore` | POST | safety-snapshot + overwrite | owner |
| `/api/versions/[id]` | DELETE | delete a checkpoint | owner |

The list endpoint omits `canvas_state` to keep payloads small; the full snapshot is fetched only on restore (server-side) or explicit preview (`GET [id]`).

## UI — History panel

A slide-out drawer following the existing **Assets/Characters** side-panel pattern. Per [memory: side-panels-stay-mounted], it stays mounted after first open (no AnimatePresence unmount) so it keeps its data and any realtime subscription live.

Contents:
- **"Save checkpoint"** button — prompts for a name, calls the checkpoint API. Owner-only (hidden/disabled for non-owners and for editors in a shared canvas).
- **List**, newest-first. Each row shows:
  - an icon distinguishing auto (e.g. clock) vs checkpoint (⭐),
  - the label (checkpoints) or a relative timestamp ("12 min ago") for auto rows,
  - a **Restore** action (owner-only),
  - a delete (trash) action on checkpoints (owner-only).
- Visual grouping or a filter so named checkpoints are not lost among auto rows (e.g. checkpoints pinned to a top section, auto-versions below).

Non-owners in a shared canvas see the list read-only (no Save/Restore/Delete).

## Components / boundaries

- **DB layer** — `lib/db/versions.ts`: `listVersions(canvasId)`, `getVersion(id)`, `createCheckpoint(canvasId, label, userId)`, `restoreVersion(id, userId)`, `createAutoVersion(canvasId, state, userId?)`, `pruneAutoVersions(canvasId)`. Pure data access; no React. Mirrors [lib/db/workflows.ts](../../../lib/db/workflows.ts) conventions.
- **Auto-capture hook-in** — a small helper called from the chat route's tool-apply path (`maybeCaptureAutoVersion(canvasId, preEditState)`), service-role.
- **API routes** — thin handlers under `app/api/versions/` delegating to the DB layer with the session client.
- **History panel** — a new side-panel component + a store flag to open/close it, wired into the editor's panel system alongside Assets/Characters.
- **Client API** — methods in [lib/api/client.ts](../../../lib/api/client.ts) for list/checkpoint/restore/delete.

Each unit is independently testable: the DB layer against a live Supabase (ad-hoc script per repo convention), the panel against mocked client methods.

## Edge cases

- **Empty / brand-new canvas** (`canvas_state` is `{}`): skip auto-capture (nothing meaningful to snapshot); checkpoint allowed but dedup-irrelevant.
- **Concurrent restore + autosave**: restore writes `canvas_state` server-side; the client reload + `markLocalSave` grace window prevents the autosave debounce from immediately re-saving stale local state over it. Verify the echo-suppression path covers this.
- **Restore in a session that's mid-execution**: per existing autosave behavior, canvas writes don't touch running executions (`node_results` is separate). Restore changes the graph only; in-flight results land in `node_results` as before. Acceptable, but call it out in the panel UX (restoring won't cancel a run).
- **Version insert failure** must not break the chat turn or canvas persist (try/catch + log).
- **Non-owner attempts restore/checkpoint**: blocked at the API (RLS + explicit owner check) and hidden in the UI.

## Out of scope (YAGNI)

- Snapshotting chat history or `node_results` (explicitly excluded).
- Time-windowed/thinning retention (keep-last-N is enough).
- Diff/visual-compare between versions (could be a later `GET [id]` consumer).
- Auto-versioning of manual hand-edits (explicitly excluded; checkpoints cover that need).
- Branching/forking a version into a new session.

## Verification

Per [memory: verification-commands], verify types with `npx tsc --noEmit` (lint/build are unreliable here). The migration is applied and exercised against a live Supabase via an ad-hoc script in [scripts/](../../../scripts/) per repo convention (there is no test runner).
