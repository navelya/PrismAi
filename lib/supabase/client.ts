import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { cookieStorage } from './storage';

// HARDCODED CREDENTIALS (Requested by User)
const supabaseUrl = 'https://wyqkbwpybqokmtlghdsr.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind5cWtid3B5YnFva210bGdoZHNyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcxNzAyMDAsImV4cCI6MjA4Mjc0NjIwMH0.ijbswrAfHzNpenCd1cA3CxuIooQIMGzlZCEwbPtDrw4';

// Debug: Log to confirm we are using these exact values
if (typeof window !== 'undefined') {
    console.log('[Supabase] Client Initializing with HARDCODED credentials.');
}

let clientInstance: ReturnType<typeof createSupabaseClient> | null = null;

export const createClient = () => {
    if (!supabaseUrl || !supabaseKey) {
        console.error('Missing Supabase Config!');
    }

    // Singleton pattern to prevent multiple instances
    if (clientInstance) return clientInstance;

    // Check strict window property to avoid HMR issues / React Strict Mode double-invoke
    if (typeof window !== 'undefined' && (window as any).__supabaseInstance) {
        return (window as any).__supabaseInstance;
    }

    clientInstance = createSupabaseClient(supabaseUrl!, supabaseKey!, {
        auth: {
            storage: cookieStorage,
            autoRefreshToken: true,
            persistSession: true,
            detectSessionInUrl: true,
        },
    });

    if (typeof window !== 'undefined') {
        (window as any).__supabaseInstance = clientInstance;
    }

    return clientInstance;
};
