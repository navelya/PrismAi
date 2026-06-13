import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { classifyHost, isAppRoute, isMarketingRoute, appUrl, marketingUrl, COOKIE_DOMAIN } from '@/lib/domains';

export async function middleware(request: NextRequest) {
    const path = request.nextUrl.pathname;
    const search = request.nextUrl.search;
    const hostClass = classifyHost(request.headers.get('host'));

    // ── Marketing host (prisfol.com): no session work needed. Handle before
    // touching Supabase so marketing/crawler traffic skips the auth call. ──
    if (hostClass === 'marketing') {
        if (isAppRoute(path)) {
            return NextResponse.redirect(appUrl(path + search), { status: 308 });
        }
        return NextResponse.next({ request });
    }

    // ── App + neutral hosts: refresh the Supabase session as before. ──
    let supabaseResponse = NextResponse.next({
        request,
    });

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

    // IMPORTANT: Avoid writing any logic between createServerClient and
    // supabase.auth.getUser(). A simple mistake could make it very hard to debug
    // issues with cross-browser quirks, CORS, and native next.js routing.
    const {
        data: { user },
    } = await supabase.auth.getUser();

    // ── App host (app.prisfol.com) routing ──
    if (hostClass === 'app') {
        // Marketing-route paths (except root) bounce to the marketing host.
        if (path !== '/' && isMarketingRoute(path)) {
            return NextResponse.redirect(marketingUrl(path + search), { status: 308 });
        }
        // Canonical root: /chat (exact) → /
        if (path === '/chat') {
            return NextResponse.redirect(new URL('/' + search, request.url), { status: 308 });
        }
        // Root serves chat. Gate it (chat is auth-only) then internally rewrite,
        // copying any refreshed-session cookies onto the rewrite response so the
        // browser still receives Supabase's Set-Cookie updates.
        if (path === '/') {
            if (!user) {
                return NextResponse.redirect(new URL('/login', request.url));
            }
            const rw = request.nextUrl.clone();
            rw.pathname = '/chat';
            const rwRes = NextResponse.rewrite(rw);
            supabaseResponse.cookies.getAll().forEach((cookie) => {
                rwRes.cookies.set(cookie.name, cookie.value, cookie);
            });
            return rwRes;
        }
        // Other app routes fall through to the existing auth gate below.
    }

    // Neutral host (localhost / preview): falls through — behaves like today.

    // Define protected page routes
    const protectedPageRoutes = ['/chat', '/editor', '/templates', '/settings', '/admin'];
    const isProtectedPage = protectedPageRoutes.some(route => path.startsWith(route));

    // Define protected API routes (all /api/* except public ones)
    const publicApiRoutes = ['/api/auth', '/api/image/generate', '/api/webhooks'];
    const isApiRoute = path.startsWith('/api/');
    const isPublicApi = publicApiRoutes.some(route => path.startsWith(route));
    const isProtectedApi = isApiRoute && !isPublicApi;

    // Protect pages — redirect to login
    if (isProtectedPage && !user) {
        const loginUrl = new URL('/login', request.url);
        return NextResponse.redirect(loginUrl);
    }

    // Protect API routes — return 401 JSON
    if (isProtectedApi && !user) {
        return NextResponse.json(
            { error: 'Authentication required' },
            { status: 401 }
        );
    }

    // If logged in and at login page, redirect to the right home (honour ?next= if safe).
    // On the app host '/' is chat; on neutral/dev hosts '/' is the marketing page,
    // so default to '/chat' there.
    if (path === '/login' && user) {
        const next = request.nextUrl.searchParams.get('next');
        const fallback = hostClass === 'app' ? '/' : '/chat';
        const dest = next && next.startsWith('/') && !next.startsWith('//') ? next : fallback;
        return NextResponse.redirect(new URL(dest, request.url));
    }

    return supabaseResponse;
}

export const config = {
    matcher: [
        // Run on everything except Next internals and static asset files.
        '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|mp4|woff2?)$).*)',
    ],
};
