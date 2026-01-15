import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';

// REUSING CREDENTIALS FROM client.ts (As per user request/existing setup)
const supabaseUrl = 'https://wyqkbwpybqokmtlghdsr.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind5cWtid3B5YnFva210bGdoZHNyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcxNzAyMDAsImV4cCI6MjA4Mjc0NjIwMH0.ijbswrAfHzNpenCd1cA3CxuIooQIMGzlZCEwbPtDrw4';
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
