import { createBrowserClient } from '@supabase/ssr';
import { COOKIE_DOMAIN } from '@/lib/domains';

// 🛡️ STABILITY FIX: Use a module-scoped variable to cache the browser client.
// This prevents "Multiple GoTrueClient instances detected" warnings caused by
// calling createBrowserClient multiple times in different components across the app.
let browserClient: ReturnType<typeof createBrowserClient> | undefined;

export const createClient = () => {
    // Return existing instance if it already exists
    if (browserClient) return browserClient;

    // Create new instance and cache it
    browserClient = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        COOKIE_DOMAIN ? { cookieOptions: { domain: COOKIE_DOMAIN } } : undefined
    );

    return browserClient;
};
