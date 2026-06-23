# Admin — View Chat History Per Session

**Date:** 2026-06-23
**Status:** Approved (design)

## Problem

In the admin panel's **User Detail drawer** ([components/admin/UserDetailDrawer.tsx](../../../components/admin/UserDetailDrawer.tsx)), the **Sessions** tab lists a user's workflow sessions but the rows are inert — an admin can see *that* a session exists but cannot inspect the chat conversation that happened inside it. Admins need to read a user's chat history for support, abuse review, and debugging.

## Goal

Let an admin click a session in the Sessions tab and drill into a **read-only transcript** of that session's chat: message role, text, attached/result images, and per-message timestamps. A back control returns to the session list. Everything stays inside the existing right-side drawer (no new popup).

## Non-Goals (YAGNI)

- No editing or deleting of messages.
- No message pagination (the real chat loads all of a session's messages at once; admin parity is fine — sessions are bounded).
- No rich rendering (markdown, thinking blocks, workflow cards, run-result strips, node-ref chips). Plain text + image thumbnails only.
- No realtime updates — a one-shot fetch on session open.

## Data Model (existing)

`messages` table ([supabase/migrations/20260113_init_sessions.sql](../../../supabase/migrations/20260113_init_sessions.sql)):

- `id uuid`
- `session_id uuid` → `sessions(id)`
- `role text` — `'user' | 'assistant'`
- `content text`
- `images text[]` — attached image URLs (mostly user turns)
- `created_at timestamptz`
- `metadata jsonb` (added by a later migration) — may contain `execution_result` with generated-image URLs on assistant turns

No schema change is required.

## Design

### 1. Backend — new admin route

**File:** `app/api/admin/users/[id]/sessions/[sessionId]/messages/route.ts`

- `GET` only. `export const dynamic = 'force-dynamic'`.
- Guarded by `requireAdmin()` (same pattern as the sibling sessions/ledger/assets routes).
- Uses the **service-role client** (`createServiceClient()`): an admin is reading another user's data, which RLS would block. This matches every existing `/api/admin/users/[id]/*` route. (Per CLAUDE.md the service client is allowed in admin/webhook/cron contexts; admin routes here already use it.)
- **Ownership guard:** fetch the session by `sessionId` and verify `session.user_id === params.id`. If it doesn't match (or the session doesn't exist), return `404` — prevents an admin from fishing an arbitrary session via a mismatched URL.
- Query: `messages` where `session_id = sessionId`, select `id, role, content, images, created_at, metadata`, order `created_at asc`.
- **Image extraction:** for each row, build a `images: string[]` list = the `images` column plus a best-effort sweep of `metadata.execution_result` for image URLs (string URLs / `{url}` shapes), de-duplicated. If `metadata` is absent or unparseable, fall back to just the `images` column. `metadata` is **not** returned to the client raw — only the derived `images` array, to keep the payload lean.
- Returns `{ rows: AdminMessageRow[] }`.

### 2. API client

**File:** `lib/api/admin-users.ts`

- New interface:
  ```ts
  export interface AdminMessageRow {
      id: string;
      role: 'user' | 'assistant';
      content: string | null;
      images: string[];
      created_at: string;
  }
  ```
- New method:
  ```ts
  sessionMessages: async (id: string, sessionId: string) => {
      const res = await fetch(`/api/admin/users/${id}/sessions/${sessionId}/messages`);
      return asJson<{ rows: AdminMessageRow[] }>(res);
  }
  ```

### 3. UI — drawer transcript drill-in

**File:** `components/admin/UserDetailDrawer.tsx`

State added at the drawer level:
- `selectedSession: AdminSessionRow | null` — which session is being viewed (null = list mode). Holds the row so the transcript header can show its title/date without a refetch.
- `sessionMessages: Record<string, AdminMessageRow[]>` — per-session cache keyed by session id.
- `messagesLoading: boolean`, `messagesError: string | null`.

Reset alongside the existing open/close effect (clear `selectedSession`, `sessionMessages` when the drawer closes; also clear `selectedSession` whenever `userId` changes so switching users doesn't strand a transcript).

`SessionsTab` changes:
- Receives `userId`, `selectedSession`, `onSelect(session)`, `onBack()`, plus the messages cache/loading/error.
- **List mode** (`selectedSession == null`): each session row becomes a `<button>` calling `onSelect(row)`. Keep the existing title/date/Deleted-badge layout; add a hover affordance and a chevron to signal it's clickable.
- **Transcript mode** (`selectedSession != null`): a sticky-ish header with a `← Back to sessions` button (calls `onBack()`) and the session title + created date, followed by the message list.
  - On entering transcript mode, if `sessionMessages[id]` is undefined, the drawer fetches via `adminUsersApi.sessionMessages(userId, id)` and caches the result. Cached sessions render instantly.
  - Each message renders as a bubble: a small role label (`user` / `assistant`) + timestamp on top, the `content` text below (whitespace-preserved, no markdown), and an image thumbnail grid if `images.length > 0`.
  - Thumbnails are `<a target="_blank">` opening the full image in a new tab (same pattern as `AssetsTab`).
  - Loading → `LoadingBlock`; error → inline error block; empty → `EmptyBlock` ("No messages in this session.").

Fetch wiring: a small handler `openSession(row)` sets `selectedSession` and, if not cached, kicks off the fetch (sets `messagesLoading`, populates cache, clears loading). `backToSessions()` sets `selectedSession = null`. The existing tab nav stays; switching tabs away from Sessions does not need to reset `selectedSession` (returning shows the last-viewed transcript, which is acceptable), but switching users does.

## Error Handling

- Route: ownership mismatch / missing session → `404`; DB error → `500` with logged message (mirrors sibling routes).
- Client: fetch failure surfaces as `messagesError` rendered inline in transcript mode; the back button still works.

## Testing

No test runner in this repo (per CLAUDE.md). Verification:
- `npx tsc --noEmit` clean (the reliable check here).
- Manual E2E: open admin → Users → a user with chat history → Sessions tab → click a session → transcript loads with text + image thumbnails + timestamps; back returns to the list; clicking another session loads it; thumbnails open full-size; a session with no messages shows the empty state; switching users resets the view.

## Files Touched

| File | Change |
|------|--------|
| `app/api/admin/users/[id]/sessions/[sessionId]/messages/route.ts` | **new** — admin GET transcript |
| `lib/api/admin-users.ts` | `AdminMessageRow` + `sessionMessages()` |
| `components/admin/UserDetailDrawer.tsx` | drill-in state + transcript rendering in `SessionsTab` |
