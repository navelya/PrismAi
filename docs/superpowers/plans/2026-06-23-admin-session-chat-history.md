# Admin Session Chat History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin click a session in the User Detail drawer's Sessions tab and read a read-only transcript (text + images + timestamps) of that session's chat.

**Architecture:** One new admin GET route returns a session's messages (service-role read, owner-verified). One new typed client method calls it. The existing `SessionsTab` in `UserDetailDrawer.tsx` gains a drill-in: session rows become buttons that swap the tab into a transcript view with a back button, fetched lazily and cached per drawer-open.

**Tech Stack:** Next.js App Router (route handlers), TypeScript, Supabase (`@supabase/supabase-js` service client), React, Tailwind, lucide-react.

## Global Constraints

- **No test runner exists.** Verify with `npx tsc --noEmit` (reliable) — NOT `npm run lint` / `npm run build` (unreliable here). Manual E2E where noted.
- **Service-role client** (`createServiceClient()` from `@/lib/supabase/service`) is allowed ONLY in admin/webhook/cron routes. This feature's route is an admin route, so it is permitted — mirror the sibling `/api/admin/users/[id]/*` routes exactly.
- **Path alias:** `@/*` → repo root.
- **Admin auth:** every admin route guards with `requireAdmin()` from `@/lib/api/auth` and returns `auth.error` when present.
- **Reuse-first UI:** reuse existing helpers in `UserDetailDrawer.tsx` (`LoadingBlock`, `EmptyBlock`, `formatDateTime`) — do not add new popup shells.

---

### Task 1: Backend route — session transcript

**Files:**
- Create: `app/api/admin/users/[id]/sessions/[sessionId]/messages/route.ts`

**Interfaces:**
- Consumes: `requireAdmin()` → `{ error?: NextResponse }`; `createServiceClient()` → Supabase client.
- Produces: `GET` returning JSON `{ rows: Array<{ id: string; role: 'user' | 'assistant'; content: string | null; images: string[]; created_at: string }> }`. On owner-mismatch / missing session → `404 { error }`. On DB error → `500 { error }`.

- [ ] **Step 1: Create the route file**

Create `app/api/admin/users/[id]/sessions/[sessionId]/messages/route.ts` with this exact content:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

// Recursively collect image-looking URLs from an arbitrary metadata value.
// execution_result shapes vary (string URLs, { url }, arrays, nested), so we
// sweep generically rather than assume one shape.
function collectImageUrls(value: unknown, out: Set<string>): void {
    if (!value) return;
    if (typeof value === 'string') {
        if (/^https?:\/\//i.test(value) && /\.(png|jpe?g|webp|gif|avif)(\?|#|$)/i.test(value)) {
            out.add(value);
        }
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) collectImageUrls(item, out);
        return;
    }
    if (typeof value === 'object') {
        for (const v of Object.values(value as Record<string, unknown>)) collectImageUrls(v, out);
    }
}

export async function GET(
    _req: NextRequest,
    { params }: { params: { id: string; sessionId: string } },
) {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const { id, sessionId } = params;
    if (!id || !sessionId) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    try {
        const service = createServiceClient();

        // Ownership guard: the session must belong to this user.
        const { data: session, error: sErr } = await service
            .from('sessions')
            .select('id, user_id')
            .eq('id', sessionId)
            .maybeSingle();
        if (sErr) throw sErr;
        if (!session || session.user_id !== id) {
            return NextResponse.json({ error: 'Session not found' }, { status: 404 });
        }

        const { data, error } = await service
            .from('messages')
            .select('id, role, content, images, created_at, metadata')
            .eq('session_id', sessionId)
            .order('created_at', { ascending: true });
        if (error) throw error;

        const rows = (data ?? []).map((m: any) => {
            const urls = new Set<string>();
            if (Array.isArray(m.images)) for (const u of m.images) if (typeof u === 'string') urls.add(u);
            collectImageUrls(m.metadata?.execution_result, urls);
            return {
                id: m.id as string,
                role: m.role as 'user' | 'assistant',
                content: (m.content ?? null) as string | null,
                images: Array.from(urls),
                created_at: m.created_at as string,
            };
        });

        return NextResponse.json({ rows });
    } catch (err: any) {
        console.error('[Admin Users API] session messages error:', err);
        return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
    }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors referencing this file.

- [ ] **Step 3: Commit**

```bash
git add app/api/admin/users/[id]/sessions/[sessionId]/messages/route.ts
git commit -m "feat(admin): route to read a user's session chat transcript"
```

---

### Task 2: API client method + type

**Files:**
- Modify: `lib/api/admin-users.ts`

**Interfaces:**
- Consumes: route from Task 1.
- Produces: `AdminMessageRow` interface; `adminUsersApi.sessionMessages(id: string, sessionId: string) => Promise<{ rows: AdminMessageRow[] }>`.

- [ ] **Step 1: Add the `AdminMessageRow` interface**

In `lib/api/admin-users.ts`, immediately after the `AdminSessionRow` interface (ends around line 43), add:

```ts
export interface AdminMessageRow {
    id: string;
    role: 'user' | 'assistant';
    content: string | null;
    images: string[];
    created_at: string;
}
```

- [ ] **Step 2: Add the `sessionMessages` method**

In `lib/api/admin-users.ts`, inside the `adminUsersApi` object, immediately after the `sessions:` method (ends around line 118), add:

```ts
    sessionMessages: async (id: string, sessionId: string) => {
        const res = await fetch(`/api/admin/users/${id}/sessions/${sessionId}/messages`);
        return asJson<{ rows: AdminMessageRow[] }>(res);
    },
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add lib/api/admin-users.ts
git commit -m "feat(admin): sessionMessages API client method"
```

---

### Task 3: Drawer drill-in state + fetch wiring

**Files:**
- Modify: `components/admin/UserDetailDrawer.tsx`

**Interfaces:**
- Consumes: `adminUsersApi.sessionMessages`, `AdminMessageRow`, `AdminSessionRow`.
- Produces: drawer-level state `selectedSession`, `sessionMessages`, `messagesLoading`, `messagesError`; handlers `openSession(row)`, `backToSessions()`; passes them into `<SessionsTab .../>`.

- [ ] **Step 1: Import `AdminMessageRow`**

In `components/admin/UserDetailDrawer.tsx`, add `AdminMessageRow` to the existing type import from `@/lib/api/admin-users` (the block at lines 33-41 — add `type AdminMessageRow,` alongside `type AdminSessionRow,`).

- [ ] **Step 2: Add drill-in state**

After the existing `const [sessions, setSessions] = useState<AdminSessionRow[]>([]);` / `sessionsLoading` lines (around line 143-144), add:

```ts
    const [selectedSession, setSelectedSession] = useState<AdminSessionRow | null>(null);
    const [sessionMessages, setSessionMessages] = useState<Record<string, AdminMessageRow[]>>({});
    const [messagesLoading, setMessagesLoading] = useState(false);
    const [messagesError, setMessagesError] = useState<string | null>(null);
```

- [ ] **Step 3: Reset drill-in state on close**

In the open/close effect (the `else` branch around lines 177-183 that clears `user`/`ledger`/`assets`/`sessions`), add these lines inside that `else` block:

```ts
            setSelectedSession(null);
            setSessionMessages({});
            setMessagesError(null);
```

- [ ] **Step 4: Reset selected session when the user changes**

In the prefetch effect keyed on `[userId]` (the one starting around line 189 that sets the three loadings), add at the very top of the effect body (right after `if (!userId) return;`):

```ts
        setSelectedSession(null);
```

This guarantees switching users never strands a transcript from the previous user.

- [ ] **Step 5: Add the openSession / backToSessions handlers**

After the `handleCopyId` function (ends around line 271), add:

```ts
    const openSession = useCallback((row: AdminSessionRow) => {
        setSelectedSession(row);
        setMessagesError(null);
        if (!userId || sessionMessages[row.id]) return;
        setMessagesLoading(true);
        adminUsersApi.sessionMessages(userId, row.id)
            .then(res => setSessionMessages(prev => ({ ...prev, [row.id]: res.rows })))
            .catch(err => setMessagesError(err.message || 'Failed to load messages'))
            .finally(() => setMessagesLoading(false));
    }, [userId, sessionMessages]);

    const backToSessions = useCallback(() => {
        setSelectedSession(null);
        setMessagesError(null);
    }, []);
```

- [ ] **Step 6: Pass props into SessionsTab**

Replace the existing render line (around line 370):

```tsx
                                    {tab === 'sessions' && <SessionsTab rows={sessions} loading={sessionsLoading} />}
```

with:

```tsx
                                    {tab === 'sessions' && (
                                        <SessionsTab
                                            rows={sessions}
                                            loading={sessionsLoading}
                                            selected={selectedSession}
                                            messages={selectedSession ? sessionMessages[selectedSession.id] : undefined}
                                            messagesLoading={messagesLoading}
                                            messagesError={messagesError}
                                            onSelect={openSession}
                                            onBack={backToSessions}
                                        />
                                    )}
```

- [ ] **Step 7: Type-check (expected to FAIL until Task 4)**

Run: `npx tsc --noEmit`
Expected: errors about `SessionsTab` props not matching — resolved in Task 4. Do not commit yet.

---

### Task 4: SessionsTab transcript rendering

**Files:**
- Modify: `components/admin/UserDetailDrawer.tsx`

**Interfaces:**
- Consumes: props passed in Task 3 Step 6; helpers `LoadingBlock`, `EmptyBlock`, `formatDateTime`.
- Produces: updated `SessionsTab` component rendering list mode + transcript mode.

- [ ] **Step 1: Add the ChevronLeft + ChevronRight icons to imports**

In the lucide-react import block (lines 5-28), add `ChevronLeft,` and `ChevronRight,`.

- [ ] **Step 2: Replace the SessionsTab component**

Replace the entire existing `SessionsTab` function (around lines 631-649) with:

```tsx
function SessionsTab({
    rows,
    loading,
    selected,
    messages,
    messagesLoading,
    messagesError,
    onSelect,
    onBack,
}: {
    rows: AdminSessionRow[];
    loading: boolean;
    selected: AdminSessionRow | null;
    messages: AdminMessageRow[] | undefined;
    messagesLoading: boolean;
    messagesError: string | null;
    onSelect: (row: AdminSessionRow) => void;
    onBack: () => void;
}) {
    if (selected) {
        return (
            <div className="space-y-3">
                <div className="flex items-center gap-2">
                    <button
                        onClick={onBack}
                        className="flex items-center gap-1 px-2 py-1.5 -ml-2 text-content-tertiary hover:text-content-primary rounded-lg hover:bg-white/5 transition-colors text-[10px] font-black uppercase tracking-widest"
                    >
                        <ChevronLeft className="w-3.5 h-3.5" /> Back
                    </button>
                    <div className="min-w-0">
                        <div className="text-xs font-bold text-content-primary truncate">{selected.title ?? 'Untitled'}</div>
                        <div className="text-[10px] text-content-tertiary font-mono">{formatDateTime(selected.created_at)}</div>
                    </div>
                </div>

                {messagesLoading && !messages ? (
                    <LoadingBlock />
                ) : messagesError ? (
                    <div className="p-3 rounded-xl bg-red-500/5 border border-red-500/20 text-red-400 text-xs font-medium">{messagesError}</div>
                ) : !messages || messages.length === 0 ? (
                    <EmptyBlock message="No messages in this session." />
                ) : (
                    <div className="space-y-3">
                        {messages.map(m => (
                            <div
                                key={m.id}
                                className={`p-3 rounded-xl border ${m.role === 'user' ? 'bg-accent-primary/5 border-accent-primary/15' : 'bg-white/5 border-white/10'}`}
                            >
                                <div className="flex items-center justify-between gap-2 mb-1.5">
                                    <span className={`text-[9px] font-black uppercase tracking-widest ${m.role === 'user' ? 'text-accent-primary' : 'text-content-tertiary'}`}>
                                        {m.role}
                                    </span>
                                    <span className="text-[9px] text-content-tertiary font-mono">{formatDateTime(m.created_at)}</span>
                                </div>
                                {m.content && (
                                    <p className="text-xs text-content-primary whitespace-pre-wrap break-words">{m.content}</p>
                                )}
                                {m.images.length > 0 && (
                                    <div className="grid grid-cols-3 gap-2 mt-2">
                                        {m.images.map((url, i) => (
                                            <a
                                                key={`${m.id}-${i}`}
                                                href={url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="relative aspect-square rounded-lg overflow-hidden bg-white/5 border border-white/10 hover:border-white/20 transition-all"
                                            >
                                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                                <img src={url} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
                                            </a>
                                        ))}
                                    </div>
                                )}
                                {!m.content && m.images.length === 0 && (
                                    <p className="text-[10px] text-content-tertiary italic">(no text)</p>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    if (loading) return <LoadingBlock />;
    if (rows.length === 0) return <EmptyBlock message="No workflow sessions." />;
    return (
        <div className="space-y-2">
            {rows.map(row => (
                <button
                    key={row.id}
                    onClick={() => onSelect(row)}
                    className="w-full flex items-center justify-between gap-3 p-3 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all text-left"
                >
                    <div className="min-w-0">
                        <div className="text-xs font-bold text-content-primary truncate">{row.title ?? 'Untitled'}</div>
                        <div className="text-[10px] text-content-tertiary mt-0.5 font-mono">{formatDateTime(row.created_at)}</div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        {row.is_deleted && (
                            <span className="px-2 py-0.5 bg-red-500/10 border border-red-500/20 text-red-400 text-[8px] font-black uppercase tracking-widest rounded-md">Deleted</span>
                        )}
                        <ChevronRight className="w-4 h-4 text-content-tertiary" />
                    </div>
                </button>
            ))}
        </div>
    );
}
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: clean (no new errors from any task).

- [ ] **Step 4: Commit**

```bash
git add components/admin/UserDetailDrawer.tsx
git commit -m "feat(admin): drill into a session to view its chat transcript"
```

---

### Task 5: Manual verification

**Files:** none (verification only).

- [ ] **Step 1: Run the dev server**

Run: `npm run dev` and open the admin Users page.

- [ ] **Step 2: Walk the happy path**

- Open a user who has chat history → **Sessions** tab.
- Confirm session rows show a hover state + chevron and are clickable.
- Click a session → transcript loads: each message shows role label, timestamp, text, and image thumbnails.
- Click a thumbnail → opens full-size in a new tab.
- Click **Back** → returns to the session list.
- Click a second session → its transcript loads; re-open the first → renders instantly (cached).

- [ ] **Step 3: Walk the edge cases**

- Open a session with no messages → "No messages in this session." empty state.
- Switch to another user while a transcript is open → drawer resets to that user's session list (no stranded transcript).
- Close and reopen the drawer → starts in list mode.

- [ ] **Step 4: Final type-check**

Run: `npx tsc --noEmit`
Expected: clean.

---

## Self-Review Notes

- **Spec coverage:** route (Task 1) ✓; ownership guard + 404 (Task 1) ✓; image extraction from `images` + `metadata.execution_result` (Task 1) ✓; `AdminMessageRow` + client method (Task 2) ✓; drill-in state, lazy fetch, cache, reset-on-close, reset-on-user-change (Task 3) ✓; list→transcript rendering with back button, text/images/timestamps, loading/error/empty (Task 4) ✓; manual E2E (Task 5) ✓.
- **No test runner:** TDD's red/green is replaced by `npx tsc --noEmit` + manual E2E per project convention — intentional, not a placeholder.
- **Type consistency:** `AdminMessageRow` fields (`id/role/content/images/created_at`) identical across route output (Task 1), interface (Task 2), and consumer (Task 4). Handler names `openSession`/`backToSessions` and props `selected/messages/messagesLoading/messagesError/onSelect/onBack` match between Task 3 Step 6 and Task 4 Step 2.
```
