import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const AUTH_COOKIE_NAME = 'supabase-auth-token';

export const createClient = () => {
    const cookieStore = cookies();

    return createSupabaseClient(supabaseUrl, supabaseKey, {
        auth: {
            persistSession: true,
            autoRefreshToken: false, // Avoid complexity on server for now
            detectSessionInUrl: false,
            storage: {
                getItem(key: string) {
                    // Try to get our custom cookie
                    return cookieStore.get(AUTH_COOKIE_NAME)?.value || null;
                },
                setItem(key: string, value: string) {
                    // Only works in Route Handlers / Actions
                    try {
                        cookieStore.set({
                            name: AUTH_COOKIE_NAME,
                            value,
                            path: '/',
                            maxAge: 31536000,
                            sameSite: 'lax',
                            secure: true
                        });
                    } catch (e) {
                        // Ignore if called from SC
                    }
                },
                removeItem(key: string) {
                    try {
                        cookieStore.set({ name: AUTH_COOKIE_NAME, value: '', path: '/', expires: new Date(0) });
                    } catch (e) { }
                },
            },
        },
    });
};
