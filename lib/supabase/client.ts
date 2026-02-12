import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { cookieStorage } from './storage';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

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
