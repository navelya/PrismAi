# Workflow Collaboration — Design Spec

**Date:** 2026-06-02
**Status:** Approved (brainstorming) — pending implementation plan
**Branch policy:** All work stays on `main`. Do **not** create a new branch or git worktree for this feature.

## Summary

Add real-time, multi-user collaboration to PrismAi workflows. An owner can share a workflow by email; invitees receive an email and gain Editor or Viewer access. Collaborators in the same workflow see each other's live cursors, see node movements/edits propagate instantly, and (for editors) edit the canvas together — a Figma-style experience scoped to a node-graph canvas.

This is built by **extending the realtime infrastructure that already exists** (per-session `canvas_state` sync via Supabase postgres_changes) rather than replacing it with a CRDT. See "Chosen approach" for why.

## Goals

- Owner can share a workflow with other users by email address.
- Invitees get an email with a link into the workflow.
- Per-person roles: **Editor** (full collaboration) or **Viewer** (read-only, sees canvas + live cursors).
- Invites to emails without an account are **pending** and auto-claimed on signup.
- Live presence: cursors, who's-online roster, live node movement.
- Edits propagate in real time between everyone viewing the same workflow.
- Generative runs are billed to **the user who triggers them** (not the owner). Viewers cannot run.
- **Each collaborator gets their own private chat thread** on the shared canvas. When a user opens a shared workflow they automatically get a fresh, private thread (as if they pressed "new chat"); all threads edit the one shared canvas.

## Non-goals

- Full CRDT / offline-convergent editing (see "Chosen approach" — deferred unless heavy same-node contention becomes real).
- Collaborators re-sharing (only the owner manages access).
- A "manage access" role tier (only Owner / Editor / Viewer).
- Public/link-anyone sharing — sharing is always to a specific email.
- **Multiple chat threads per user, a thread switcher dropdown, and browsing/opening other users' chats — deferred.** v1 gives each user exactly one private thread per workflow. The decoupling below is built now so this UX can layer on later without a second migration.

## Chosen approach: Presence + granular op-broadcast, per-node last-write-wins

A node-graph canvas is not a text document. Edits here are coarse-grained and naturally partitioned (drag a node, add/delete a node, connect an edge, edit one node's config) and almost always target *different* nodes. A full CRDT (Yjs) earns its keep for freeform/character-level editing, but here it would be cost without payoff: Yjs has no first-class Supabase provider, and it fights the existing architecture (the chat brain emits JSON patches to `canvas_state`; the v2 execution engine and autosave read/write that JSONB directly).

Instead we keep `sessions.canvas_state` as the source of truth and add two realtime layers:

1. **Presence channel** — ephemeral roster + cursor identity. Never persisted.
2. **Op + cursor broadcast** — granular edit ops applied to peers' stores immediately; persistence still flows through the existing debounced `canvas_state` autosave.

Conflicts resolve **per-node, last-write-wins**. Because ops keep every client convergent in real time, by the time anyone autosaves, their blob already contains peers' ops — so whole-blob last-write-wins is safe. The only real race (two people committing a move on the *same* node in the same tick) resolves to the later commit, which is expected behavior. If heavy same-node contention ever becomes real, the op layer is a clean graft point for a CRDT later.

---

## Section 1 — Data model & access control

### New table `session_collaborators`

| column | type | notes |
|---|---|---|
| `id` | uuid pk default `gen_random_uuid()` | |
| `session_id` | uuid → `sessions(id)` on delete cascade | |
| `user_id` | uuid → `auth.users(id)` on delete cascade, **nullable** | `NULL` = pending invite not yet claimed |
| `invited_email` | text not null | stored lowercased |
| `role` | text not null check (`'editor'`, `'viewer'`) | |
| `invited_by` | uuid → `auth.users(id)` | the owner who shared |
| `invite_token` | uuid not null default `gen_random_uuid()` | powers the email link |
| `created_at` | timestamptz default now() | |
| `accepted_at` | timestamptz nullable | set when claimed |
| | | `UNIQUE(session_id, invited_email)` |

Indexes: `(session_id)`, `(user_id)`, `(invited_email)`, `(invite_token)`.

### Claiming logic

- **At invite time:** resolve the email to an existing account via a `SECURITY DEFINER` RPC `find_user_id_by_email(p_email text) returns uuid`. If found, set `user_id` immediately (so an existing user sees the workflow right away). If not, `user_id` stays `NULL`.
- **On signup:** a trigger on `auth.users` insert claims pending rows:
  `UPDATE session_collaborators SET user_id = NEW.id, accepted_at = now() WHERE lower(invited_email) = lower(NEW.email) AND user_id IS NULL`.

### RLS helper functions (`STABLE SECURITY DEFINER`)

To avoid copy-pasting OR-logic across many policies:
- `can_access_session(sid uuid) returns boolean` — true if `auth.uid()` is the session owner OR has a `session_collaborators` row with `user_id = auth.uid()`.
- `can_edit_session(sid uuid) returns boolean` — true if owner OR collaborator row with `role = 'editor'` and `user_id = auth.uid()`.

### RLS policy changes

- `sessions`: SELECT → `can_access_session(id)`; UPDATE → `can_edit_session(id)`; DELETE stays owner-only (`auth.uid() = user_id`).
- `messages`, `executions_v2`, `node_results`: swap their existing `sessions.user_id = auth.uid()` join for `can_access_session(session_id)` (SELECT) / `can_edit_session(session_id)` (INSERT/UPDATE). This makes a collaborator's chat + executions work, and makes the **runner-pays** billing model fall out naturally (runs execute under the collaborator's own auth → existing debit hits their balance; viewers are blocked by `can_edit_session`).
- `session_collaborators`: SELECT for owner + collaborators of that session; INSERT/UPDATE/DELETE **owner-only**.

### Session-list query change

The home-screen session list currently filters `.eq('user_id', me)` in code, so RLS widening alone won't surface shared workflows. Update that query to also return sessions where the user is a collaborator (e.g. union via the collaborator table), tagged "Shared with me", filtering out `is_deleted`.

---

## Section 1b — Chat threading: per-user private threads on a shared canvas

### The decoupling problem

Today a `sessions` row **is** both the chat thread and the canvas: `canvas_state` lives on the row, and `messages.session_id` / `executions_v2.session_id` / `node_results.session_id` all point at it. To give one shared canvas many private chat threads, the chat thread must be separated from the canvas it edits. Without this, a shared chat would race the agentic Claude loop (two users → two concurrent loops mutating one thread + one canvas) and muddle the brain's context.

### Approach: canvas-owner session + per-user companion threads

Rather than move `canvas_state` into a new table (high blast radius), add a pointer and resolve it:

- Add column `sessions.canvas_session_id uuid REFERENCES sessions(id) ON DELETE CASCADE` (nullable).
  - The **owner's original session is the canvas session**: `canvas_session_id IS NULL`, and it continues to hold `canvas_state` exactly as today. It also doubles as the owner's own chat thread for v1.
  - When a collaborator opens the shared workflow, a **companion session** is created for them: a thin `sessions` row with `user_id = collaborator`, `canvas_session_id = <owner's canvas session>`, holding only their private messages. Its own `canvas_state` is unused.
- Everywhere canvas identity is needed, resolve `effectiveCanvasId = session.canvas_session_id ?? session.id`.
  - **Canvas reads/writes** (load, autosave, chat-brain patches) operate on `effectiveCanvasId`.
  - **Messages** stay keyed on the per-user `session.id` (private threads).
  - **Executions & node_results** key on `effectiveCanvasId` (the shared canvas) but carry `user_id = runner` — so all collaborators see the same node results, and the runner is billed.
  - **`session_collaborators`** (Section 1) attach to the **canvas session id**; `can_access_session` / `can_edit_session` are evaluated against `effectiveCanvasId`.

### Companion-thread lifecycle

- **Open:** `POST /api/sessions/[canvasId]/open` creates-or-returns the calling user's companion thread for that canvas (owner gets the canvas session itself). Idempotent — one thread per (user, canvas) in v1.
- **Revoke / downgrade-removal:** when the owner revokes a collaborator, delete that user's companion thread for the canvas (their private chat goes away; the shared canvas is untouched).
- **Canvas delete:** `ON DELETE CASCADE` on `canvas_session_id` removes all companion threads when the owner deletes the workflow.
- **Single-user workflows are unchanged:** `canvas_session_id IS NULL`, no collaborators, no companion threads — existing behavior preserved.

### Backward compatibility

All existing sessions have `canvas_session_id = NULL`, so `effectiveCanvasId` falls back to `session.id` and current single-user flows behave identically. No data backfill required.

---

## Section 2 — Sharing, invites & email flow

### Share button + dialog

- "Share" button in the session/canvas header. Owner sees the full management dialog; collaborators see a read-only roster.
- Dialog contents: email input + role picker (Editor / Viewer) + Invite; roster list with avatar, role dropdown (owner can change), remove (×); pending invites show a "Pending" badge.

### API routes (normal RLS-enforced server client; owner-gated in code and RLS)

- `POST /api/sessions/[id]/collaborators` — body `{ email, role }`. Lowercases email, calls `find_user_id_by_email` RPC, upserts a `session_collaborators` row (updates role if already invited), fires invite email. Returns the row.
- `GET /api/sessions/[id]/collaborators` — roster.
- `PATCH /api/sessions/[id]/collaborators/[collabId]` — change role.
- `DELETE /api/sessions/[id]/collaborators/[collabId]` — revoke.
- `POST /api/invites/accept` — body `{ token }`. Validates token, and if the logged-in user's email matches the invite, sets `user_id`/`accepted_at`; redirects into the workflow.

### Email

- New `lib/email/workflow-invite.ts` → `sendWorkflowInvite({ to, workflowName, inviterName, acceptUrl })`, following the existing Resend pattern in `lib/email/admin-alerts.ts`.
- `acceptUrl = ${NEXT_PUBLIC_APP_URL}/share/{invite_token}`.
- Send failures are caught/logged (never break the invite write); the dialog surfaces a non-blocking "invite saved but email failed" warning with a copyable link.

### `/share/[token]` page

- Not logged in → bounce to login/signup (prefilled with invited email), then back to `/share/[token]`.
- Logged in → "You've been invited to *{workflow}*" confirmation → `POST /api/invites/accept` → redirect into workflow. Email mismatch shows a clear error; no access granted.

### Billing

No new billing code. A collaborator's run creates an execution against the **shared canvas** (`effectiveCanvasId`) but stamped with `user_id = runner`, so the existing pre-flight debit/refund in `/api/executions/start` and `lib/workflow/orchestrator.ts` charges the runner while node results stay visible to everyone on the canvas. Viewers blocked by RLS (`can_edit_session`) and in UI (run buttons hidden). Verify the executions-start route does not re-assert `sessions.user_id = me` anywhere that would block an editor, and that it resolves `effectiveCanvasId` rather than assuming the chat session holds the canvas.

---

## Section 3 — Realtime collaboration layer

A new client hook `useWorkflowCollaboration(canvasId)` owns two new Supabase Realtime channels per open workflow, layered on top of the existing `canvas_state` sync. **Channel keying matters with per-user threads (Section 1b):** canvas-scoped channels key on `effectiveCanvasId` (shared across all collaborators), while the chat-message channel stays keyed on the per-user `session.id` (private thread).

- **Shared, keyed on `effectiveCanvasId`:** canvas_state sync (`chat-sessions-{canvasId}`), execution results (`session_results_{canvasId}`), presence, and ops — so everyone sees the same canvas, node results, cursors, and edits.
- **Private, keyed on the user's `session.id`:** chat messages (`chat-messages-{chatSessionId}`) — each user only receives their own thread's message updates.

### 1. Presence channel — `workflow-presence-{canvasId}`

- Each client `track()`s `{ userId, name, color, role }`. Color assigned deterministically from `userId` (stable across clients).
- Drives the roster (header avatar stack) and cursor identity. `sync`/`join`/`leave` events update a `collaborators` map in the store (low frequency → store is fine).

### 2. Op + cursor broadcast — `workflow-ops-{canvasId}` (`self: false`)

**High-frequency, ephemeral (never persisted):**
- `cursor` — `{ userId, x, y }` in flow-coords, throttled ~30–40ms. Rendered as an overlay that transforms with the ReactFlow viewport.
- `node:drag` — live position while a peer drags, applied through the existing `liveNodePositions` slice.

**Edit ops (applied to store immediately; persisted via normal autosave):**
- `node:add`, `node:delete`, `node:move-commit` (drag end), `node:config`, `edge:add`, `edge:delete`.
- Every op carries `origin: userId`; peers ignore their own echo.

### Persistence & conflict handling

Persistence stays as today (debounced `canvas_state` autosave) but editors can now write (RLS widened). Ops keep every client convergent, so saved blobs are near-identical → whole-blob last-write-wins is safe. The existing `canvas_state` postgres_changes subscription stays on as the **reconciliation backstop** (repairs missed ops on reconnect/tab-sleep); existing hash-guard + save-grace-window prevent echo loops.

### Save authority

A client schedules a remote save only when *it* originated a change (it already tracks `isWorkflowDirty`); applied peer-ops update the store but don't re-trigger a redundant remote write. Keeps writes proportional to real edits, not to viewer count.

### Membership changes mid-session

When the owner removes/downgrades a collaborator, a `membership` broadcast tells that client to drop to read-only or redirect out; RLS revocation is the hard backstop.

---

## Section 4 — UI / client surface

### Header
- **Presence avatar stack** — overlapping colored avatars of everyone present, "+N" overflow, name/role tooltips.
- **Share button** — opens the Section 2 dialog (management for owner, read-only roster for collaborators).
- **"View only" badge** — shown to viewers.

### Live cursors
- `<CollaboratorCursors>` overlay inside the ReactFlow pane. Each remote cursor = absolutely-positioned SVG pointer + name pill in the user's color, positioned by transforming flow-coords through the current viewport. Interpolates between broadcasts; fades out on `leave`. `pointer-events: none`.

### Live node movement
- Peer `node:drag` routed through the `liveNodePositions` slice; moving node shows a subtle outline in the dragger's color.

### Viewer read-only mode (`role === 'viewer'`)
- ReactFlow `nodesDraggable={false}`, `nodesConnectable={false}`, edges not deletable; selection kept for inspection.
- Run/generate buttons hidden; chat composer disabled with "View only — ask an editor to make changes" hint.
- Write API calls also rejected server-side by RLS (UI gating is convenience, not the security boundary).

### Performance guardrails
Cursor/drag broadcasts are throttled; the cursor overlay updates via refs / `requestAnimationFrame` rather than per-frame store writes, so high-frequency presence traffic does not churn `currentWorkflow` or trigger graph-wide re-renders. (Consistent with prior canvas-perf findings: avoid hot-path writes to `currentWorkflow`.) Only low-frequency roster changes go through the store.

---

## Section 5 — Edge cases, security & verification

### Edge cases & error handling
- **Re-inviting** an existing collaborator → upsert updates role (`UNIQUE(session_id, invited_email)`).
- **Pending invite then signup** → claimed by the `auth.users` insert trigger; existing accounts get `user_id` at invite time.
- **Email mismatch on accept** → clear error, no access.
- **Owner deletes/soft-deletes session** → cascade removes collaborator rows; shared-with-me lists filter `is_deleted`.
- **Revoked mid-session** → `membership` broadcast → read-only/redirect; RLS hard backstop.
- **Realtime drop / tab-sleep** → existing canvas_state reconciliation repairs missed ops on reconnect.
- **Email send failure** → invite row still written; dialog shows non-blocking warning + copyable link.

### Security
- No service-role client in any user-facing route (per CLAUDE.md) — email→user lookup via `SECURITY DEFINER` RPC.
- RLS is the real boundary; UI gating is convenience only.
- `find_user_id_by_email` enables light email enumeration; restrict to `authenticated`, return only what the invite action needs. Known, accepted tradeoff for an invite feature.
- Collaborators cannot re-share (owner-only writes on `session_collaborators`).

### Testing / verification (no test runner; per CLAUDE.md)
- `npx tsc --noEmit` for type safety (lint/build unreliable in this repo).
- Ad-hoc integration script in `scripts/` (service client): invite → claim → role change → revoke, asserting the RLS helper functions gate correctly.
- Manual two-browser plan: two accounts, share Editor + Viewer; confirm live cursors, live drag, op propagation, viewer read-only, runner-pays billing, and revoke-kicks-out.

---

## Affected / new files (indicative)

**New:**
- `supabase/migrations/2026XXXX_session_collaborators.sql` — `session_collaborators` table, `sessions.canvas_session_id` column, RPC, trigger, RLS helpers, policy changes.
- `lib/email/workflow-invite.ts`
- `app/api/sessions/[id]/collaborators/route.ts` (+ `[collabId]/route.ts`)
- `app/api/sessions/[canvasId]/open/route.ts` — create-or-return the caller's companion chat thread.
- `app/api/invites/accept/route.ts`
- `app/share/[token]/page.tsx`
- `lib/hooks/use-workflow-collaboration.ts`
- `components/.../ShareDialog.tsx`, `PresenceAvatars.tsx`, `CollaboratorCursors.tsx`

**Modified:**
- RLS-affected policies for `sessions`, `messages`, `executions_v2`, `node_results` (evaluate against `effectiveCanvasId`).
- Canvas load / autosave / chat-brain route to resolve `effectiveCanvasId = canvas_session_id ?? id` for all canvas reads/writes; messages stay on the per-user `session.id`.
- Execution start to target `effectiveCanvasId` with `user_id = runner`.
- Session-list query (surface "shared with me"; show the workflow once, resolve/create the user's thread on open).
- Canvas/session header (Share button, avatar stack, view-only badge).
- ReactFlow canvas wiring (cursor overlay, peer drag via `liveNodePositions`, viewer read-only props).
- App store: `collaborators` roster slice; wire op-apply into existing node/edge actions.

## Open implementation checks (resolve during planning)
- Confirm `/api/executions/start` and orchestrator don't hard-assert owner identity in a way that blocks editors, and that they target `effectiveCanvasId`.
- Confirm Supabase Realtime postgres_changes honors the widened RLS for collaborators on the `sessions` channel.
- Confirm the `auth.users` insert trigger composes cleanly with the existing `handle_new_user()` trigger.
- Confirm the chat-brain route ([lib/chat/](lib/chat/)) reads/patches the canvas via `effectiveCanvasId` while persisting messages to the caller's companion `session.id` — i.e. a collaborator's chat edits land on the shared canvas, not their thin companion row.
- Confirm autosave/`saveWorkflow` and `use-chat-realtime` canvas sync resolve `effectiveCanvasId` (today they assume `session.id` holds the canvas).
