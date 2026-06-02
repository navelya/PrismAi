'use client';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export function useCurrentUser() {
    const [user, setUser] = useState<{ id: string; name: string } | null>(null);
    useEffect(() => {
        const supabase = createClient();
        supabase.auth.getUser().then((res: any) => {
            const u = res?.data?.user;
            if (u) setUser({ id: u.id, name: (u.email || 'User').split('@')[0] });
        });
    }, []);
    return user;
}
