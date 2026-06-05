// hooks/useIsAdmin.ts
'use client';
import { useEffect, useState } from 'react';
import { userApi } from '@/lib/api/client';

/** Returns whether the current user is an admin (false until resolved). */
export function useIsAdmin(): boolean {
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    let alive = true;
    userApi.me()
      .then(({ user }) => { if (alive) setIsAdmin(user?.is_admin === true); })
      .catch(() => { if (alive) setIsAdmin(false); });
    return () => { alive = false; };
  }, []);
  return isAdmin;
}
