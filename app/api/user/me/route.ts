import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';
import { createClient } from '@/lib/supabase/server';

/**
 * GET /api/user/me — Get the current authenticated user
 * 
 * Used by frontend components that previously called supabase.auth.getUser()
 * directly. Returns user info plus custom profile data.
 */
export async function GET() {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user } = auth;

    const supabase = await createClient();

    // Fetch profile data
    const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

    return NextResponse.json({
        user: {
            id: user.id,
            email: user.email,
            user_metadata: user.user_metadata,
            profile: profile || null,
        },
    });
}
