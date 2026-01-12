import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
    const path = request.nextUrl.pathname;

    // Define protected routes
    const protectedRoutes = ['/chat', '/editor', '/library', '/settings'];
    const isProtectedRoute = protectedRoutes.some(route => path.startsWith(route));

    // Check for auth cookie
    // We use the same name defined in our callback and storage adapter
    const authCookie = request.cookies.get('supabase-auth-token');

    if (isProtectedRoute && !authCookie) {
        // Redirect to login if accessing protected route without session
        const loginUrl = new URL('/login', request.url);
        // loginUrl.searchParams.set('from', path); // Optional: remember where they came from
        return NextResponse.redirect(loginUrl);
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
    ],
};
