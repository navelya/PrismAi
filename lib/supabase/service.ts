import { createClient } from '@supabase/supabase-js';

/**
 * Admin Supabase client using the service role key.
 * Used by background workers that run OUTSIDE of a user request context
 * (no cookies, no auth session). This client bypasses RLS.
 * 
 * IMPORTANT: Only use this in server-side background functions, never expose to the frontend.
 */
export function createServiceClient() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    if (!serviceRoleKey) {
        throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set - background workers cannot operate');
    }

    return createClient(supabaseUrl, serviceRoleKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    });
}
