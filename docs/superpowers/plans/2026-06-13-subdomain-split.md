# Subdomain Split (`prisfol.com` ↔ `app.prisfol.com`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the public marketing site from `prisfol.com` and the signed-in app from `app.prisfol.com` (app root opens chat), from a single Next.js deployment, with a session shared across `*.prisfol.com`.

**Architecture:** A new pure module `lib/domains.ts` is the single source of truth for host classification, route lists, and absolute-URL builders. `middleware.ts` reads the `Host` header, classifies it (`app` / `marketing` / `neutral`), and redirects cross-host paths to their canonical subdomain while internally rewriting the app root to `/chat`. On neutral hosts (localhost / Vercel previews) the split is disabled and the app behaves exactly like today. The Supabase auth cookie is widened to `.prisfol.com` via `cookieOptions.domain`. Boundary-crossing links in the landing page, login page, and footers switch to the `appUrl()` / `marketingUrl()` helpers.

**Tech Stack:** Next.js App Router, `@supabase/ssr`, TypeScript. **No test runner in this repo** — every task verifies with `npx tsc --noEmit` (the project's reliable check, per CLAUDE.md / verification-commands memory) plus a concrete manual check. Final task is a full in-app E2E checklist.

**Spec:** `docs/superpowers/specs/2026-06-13-subdomain-split-design.md`

---

## File structure

- **Create** `lib/domains.ts` — host classification, route lists, `appUrl()` / `marketingUrl()`, `COOKIE_DOMAIN`. Pure, no Next imports, importable from server, client, and edge (middleware).
- **Modify** `middleware.ts` — host-based redirect/rewrite, broadened matcher, cookie domain, post-login dest `/`.
- **Modify** `lib/supabase/server.ts`, `lib/supabase/client.ts` — `cookieOptions.domain`.
- **Modify** `components/chat/ChatInterface.tsx` — read `?prompt=` in addition to `sessionStorage`.
- **Modify** `app/page.tsx` — hero prompt cross-origin handoff, `createNewSession` guard, marketing→app CTA links.
- **Modify** `app/login/page.tsx`, `app/auth/callback/route.ts` — default dest `/`, "Back to Home" → marketing host.
- **Modify** boundary-crossing links surfaced by audit (sidebar / settings / any app→marketing footer).
- **Modify** `.env.local.example`, `CLAUDE.md` — env var docs + operator checklist.

---

### Task 1: Create `lib/domains.ts` (host model)

**Files:**
- Create: `lib/domains.ts`

- [ ] **Step 1: Write the module**

```ts
// lib/domains.ts
/**
 * Subdomain split: prisfol.com (marketing) vs app.prisfol.com (app).
 * Single source of truth for host classification, route lists, and absolute
 * URL builders.
 *
 * Safe on localhost / Vercel previews: when the prod hosts are not configured
 * (or don't match the request host) everything is classified 'neutral' and no
 * redirect/rewrite is applied — the app behaves exactly like today. All values
 * derive from NEXT_PUBLIC_* envs, which Next inlines at build for server,
 * client, AND edge (middleware) bundles.
 */

export type HostClass = 'app' | 'marketing' | 'neutral';

function hostnameOf(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.toLowerCase();
  } catch {
    return '';
  }
}

const APP_HOST = hostnameOf(process.env.NEXT_PUBLIC_APP_URL);
const MARKETING_HOST = hostnameOf(process.env.NEXT_PUBLIC_MARKETING_URL);

// App-only route prefixes (canonical home = app host). '/share' is the
// collaboration-invite accept page (gates on login, routes into the canvas).
const APP_ROUTE_PREFIXES = [
  '/chat', '/editor', '/templates', '/settings', '/admin',
  '/assets', '/library', '/nodes', '/login', '/auth', '/checkout',
  '/billing', '/share',
];

// Marketing-only route prefixes (canonical home = marketing host). '/' is
// handled by exact match in isMarketingRoute so it doesn't swallow every path.
const MARKETING_ROUTE_PREFIXES = ['/legal', '/pricing', '/demo'];

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + '/');
}

export function classifyHost(host: string | null | undefined): HostClass {
  if (!host) return 'neutral';
  const h = host.split(':')[0].toLowerCase(); // strip :port
  if (APP_HOST && h === APP_HOST) return 'app';
  if (MARKETING_HOST && (h === MARKETING_HOST || h === `www.${MARKETING_HOST}`)) return 'marketing';
  return 'neutral';
}

export function isAppRoute(pathname: string): boolean {
  return APP_ROUTE_PREFIXES.some((p) => matchesPrefix(pathname, p));
}

export function isMarketingRoute(pathname: string): boolean {
  if (pathname === '/') return true;
  return MARKETING_ROUTE_PREFIXES.some((p) => matchesPrefix(pathname, p));
}

// Absolute URL builders. In prod (env set) return fully-qualified URLs so a
// <Link>/navigation crosses to the right subdomain. On neutral/dev (env unset)
// return the path unchanged so client-side nav stays same-origin.
export function appUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL;
  if (!base) return path;
  return `${base.replace(/\/$/, '')}${path}`;
}

export function marketingUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_MARKETING_URL;
  if (!base) return path;
  return `${base.replace(/\/$/, '')}${path}`;
}

// Auth cookie domain. undefined on dev/preview → cookies stay host-scoped.
export const COOKIE_DOMAIN = process.env.NEXT_PUBLIC_COOKIE_DOMAIN || undefined;
```

- [ ] **Step 2: Verify it type-checks**

Run: `npx tsc --noEmit`
Expected: no errors referencing `lib/domains.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/domains.ts
git commit -m "feat(domains): host classification + url helpers for subdomain split"
```

---

### Task 2: Share the auth cookie across `.prisfol.com`

**Files:**
- Modify: `lib/supabase/server.ts`
- Modify: `lib/supabase/client.ts`

The `@supabase/ssr` factories accept `cookieOptions: { domain }`. Apply `COOKIE_DOMAIN` only when set, so dev/preview stay host-scoped.

- [ ] **Step 1: Server client — add cookie domain**

In `lib/supabase/server.ts`, add the import and pass `cookieOptions`:

```ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { COOKIE_DOMAIN } from '@/lib/domains';

export const createClient = () => {
    const cookieStore = cookies();

    return createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            ...(COOKIE_DOMAIN ? { cookieOptions: { domain: COOKIE_DOMAIN } } : {}),
            cookies: {
                getAll() {
                    return cookieStore.getAll();
                },
                setAll(cookiesToSet) {
                    try {
                        cookiesToSet.forEach(({ name, value, options }) => {
                            cookieStore.set(name, value, options);
                        });
                    } catch (error) {
                        // The `setAll` method was called from a Server Component.
                        // This can be ignored if you have middleware refreshing
                        // user sessions.
                    }
                },
            },
        }
    );
};
```

- [ ] **Step 2: Browser client — add cookie domain**

In `lib/supabase/client.ts`:

```ts
import { createBrowserClient } from '@supabase/ssr';
import { COOKIE_DOMAIN } from '@/lib/domains';

let browserClient: ReturnType<typeof createBrowserClient> | undefined;

export const createClient = () => {
    if (browserClient) return browserClient;

    browserClient = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        COOKIE_DOMAIN ? { cookieOptions: { domain: COOKIE_DOMAIN } } : undefined
    );

    return browserClient;
};
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add lib/supabase/server.ts lib/supabase/client.ts
git commit -m "feat(auth): widen supabase cookie to .prisfol.com when configured"
```

---

### Task 3: Middleware host routing

**Files:**
- Modify: `middleware.ts`

Add the cookie domain to the middleware's own `createServerClient`, branch on host class, and broaden the matcher. The existing auth gate / API-401 / login-when-authed logic is preserved (with the post-login default changed `/chat` → `/`).

- [ ] **Step 1: Add imports**

At the top of `middleware.ts`, after the existing imports:

```ts
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { classifyHost, isAppRoute, isMarketingRoute, appUrl, marketingUrl, COOKIE_DOMAIN } from '@/lib/domains';
```

- [ ] **Step 2: Pass cookie domain to the middleware client**

In the `createServerClient(...)` options object (currently just `{ cookies: {...} }`), spread the cookie domain first:

```ts
    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            ...(COOKIE_DOMAIN ? { cookieOptions: { domain: COOKIE_DOMAIN } } : {}),
            cookies: {
                getAll() {
                    return request.cookies.getAll();
                },
                setAll(cookiesToSet) {
                    cookiesToSet.forEach(({ name, value, options }) => request.cookies.set(name, value));
                    supabaseResponse = NextResponse.next({
                        request,
                    });
                    cookiesToSet.forEach(({ name, value, options }) =>
                        supabaseResponse.cookies.set(name, value, options)
                    );
                },
            },
        }
    );
```

- [ ] **Step 3: Insert host-based routing**

Immediately after the existing `const path = request.nextUrl.pathname;` line, insert the host branch (before the `protectedPageRoutes` block):

```ts
    const path = request.nextUrl.pathname;
    const search = request.nextUrl.search;
    const hostClass = classifyHost(request.headers.get('host'));

    // ── Marketing host (prisfol.com): app-route paths bounce to the app host ──
    if (hostClass === 'marketing') {
        if (isAppRoute(path)) {
            return NextResponse.redirect(appUrl(path + search), 308);
        }
        // Marketing pages (/, /legal, /pricing, /demo) serve normally.
        return supabaseResponse;
    }

    // ── App host (app.prisfol.com) ────────────────────────────────────────────
    if (hostClass === 'app') {
        // Marketing-route paths (except root) bounce to the marketing host.
        if (path !== '/' && isMarketingRoute(path)) {
            return NextResponse.redirect(marketingUrl(path + search), 308);
        }
        // Canonical root: /chat (exact) → /
        if (path === '/chat') {
            return NextResponse.redirect(new URL('/' + search, request.url), 308);
        }
        // Root serves chat. Gate it (chat is auth-only) then internally rewrite.
        if (path === '/') {
            if (!user) {
                return NextResponse.redirect(new URL('/login', request.url));
            }
            const rw = request.nextUrl.clone();
            rw.pathname = '/chat';
            return NextResponse.rewrite(rw);
        }
        // Other app routes fall through to the existing auth gate below.
    }

    // Neutral host (localhost / preview): fall through — behaves like today.
```

- [ ] **Step 4: Change the post-login default destination**

In the existing login-when-authed block, change the fallback from `/chat` to `/`:

```ts
    // If logged in and at login page, redirect to app root (honour ?next= if safe)
    if (path === '/login' && user) {
        const next = request.nextUrl.searchParams.get('next');
        const dest = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
        return NextResponse.redirect(new URL(dest, request.url));
    }
```

- [ ] **Step 5: Broaden the matcher**

Replace the entire `export const config = {...}` block with a catch-all that excludes static assets (so marketing paths are seen on the app host):

```ts
export const config = {
    matcher: [
        // Run on everything except Next internals and static asset files.
        '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp4|woff2?)$).*)',
    ],
};
```

- [ ] **Step 6: Verify type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Manual middleware check (local, two hosts)**

`app.localhost` resolves to 127.0.0.1 in Chrome/Edge, so the split can be exercised locally. Temporarily set in `.env.local`:

```
NEXT_PUBLIC_MARKETING_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://app.localhost:3000
```

Run `npm run dev`, then in the browser verify:
- `http://localhost:3000/` → landing page renders.
- `http://localhost:3000/settings` → redirects to `http://app.localhost:3000/settings`.
- `http://app.localhost:3000/` → chat (URL stays `/`); if logged out → `/login`.
- `http://app.localhost:3000/chat` → redirects to `http://app.localhost:3000/`.
- `http://app.localhost:3000/pricing` → redirects to `http://localhost:3000/pricing`.

(Leave `NEXT_PUBLIC_COOKIE_DOMAIN` UNSET for this local check — `.localhost` cookie domains are rejected by browsers. Revert the two env values afterward, or keep them if continuing local E2E.)

- [ ] **Step 8: Commit**

```bash
git add middleware.ts
git commit -m "feat(middleware): host-based subdomain routing + shared cookie"
```

---

### Task 4: Carry the hero prompt across origins via `?prompt=`

**Files:**
- Modify: `components/chat/ChatInterface.tsx:212-221`

The landing composer (Task 5) will pass the prompt as `?prompt=` when crossing to the app subdomain (`sessionStorage` is per-origin and won't survive). Extend the existing pending-prompt effect to read the query param too, and strip it from the URL after consuming.

- [ ] **Step 1: Update the pending-prompt effect**

Replace the effect body at `components/chat/ChatInterface.tsx:212-221` (the `useEffect` that reads `prismai:pendingPrompt`) with:

```tsx
    useEffect(() => {
        let pending: string | null = null;
        // Cross-origin handoff from the marketing site arrives as ?prompt=.
        try {
            const qp = new URLSearchParams(window.location.search).get('prompt');
            if (qp) pending = qp;
        } catch { /* SSR / no window */ }
        // Same-origin (dev) handoff uses sessionStorage.
        if (!pending) {
            try { pending = sessionStorage.getItem('prismai:pendingPrompt'); } catch { /* storage blocked */ }
        }
        const text = pending?.trim();
        if (!text) return;
        const raf = requestAnimationFrame(() => {
            try { sessionStorage.removeItem('prismai:pendingPrompt'); } catch { /* storage blocked */ }
            // Strip ?prompt= so a refresh doesn't resubmit.
            try {
                const url = new URL(window.location.href);
                if (url.searchParams.has('prompt')) {
                    url.searchParams.delete('prompt');
                    window.history.replaceState({}, '', url.pathname + url.search);
                }
            } catch { /* no window */ }
            sendMessage(text, [], [], () => {}, setInput);
        });
        return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
```

> Note: keep the existing dependency array exactly as it was in the original effect (the original runs once on mount). If the original had a non-empty deps array, preserve it rather than the `[]` shown here.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual check (dev, same origin still works)**

With dev server running at `http://localhost:3000`, open `http://localhost:3000/chat?prompt=hello%20world` while logged in → the chat auto-submits "hello world" and the URL drops `?prompt=`.

- [ ] **Step 4: Commit**

```bash
git add components/chat/ChatInterface.tsx
git commit -m "feat(chat): accept hero prompt via ?prompt= (cross-origin handoff)"
```

---

### Task 5: Landing page — cross-origin CTAs + hero handoff

**Files:**
- Modify: `app/page.tsx`

All landing links that target **app** routes (`/chat`, `/templates`) and the hero composer must point at the app host when running on the marketing host. Marketing-internal links (`/pricing`, `/legal/*`, `#anchors`) stay relative.

- [ ] **Step 1: Import the helper**

At the top of `app/page.tsx`, add to the existing imports:

```tsx
import { appUrl } from '@/lib/domains';
```

- [ ] **Step 2: Hero composer — cross-origin submit**

In `HeroChatInput`, replace the `submit` function body (the part that stashes to `sessionStorage` and `router.push('/chat')`, around lines 151-165) with:

```tsx
    const submit = (text?: string) => {
        const t = (text ?? value).trim();
        if (!t || leaving) {
            if (!t) textareaRef.current?.focus();
            return;
        }
        setLeaving(true);
        const dest = appUrl(`/?prompt=${encodeURIComponent(t)}`);
        if (dest.startsWith('http')) {
            // Cross-origin to the app subdomain (prod): sessionStorage won't
            // survive, so carry the prompt in the URL.
            window.location.href = dest;
            return;
        }
        // Same-origin dev/neutral: keep the sessionStorage + SPA push path.
        try {
            sessionStorage.setItem('prismai:pendingPrompt', t);
        } catch {
            // Private-mode / blocked storage: fall through and let the user type
            // again on the chat page rather than hard-failing.
        }
        router.push('/chat');
    };
```

- [ ] **Step 3: "Start from a blank canvas" — guard cross-origin**

`createNewSession` calls an authed API; on the marketing host an anonymous visitor can't use it. Change the secondary button's `onClick` (around line 1640) to redirect to the app host when cross-origin:

```tsx
                        <button
                            onClick={() => {
                                const dest = appUrl('/');
                                if (dest.startsWith('http')) { window.location.href = dest; return; }
                                createNewSession();
                            }}
                            disabled={isLoading}
                            className="group inline-flex items-center gap-2 text-[8px] md:text-[9px] font-black uppercase tracking-[0.4em] text-slate-400 hover:text-slate-900 transition-colors"
                        >
```

- [ ] **Step 4: Nav Sign In / Get Started**

Replace the two nav links (lines ~1607-1613):

```tsx
                            <Link href={appUrl('/login')} className="hidden md:inline text-[7px] font-black uppercase tracking-[0.4em] text-slate-500 hover:text-slate-900 transition-colors">Sign In</Link>
                            <Link
                                href={appUrl('/')}
                                className="px-4 py-2 rounded-xl bg-slate-900 text-white text-[7px] font-black uppercase tracking-[0.4em] hover:bg-accent-primary hover:text-slate-900 transition-all"
                            >
                                Get Started
                            </Link>
```

- [ ] **Step 5: `/templates` links → app host**

There are four `<Link href="/templates">` usages (TemplateCarousel "Browse all templates" ~line 1233, gallery "Explore templates" ~line 1832, final-CTA "Browse templates" ~line 1875, and the footer "Engine → Templates" ~line 1915). Change each `href="/templates"` to `href={appUrl('/templates')}`.

- [ ] **Step 6: "START BUILDING" MagneticButton → app host**

Around line 1868, change:

```tsx
                                    <MagneticButton href={appUrl('/')}>
```

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Manual check**

With dev server (neutral host), confirm `appUrl(...)` returns relative paths so the landing nav/CTAs still SPA-navigate (Sign In → `/login`, Get Started → `/chat` funnel, templates → `/templates`) and the hero composer still sends a prompt into `/chat`. (Cross-origin behavior is validated in the Task 9 E2E with the two-host env.)

- [ ] **Step 9: Commit**

```bash
git add app/page.tsx
git commit -m "feat(landing): route app CTAs + hero prompt to the app subdomain"
```

---

### Task 6: Login + auth callback default destination & home links

**Files:**
- Modify: `app/login/page.tsx`
- Modify: `app/auth/callback/route.ts`

- [ ] **Step 1: Login default dest `/`**

In `app/login/page.tsx:57`, change:

```tsx
    const nextPath = searchParams.get('next') || '/';
```

- [ ] **Step 2: "Back to Home" → marketing host**

`app/login/page.tsx` has two `<Link href="/">` (the logo ~line 160 and "Back to Home" ~line 322). Import the helper and point them at the marketing site:

Add to imports:

```tsx
import { marketingUrl } from '@/lib/domains';
```

Change both occurrences `href="/"` on those two links to `href={marketingUrl('/')}`. (Leave any other `/`-relative usage untouched — only the two brand/home links.)

- [ ] **Step 3: Auth callback default landing**

In `app/auth/callback/route.ts:7`, change the default from `/chat` to `/` (the `?next=` honoring and `${origin}${next}` redirect stay as-is; `origin` is the app host, so `/` resolves to chat):

```ts
    const next = searchParams.get('next') ?? '/';
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual check (dev)**

Log in at `http://localhost:3000/login` → lands on `/` (neutral host: the landing page; this is expected on neutral, where `/` is not chat). The app-host behavior (`/` = chat) is covered in Task 9. Confirm "Back to Home" navigates to `/` (relative on neutral).

- [ ] **Step 6: Commit**

```bash
git add app/login/page.tsx app/auth/callback/route.ts
git commit -m "feat(auth): default post-login to app root; home links to marketing host"
```

---

### Task 7: App→marketing link audit

**Files:**
- Modify: any in-app component linking to `/pricing`, `/legal/*`, or `/demo` (surfaced by grep)

In-app surfaces (sidebar, settings, account modal, billing screens) may link to marketing pages. On the app host those must cross to the marketing host.

- [ ] **Step 1: Find the boundary-crossing links**

Run (Grep tool or):

```bash
git grep -nE "href=[\"'`]/(pricing|legal|demo)" -- 'components/**' 'app/**' ':!app/page.tsx' ':!app/login/page.tsx'
```

Also check `router.push`/`router.replace` to those paths:

```bash
git grep -nE "(push|replace)\(\s*[\"'`]/(pricing|legal|demo)" -- 'components/**' 'app/**'
```

- [ ] **Step 2: Convert each hit**

For each result, import `marketingUrl` from `@/lib/domains` and wrap the path: `href="/pricing"` → `href={marketingUrl('/pricing')}`; `router.push('/pricing')` → `router.push(marketingUrl('/pricing'))`. Leave same-host app links (e.g. `/settings`, `/templates`, `/chat`) untouched — they stay relative.

> If the grep returns no results, this task is a no-op beyond the audit — record that and move on. Do NOT invent edits.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit (only if changes were made)**

```bash
git add -A
git commit -m "feat(app): route in-app marketing links to the marketing host"
```

---

### Task 8: Env vars + docs + operator checklist

**Files:**
- Modify: `.env.local.example`
- Modify: `CLAUDE.md`

- [ ] **Step 1: `.env.local.example`**

Replace the `# App Configuration` block (line 12-13) with:

```
# App Configuration — subdomain split
# In production: app + marketing on the SAME Vercel project, different hosts.
# Leave the *_URL values pointing at localhost in dev so the split is disabled
# (neutral host). To test the split locally, set MARKETING_URL=http://localhost:3000
# and APP_URL=http://app.localhost:3000 (app.localhost resolves to 127.0.0.1).
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_MARKETING_URL=http://localhost:3000
# Auth cookie domain — set ONLY in production to share the session across
# subdomains. Must start with a dot. Leave UNSET locally (browsers reject
# .localhost cookie domains).
# NEXT_PUBLIC_COOKIE_DOMAIN=.prisfol.com
```

- [ ] **Step 2: `CLAUDE.md` env documentation**

In the "Required env" paragraph of `CLAUDE.md`, after the `NEXT_PUBLIC_APP_URL` mention, add:

```
`NEXT_PUBLIC_APP_URL` is also the app subdomain base for the marketing/app split (`https://app.prisfol.com` in prod) and the Replicate webhook base. `NEXT_PUBLIC_MARKETING_URL` (`https://prisfol.com`) is the marketing-site base. `NEXT_PUBLIC_COOKIE_DOMAIN` (`.prisfol.com`, prod only) widens the Supabase auth cookie so the session is shared across subdomains. Host classification + the `appUrl()`/`marketingUrl()` helpers live in [lib/domains.ts](lib/domains.ts); the split is enforced in [middleware.ts](middleware.ts) and disabled on neutral hosts (localhost / previews).
```

- [ ] **Step 3: Add a "Things that bite" note in `CLAUDE.md`**

Append to the "Things that bite" list:

```
- **Subdomain split is Host-header driven** ([middleware.ts](middleware.ts) + [lib/domains.ts](lib/domains.ts)). `prisfol.com` = marketing, `app.prisfol.com` = app (root rewrites to `/chat`). Cross-host links MUST use `appUrl()`/`marketingUrl()`, never bare relative paths, or they break on the wrong subdomain. `/api/*` is served on both hosts and never redirected. New auth-only pages must be added to `APP_ROUTE_PREFIXES`; new public pages to `MARKETING_ROUTE_PREFIXES`.
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Expected: no errors (docs-only, but confirm nothing else regressed).

- [ ] **Step 5: Commit**

```bash
git add .env.local.example CLAUDE.md
git commit -m "docs: env vars + operator notes for subdomain split"
```

---

### Task 9: Full verification + operator handoff

**Files:** none (verification only)

- [ ] **Step 1: Type-check + production build**

Run: `npx tsc --noEmit`
Expected: clean.

Run: `npm run build`
Expected: build succeeds (note: per CLAUDE.md the build/lint can be flaky here — `tsc` is the authoritative gate; if `build` fails for unrelated reasons, record the output).

- [ ] **Step 2: Local two-host E2E**

Set in `.env.local`:
```
NEXT_PUBLIC_MARKETING_URL=http://localhost:3000
NEXT_PUBLIC_APP_URL=http://app.localhost:3000
```
(`NEXT_PUBLIC_COOKIE_DOMAIN` stays unset.) Run `npm run dev` and verify:

1. `localhost:3000/` → landing renders; nav "Sign In" → `app.localhost:3000/login`; "Get Started" → `app.localhost:3000/`.
2. `localhost:3000/settings` → 308 to `app.localhost:3000/settings`.
3. `localhost:3000/pricing`, `/legal/privacy`, `/demo` → serve on marketing.
4. `app.localhost:3000/` (logged out) → `/login`; (logged in) → chat at `/`.
5. `app.localhost:3000/chat` → 308 to `app.localhost:3000/`.
6. `app.localhost:3000/chat/<existing-session-id>` → opens that session.
7. `app.localhost:3000/pricing` → 308 to `localhost:3000/pricing`.
8. Hero handoff: type a prompt on `localhost:3000`, send → land on `app.localhost:3000/?prompt=...` → chat auto-submits → `?prompt=` stripped.
9. Login at `app.localhost:3000/login` → lands at `/` (chat).

Revert the two env values to `http://localhost:3000` when done (or document leaving them for ongoing testing).

- [ ] **Step 3: Record results + operator checklist**

In the PR / handoff note, capture the E2E outcome and the **production operator steps** (cannot be done from code):
- DNS: point `app.prisfol.com` (and `www.prisfol.com` → marketing) at the same Vercel project; add both domains in Vercel.
- Vercel env (Production): `NEXT_PUBLIC_APP_URL=https://app.prisfol.com`, `NEXT_PUBLIC_MARKETING_URL=https://prisfol.com`, `NEXT_PUBLIC_COOKIE_DOMAIN=.prisfol.com`.
- Supabase Auth → URL Configuration: add `https://app.prisfol.com/auth/callback` (and any `/share` deep links) to the redirect allow-list; set Site URL to `https://app.prisfol.com`.
- Confirm Replicate webhooks still land (they follow `NEXT_PUBLIC_APP_URL` → `app.prisfol.com/api/webhooks/replicate-v2`, a public, non-redirected route — no dashboard change needed).

- [ ] **Step 4: Final commit (if any doc/handoff file added)**

```bash
git add -A
git commit -m "chore: subdomain split verification notes"
```

---

## Self-review notes

- **Spec coverage:** route classification (Task 1), middleware redirect/rewrite + matcher + post-login dest (Task 3), shared cookie (Tasks 2-3), hero `?prompt=` handoff (Tasks 4-5), boundary links (Tasks 5-7), env/docs (Task 8), verification incl. webhook confirmation (Task 9). `/share` correctly in `APP_ROUTE_PREFIXES`.
- **Type consistency:** helper names `classifyHost`, `isAppRoute`, `isMarketingRoute`, `appUrl`, `marketingUrl`, `COOKIE_DOMAIN` are identical across Tasks 1-8.
- **No invented APIs:** `cookieOptions.domain` is a real `@supabase/ssr` option; `NextResponse.redirect(url, 308)` / `.rewrite(clonedUrl)` are real Next APIs.
