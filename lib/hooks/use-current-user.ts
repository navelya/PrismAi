'use client';
import { useEffect, useState } from 'react';
import { userApi } from '@/lib/api/client';

export function useCurrentUser() {
    const [user, setUser] = useState<{ id: string; name: string; avatarUrl: string | null } | null>(null);
    useEffect(() => {
        // Use the SAME source the sidebar profile avatar uses (`/api/user/me`):
        // it resolves `public.profiles` server-side (bypassing client-side RLS),
        // is request-deduplicated, and already powers UserAvatar. A direct client
        // `from('profiles')` query here returned nothing under RLS, leaving the
        // note author without a picture.
        userApi.me().then((res: any) => {
            const u = res?.user;
            if (!u) return;
            const meta = u.user_metadata || {};
            const emailName = (u.email || 'User').split('@')[0];
            const full = meta.full_name || meta.name || '';
            // Prefer a real first name (OAuth `given_name`, an explicit `first_name`,
            // or the first token of a full name); fall back to the email username.
            const first = meta.given_name || meta.first_name
                || (typeof full === 'string' && full.trim() ? full.trim().split(/\s+/)[0] : '')
                || emailName;
            // Same 3-tier hierarchy as UserAvatar: custom profile avatar →
            // OAuth provider avatar → null (initials fallback in the consumer).
            const avatarUrl = u.profile?.avatar_url || meta.avatar_url || meta.picture || null;
            setUser({ id: u.id, name: first, avatarUrl });
        }).catch(() => {
            // Not authenticated — leave user null.
        });
    }, []);
    return user;
}
