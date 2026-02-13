import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';

/**
 * GET /api/user/me — Get the current authenticated user
 * 
 * Used by frontend components that previously called supabase.auth.getUser()
 * directly. Returns minimal user info (id, email).
 */
export async function GET() {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user } = auth;

    return NextResponse.json({
        user: {
            id: user.id,
            email: user.email,
            user_metadata: user.user_metadata,
        },
    });
}
