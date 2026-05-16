# Admin Users Tab — Design

**Date:** 2026-05-16
**Status:** Approved (in-session, single-commit delivery)

## Goal

Replace the "Coming Soon" placeholder in the admin panel's Users tab with a working users-management surface: searchable/filterable table, drawer with per-user detail (overview, token history, assets, sessions), and a set of admin actions (grant/claw-back tokens, ban/unban, toggle admin, send password reset, CSV export).

Ships in a single commit.

## Existing primitives we reuse

| Primitive | Purpose |
|---|---|
| `admin_adjust_tokens(target, amount, admin, note, idempotency_key)` RPC | Grant or claw back credits. Writes to `token_ledger` as `admin_adjustment`. Already enforces non-negative balance and idempotency. |
| `token_ledger` table | Append-only history. Reused; no new table. |
| `supabase.auth.admin.listUsers` / `updateUserById` / `generateLink` | List, ban (`ban_duration`), and trigger password reset. |
| `lib/supabase/service.ts → createServiceClient()` | Bypasses RLS for admin-only routes (read all users, read all assets, etc.). All new routes gate on `requireAdmin()` first, then use the service client for cross-user reads. |
| `requireAdmin()` in `lib/api/auth.ts` | Auth gate for every new route. |
| `prevent_admin_self_elevation` trigger | Protects against bad admin-toggle paths. Service-role bypasses; the API route refuses to demote `auth.uid()` itself for safety. |

## API surface (new routes under `app/api/admin/users/`)

| Method | Path | Body / Query | Behavior |
|---|---|---|---|
| `GET` | `/api/admin/users` | `?q=&status=&plan=&sort=&dir=&page=&pageSize=` | Paginated. Joins `auth.users` (via `auth.admin.listUsers`) ⨝ `profiles` ⨝ `subscriptions`. Status filter: `all|active|banned|admin|low_balance`. Plan filter: plan id. Server-side search on email. |
| `GET` | `/api/admin/users/stats` | — | Total users, active in last 7d (by `last_sign_in_at`), banned count, total tokens issued (sum of positive ledger amounts). |
| `GET` | `/api/admin/users/export` | same filters as list | CSV stream. Same shape as the table rows. |
| `GET` | `/api/admin/users/[id]` | — | One user: profile + subscription + `auth.users` row. |
| `GET` | `/api/admin/users/[id]/ledger` | `?page=&pageSize=` | Paginated `token_ledger` rows for the user. |
| `GET` | `/api/admin/users/[id]/assets` | `?page=&pageSize=` | Paginated `assets` for the user. |
| `GET` | `/api/admin/users/[id]/sessions` | `?page=&pageSize=` | Paginated `sessions` (not soft-deleted). Includes name, created_at, last_modified_at. |
| `POST` | `/api/admin/users/[id]/adjust-tokens` | `{ amount, note }` | Calls `admin_adjust_tokens` with `idempotency_key = crypto.randomUUID()`, `admin_user_id = auth.uid()`, note defaulting to `"Prisfol Gift"`. |
| `POST` | `/api/admin/users/[id]/ban` | `{ duration: '24h'|'7d'|'30d'|'permanent'|'none' }` | `auth.admin.updateUserById(id, { ban_duration })`. `'none'` lifts ban (`'none'` per Supabase API). `'permanent'` = `'876000h'` (100 years). |
| `POST` | `/api/admin/users/[id]/toggle-admin` | — | Flip `profiles.is_admin`. Refuses to touch the caller's own row. |
| `POST` | `/api/admin/users/[id]/reset-password` | — | `auth.admin.generateLink({ type: 'recovery', email })` — Supabase emails the user. |

Every route: `requireAdmin()` first → service-role client for the work. Errors: 4xx with `{ error: string }`.

## Frontend

- **`app/admin/page.tsx`** — replace `UsersComingSoonView` with `<UsersAdminContent />`. Remove `comingSoon: true` from the sidebar item.
- **`components/admin/UsersAdminContent.tsx`** — top stats strip, filters bar (search + status chip + plan select + sort), table, pagination footer, drawer mount.
- **`components/admin/UserDetailDrawer.tsx`** — right-side slide-out drawer. Tabs: Overview | Tokens History | Assets | Sessions. Actions section: Adjust Tokens, Ban/Unban, Toggle Admin, Send Reset Email.
- **`components/admin/AdjustTokensModal.tsx`** — small modal: amount (signed), note (default "Prisfol Gift"), submit.
- **`lib/api/admin-users.ts`** — typed client wrappers mirroring `lib/api/admin.ts`.

Drawer matches existing admin glassmorphism + uppercase-mono aesthetic from `app/admin/page.tsx`.

### Table columns

Email · Plan · Balance · Status (chips: Admin / Banned / Active / Low) · Joined · Last seen · Actions (open drawer).

Sortable: Email, Balance, Joined, Last seen.

### "Prisfol Gift" labeling

`components/billing/PlanBillingView.tsx → humanizeReason` reads `row.metadata.note` for `admin_adjustment` entries. Falls back to `"Prisfol Gift"` if no note (positive) / `"Adjustment"` (negative). Admin UI defaults the note to `"Prisfol Gift"` but allows editing.

## Data flow (grant tokens example)

1. Admin opens drawer for user X → clicks "Adjust Tokens" → enters `+500`, note `"Prisfol Gift"`.
2. Modal POSTs to `/api/admin/users/[X]/adjust-tokens`.
3. Route validates admin, generates UUID idempotency key, calls `admin_adjust_tokens(X, 500, auth.uid(), "Prisfol Gift", uuid)` via service-role client.
4. RPC writes ledger row `reason='admin_adjustment'`, `metadata={admin_user_id, note: "Prisfol Gift"}`, updates `profiles.token_balance`. Realtime push hits the user's open browser (`profiles_realtime` already enabled).
5. Drawer re-fetches ledger + user detail.
6. User's own billing page shows the new row labeled "Prisfol Gift".

## Non-goals (this commit)

- No bulk operations (multi-select). Single-user actions only.
- No editing of email / profile fields. Identity stays with the user.
- No audit log of admin actions beyond what the ledger and `auth.users.banned_until` capture naturally.
- No invitation flow. Sign-up stays self-serve.

## Risks / gotchas

- `auth.admin.listUsers` pagination is page/perPage based and capped at 1000/page — we wrap it and translate to the table's page/pageSize. Filtering/sorting on joined columns (`token_balance`, `plan_id`) is done **after** the page is fetched. Acceptable at current scale; documented as a known limitation.
- `ban_duration: 'permanent'` is not a real Supabase value — we map it to `'876000h'` (≈100 years).
- Service-role client must never be reached from a client component — all new routes are server-only.
- Admin cannot demote themselves via the toggle (route guard); the DB trigger is a backstop, not the only line of defense.
