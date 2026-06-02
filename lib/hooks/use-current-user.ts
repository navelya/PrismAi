'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export function useCurrentUser() {
    const [user, setUser] = useState<{ id: string; name: string } | null>(null);
    useEffect(() => {
        const supabase = createClient();
        supabase.auth.getUser().then((res: any) => {
            const u = res?.data?.user;
            if (!u) return;
            const meta = u.user_metadata || {};
            const emailName = (u.email || 'User').split('@')[0];
            const full = meta.full_name || meta.name || '';
            // Prefer a real first name (OAuth `given_name`, an explicit `first_name`,
            // or the first token of a full name); fall back to the email username.
            const first = meta.given_name || meta.first_name
                || (typeof full === 'string' && full.trim() ? full.trim().split(/\s+/)[0] : '')
                || emailName;
            setUser({ id: u.id, name: first });
        });
    }, []);
    return user;
}
