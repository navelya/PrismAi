# Subdomain split: `prisfol.com` (marketing) ↔ `app.prisfol.com` (app)

**Date:** 2026-06-13
**Status:** Approved — ready for implementation plan

## Goal

Serve the public showcase/marketing site from `prisfol.com` and the signed-in
application from `app.prisfol.com`, from a **single Next.js deployment**. The
app subdomain opens the chat experience at its root (`app.prisfol.com/`), so
users no longer need to type `/chat`. Login session is shared across
`*.prisfol.com`.

### Non-goals (YAGNI)

- No file moves — chat stays at `app/chat/*` (served at the app root via an
  internal rewrite).
- No separate deployments / split codebase.
- No per-page canonical `<link>` metadata beyond the 308 redirects.
- No `app.localhost` requirement for local dev — neutral hosts skip the split.

## Domain model

One app, two production hostnames, plus a "neutral" class for everything else:

| Host class | Examples | Behavior |
|-----------|----------|----------|
| **marketing** | `prisfol.com`, `www.prisfol.com` | Public showcase + no-signin pages. App-route paths redirect to the app host. |
| **app** | `app.prisfol.com` | All sign-in-required pages. Root serves chat. Marketing-route paths redirect to the marketing host. |
| **neutral** | `localhost:3000`, `*.vercel.app` previews | No split enforced — behaves exactly like today (`/` = landing, `/chat` = chat). |

## Route classification (single source of truth)

A new module `lib/domains.ts` owns the route lists and host logic. Nothing else
hardcodes hostnames or route prefixes.

- **App route prefixes** (canonical home = app host):
  `/chat`, `/editor`, `/templates`, `/settings`, `/admin`, `/assets`,
  `/library`, `/nodes`, `/login`, `/auth`, `/checkout`, `/billing`, `/share`
  - `/share/<token>` is a **collaboration-invite accept page**, not a public
    showcase: it redirects to `/login?next=/share/<token>` when signed out,
    then accepts the invite and routes into `/chat/<canvasId>`. So it lives on
    the app host. (The invite email's `acceptUrl` already builds
    `${NEXT_PUBLIC_APP_URL}/share/<token>` → resolves to the app host, no
    cross-host redirect.)
- **Marketing route prefixes** (canonical home = marketing host):
  `/` (exact), `/legal`, `/pricing`, `/demo`
- **`/api/*`**: shared — served on both hosts, never redirected. Each origin
  calls its own same-origin API, so no CORS concerns.

### `lib/domains.ts` exports (interface)

```ts
type HostClass = 'app' | 'marketing' | 'neutral';

// Classify the incoming request host.
classifyHost(host: string | null): HostClass

// Is this pathname an app-only / marketing-only route?
isAppRoute(pathname: string): boolean
isMarketingRoute(pathname: string): boolean

// Absolute URL builders. In production return fully-qualified URLs
// (https://app.prisfol.com<path> / https://prisfol.com<path>); on neutral
// hosts (no env configured) return the relative path unchanged so dev works.
appUrl(path: string): string
marketingUrl(path: string): string
```

Host classification reads `NEXT_PUBLIC_APP_URL` and `NEXT_PUBLIC_MARKETING_URL`
hostnames. Any host not matching either is `neutral`.

## Middleware routing

Extend the existing `middleware.ts` (which already resolves the Supabase user
and gates protected routes). After user resolution, branch on host class:

**marketing host (`prisfol.com`):**
- `isAppRoute(path)` → `NextResponse.redirect(appUrl(path), 308)`
- otherwise serve normally (landing, legal, pricing, demo, share).

**app host (`app.prisfol.com`):**
- `isMarketingRoute(path) && path !== '/'` → redirect to `marketingUrl(path)` (308)
- `path === '/'` → `NextResponse.rewrite('/chat')` — chat renders, URL stays `/`
- `path === '/chat'` (exact) → redirect to `/` (canonical root)
- otherwise serve normally; existing auth gate (redirect to `/login` when no
  user) still applies to app routes.

**neutral host:** skip all of the above — return the existing behavior
unchanged.

### Matcher

The current matcher only lists app routes + `/login` + `/api`. It must broaden
to a catch-all so marketing paths are also seen on the app host (to redirect
them off). Use the standard exclude pattern:

```
matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp4)$).*)']
```

The internal auth-gating logic (protected page list, protected API → 401) is
preserved as-is. The post-login default destination changes from `/chat` to
`/` (on the app host `/` is chat; saves one redirect hop). `?next=` handling is
unchanged.

## Shared session across `.prisfol.com`

Supabase `@supabase/ssr` clients accept `cookieOptions: { domain }`. Add it,
sourced from `NEXT_PUBLIC_COOKIE_DOMAIN`, in the three places that set auth
cookies:

- `lib/supabase/server.ts` (`createServerClient`)
- `lib/supabase/client.ts` (`createBrowserClient`)
- `middleware.ts` (`createServerClient`)

When `NEXT_PUBLIC_COOKIE_DOMAIN` is **unset** (dev / preview), omit the option
entirely so cookies stay host-scoped — no behavior change locally. When set to
`.prisfol.com`, a login on `app.prisfol.com` produces a cookie readable on
`prisfol.com`, letting the marketing site reflect logged-in state ("Open app"
vs "Sign in").

## Cross-subdomain navigation

`sessionStorage` and host-scoped state do not survive a cross-origin jump, and
in-app `<Link href="/...">` resolves relative to the current host. So:

- **Hero prompt handoff** (`app/page.tsx` `HeroChatInput`): instead of stashing
  the prompt in `sessionStorage` then `router.push('/chat')`, on a marketing
  host navigate to `appUrl('/?prompt=' + encodeURIComponent(t))`. The chat root
  reads `?prompt=` on mount (in addition to the existing `sessionStorage`
  path, which still serves the neutral/dev case). The query param is cleared
  from the URL after it is consumed.
- **Boundary-crossing links** use the helpers:
  - marketing → app ("Sign in", "Get started", "Open app", any dashboard/chat
    CTA on the landing page) → `appUrl(path)`
  - app → marketing (pricing / legal / terms links in footers, settings,
    login page) → `marketingUrl(path)`
  - same-host internal links stay relative (no change).

An audit of the ~23 files referencing `/chat` plus the marketing pages will
identify which links cross the boundary; only those switch to the helpers.

## Environment variables

Added to `.env.local` and documented in `CLAUDE.md`:

- `NEXT_PUBLIC_MARKETING_URL` = `https://prisfol.com` (new)
- `NEXT_PUBLIC_APP_URL` = `https://app.prisfol.com` — **existing** var. Set it
  to the app subdomain. See the webhook note below.
- `NEXT_PUBLIC_COOKIE_DOMAIN` = `.prisfol.com` (new)

Production DNS / Vercel: both `prisfol.com` (+ `www`) and `app.prisfol.com`
point at the same Vercel project.

### Webhook / provider impact of `NEXT_PUBLIC_APP_URL`

Audited the providers — pointing this var at `https://app.prisfol.com` is safe
and requires no external/dashboard changes:

- **Replicate is the only provider that uses webhooks.** The webhook URL
  (`${NEXT_PUBLIC_APP_URL}/api/webhooks/replicate-v2`) is built per-prediction
  at submit time in [dispatch-v2.ts](../../../lib/workflow/dispatch-v2.ts) and
  [ai_generator/executor.server.ts](../../../lib/nodes/plugins/ai_generator/executor.server.ts)
  — it is **not** a Replicate dashboard setting, so it simply follows the env
  var. `/api/webhooks/*` is a public API route and `/api/*` is served on both
  hosts without redirect, so the callback lands fine on the app host.
- **FAL / KIE / Kinovi / WaveSpeed use no webhooks** — poll-as-truth + the
  cron sweep. They read `NEXT_PUBLIC_APP_URL` only to detect localhost-vs-prod,
  never to build a callback URL. No impact.
- The collaboration invite email's `acceptUrl` (`${NEXT_PUBLIC_APP_URL}/share/<token>`)
  resolves to the app host — correct, since `/share` is an app route.

## Files touched

- `lib/domains.ts` — **new**: host classification, route lists, URL helpers.
- `middleware.ts` — host-based redirect/rewrite, broadened matcher, cookie
  domain, post-login dest `/`.
- `lib/supabase/server.ts`, `lib/supabase/client.ts` — `cookieOptions.domain`.
- `app/page.tsx` — hero prompt cross-origin handoff + marketing→app CTA links.
- Chat root (`app/chat/page.tsx` or its client interface) — read `?prompt=`.
- Boundary-crossing links surfaced by the audit (footers / settings / login /
  landing CTAs).
- `CLAUDE.md` — env var documentation.

## Testing / verification

No automated test runner in this repo. Verify with `npx tsc --noEmit` (the
project's reliable check) plus manual E2E:

1. **Neutral (localhost):** `/` = landing, `/chat` = chat, `/chat/<id>` opens a
   session — unchanged from today.
2. **Marketing host:** `/`, `/pricing`, `/legal/privacy` serve; `/chat`,
   `/settings` redirect to `app.prisfol.com`.
3. **App host:** `/` renders chat (URL stays `/`); `/chat` redirects to `/`;
   `/chat/<id>` opens a session; `/pricing` redirects to `prisfol.com/pricing`;
   unauthenticated `/settings` → `/login`.
4. **Shared session:** log in on `app.prisfol.com`, confirm `prisfol.com` sees
   the session; log out clears both.
5. **Hero handoff:** type a prompt on `prisfol.com`, hit send, land on
   `app.prisfol.com/` with the prompt auto-submitted.

## Risks & mitigations

- **Redirect loop** if classification is wrong → unit-reason the branches:
  neutral never redirects; each host only redirects the *other* class's routes;
  `/` is special-cased before the generic marketing check on the app host.
- **`/api` accidentally redirected** → `/api/*` is explicitly excluded from both
  app- and marketing-route lists.
- **Cookie domain breaks local login** → the domain option is only applied when
  `NEXT_PUBLIC_COOKIE_DOMAIN` is set; dev leaves it unset.
- **Lost hero prompt across origins** → carried via `?prompt=` query param, not
  `sessionStorage`.
