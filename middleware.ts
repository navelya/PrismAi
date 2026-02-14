import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
    const path = request.nextUrl.pathname;

    // Define protected page routes
    const protectedPageRoutes = ['/chat', '/editor', '/library', '/settings'];
    const isProtectedPage = protectedPageRoutes.some(route => path.startsWith(route));

    // Define protected API routes (all /api/* except public ones)
    const publicApiRoutes = ['/api/auth', '/api/image/generate'];
    const isApiRoute = path.startsWith('/api/');
    const isPublicApi = publicApiRoutes.some(route => path.startsWith(route));
    const isProtectedApi = isApiRoute && !isPublicApi;

    // Check for auth cookie
    const authCookie = request.cookies.get('supabase-auth-token');

    // Protect pages — redirect to login
    if (isProtectedPage && !authCookie) {
        const loginUrl = new URL('/login', request.url);
        return NextResponse.redirect(loginUrl);
    }

    // Protect API routes — return 401 JSON
    if (isProtectedApi && !authCookie) {
        return NextResponse.json(
            { error: 'Authentication required' },
            { status: 401 }
        );
    }

    // If logged in and at login page, redirect to chat
    if (path === '/login' && authCookie) {
        return NextResponse.redirect(new URL('/chat', request.url));
    }

    return NextResponse.next();
}

export const config = {
    matcher: [
        '/chat/:path*',
        '/editor/:path*',
        '/library/:path*',
        '/settings/:path*',
        '/login',
        '/api/:path*',
    ],
};
