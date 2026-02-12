import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Authenticate a request using the Supabase server client.
 * Returns the authenticated user and a server-side Supabase client scoped to that user.
 * 
 * Usage in API routes:
 * ```ts
 * const auth = await getAuthenticatedUser();
 * if (auth.error) return auth.error;
 * const { user, supabase } = auth;
 * ```
 */
export async function getAuthenticatedUser(): Promise<
    | { user: any; supabase: ReturnType<typeof createClient>; error?: undefined }
    | { user?: undefined; supabase?: undefined; error: NextResponse }
> {
    try {
        const supabase = createClient();
        const { data: { user }, error } = await supabase.auth.getUser();

        if (error || !user) {
            return {
                error: NextResponse.json(
                    { error: 'Unauthorized — valid session required' },
                    { status: 401 }
                ),
            };
        }

        return { user, supabase };
    } catch (err) {
        return {
            error: NextResponse.json(
                { error: 'Authentication failed' },
                { status: 401 }
            ),
        };
    }
}
