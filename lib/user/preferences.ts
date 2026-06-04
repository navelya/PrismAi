import { userApi } from '@/lib/api/client';
import { createClient } from '@/lib/supabase/client';

/**
 * Persist a partial preferences patch, merged onto the user's existing prefs.
 * Reads the current profile so unrelated keys (theme, layoutEngine, …) survive
 * the upsert. Client-only — uses the RLS-scoped browser Supabase client.
 */
export async function persistPrefs(patch: Record<string, any>) {
    const { user } = await userApi.me();
    if (!user) return;
    const supabase = createClient();
    const existing = (user as any).profile?.preferences || {};
    await supabase.from('profiles').upsert({
        id: user.id,
        preferences: { ...existing, ...patch },
        avatar_url: (user as any).profile?.avatar_url || null,
    });
}
