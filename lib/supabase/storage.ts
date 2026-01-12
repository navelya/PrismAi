// Custom Storage Adapter that syncs with Server-set cookies
// We hardcode the key for simplicity in this bridge
const AUTH_COOKIE_NAME = 'supabase-auth-token';

export const cookieStorage = {
    getItem: (key: string): string | null => {
        if (typeof document === 'undefined') return null;
        // Ignore the requested key (usually sb-xyz) and look for our server-set cookie
        const match = document.cookie.match(new RegExp('(^| )' + AUTH_COOKIE_NAME + '=([^;]+)'));
        return match ? decodeURIComponent(match[2]) : null;
    },
    setItem: (key: string, value: string): void => {
        if (typeof document === 'undefined') return;
        document.cookie = `${AUTH_COOKIE_NAME}=${encodeURIComponent(value)}; path=/; max-age=31536000; SameSite=Lax; Secure`;
    },
    removeItem: (key: string): void => {
        if (typeof document === 'undefined') return;
        document.cookie = `${AUTH_COOKIE_NAME}=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT`;
    },
};
