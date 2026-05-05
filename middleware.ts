import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
    let supabaseResponse = NextResponse.next({
        request,
    });

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
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

    const path = request.nextUrl.pathname;

    // Define protected page routes
    const protectedPageRoutes = ['/chat', '/editor', '/library', '/settings', '/admin'];
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

    // If logged in and at login page, redirect to chat
    if (path === '/login' && user) {
        return NextResponse.redirect(new URL('/chat', request.url));
    }

    return supabaseResponse;
}

export const config = {
    matcher: [
        '/chat/:path*',
        '/editor/:path*',
        '/library/:path*',
        '/settings/:path*',
        '/admin/:path*',
        '/login',
        '/api/:path*',
    ],
};
