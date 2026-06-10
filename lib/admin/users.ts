import { createServiceClient } from '@/lib/supabase/service';

const SUPABASE_LIST_PAGE = 1000;

export type StatusFilter = 'all' | 'active' | 'banned' | 'admin' | 'low_balance';

export interface AdminUserRow {
    id: string;
    email: string | null;
    created_at: string | null;
    last_sign_in_at: string | null;
    banned_until: string | null;
    is_admin: boolean;
    token_balance: number;
    plan_id: string | null;
    subscription_status: string | null;
    avatar_url: string | null;
}

export function isBanned(banned_until: string | null): boolean {
    if (!banned_until) return false;
    const t = Date.parse(banned_until);
    if (Number.isNaN(t)) return false;
    return t > Date.now();
}

export async function loadAllUsers(): Promise<AdminUserRow[]> {
    const service = createServiceClient();

    const authUsers: Array<{
        id: string;
        email: string | null;
        created_at: string | null;
        last_sign_in_at: string | null;
        banned_until: string | null;
    }> = [];

    let pageIdx = 1;
    while (true) {
        const { data, error } = await service.auth.admin.listUsers({ page: pageIdx, perPage: SUPABASE_LIST_PAGE });
        if (error) throw error;
        const batch = data?.users ?? [];
        for (const u of batch) {
            authUsers.push({
                id: u.id,
                email: u.email ?? null,
                created_at: u.created_at ?? null,
                last_sign_in_at: u.last_sign_in_at ?? null,
                banned_until: (u as any).banned_until ?? null,
            });
        }
        if (batch.length < SUPABASE_LIST_PAGE) break;
        pageIdx += 1;
        if (pageIdx > 50) break;
    }

    const ids = authUsers.map(u => u.id);

    const [profilesRes, subsRes] = await Promise.all([
        ids.length
            ? service.from('profiles').select('id, is_admin, token_balance, avatar_url').in('id', ids)
            : Promise.resolve({ data: [] as any[], error: null }),
        ids.length
            ? service.from('subscriptions').select('user_id, plan_id, status').in('user_id', ids)
            : Promise.resolve({ data: [] as any[], error: null }),
    ]);

    if ((profilesRes as any).error) throw (profilesRes as any).error;
    if ((subsRes as any).error) throw (subsRes as any).error;

    const profileById = new Map<string, { is_admin: boolean; token_balance: number; avatar_url: string | null }>();
    for (const p of ((profilesRes as any).data ?? []) as any[]) {
        profileById.set(p.id, {
            is_admin: !!p.is_admin,
            token_balance: Number(p.token_balance ?? 0),
            avatar_url: p.avatar_url ?? null,
        });
    }
    const subByUser = new Map<string, { plan_id: string | null; status: string | null }>();
    for (const s of ((subsRes as any).data ?? []) as any[]) {
        subByUser.set(s.user_id, { plan_id: s.plan_id ?? null, status: s.status ?? null });
    }

    return authUsers.map(u => {
        const profile = profileById.get(u.id);
        const sub = subByUser.get(u.id);
        return {
            id: u.id,
            email: u.email,
            created_at: u.created_at,
            last_sign_in_at: u.last_sign_in_at,
            banned_until: u.banned_until,
            is_admin: profile?.is_admin ?? false,
            token_balance: profile?.token_balance ?? 0,
            avatar_url: profile?.avatar_url ?? null,
            plan_id: sub?.plan_id ?? null,
            subscription_status: sub?.status ?? null,
        };
    });
}

export interface UserDirectoryEntry {
    id: string;
    email: string | null;
    username: string | null;
    avatar_url: string | null;
}

/**
 * Build a lookup of every auth user's display identity (email, a best-effort
 * username pulled from auth metadata, and avatar). Used by admin views that
 * need to attach an owner to rows keyed only by `user_id` — e.g. the node
 * results browser. Email lives in `auth.users`; avatar in `profiles`.
 */
export async function loadUserDirectory(): Promise<Map<string, UserDirectoryEntry>> {
    const service = createServiceClient();
    const meta = new Map<string, { email: string | null; username: string | null; metaAvatar: string | null }>();

    let pageIdx = 1;
    while (true) {
        const { data, error } = await service.auth.admin.listUsers({ page: pageIdx, perPage: SUPABASE_LIST_PAGE });
        if (error) throw error;
        const batch = data?.users ?? [];
        for (const u of batch) {
            const m = (u.user_metadata ?? {}) as Record<string, any>;
            const rawName =
                m.user_name ?? m.username ?? m.preferred_username ?? m.full_name ?? m.name ?? null;
            meta.set(u.id, {
                email: u.email ?? null,
                username: typeof rawName === 'string' && rawName.trim() ? rawName.trim() : null,
                metaAvatar: typeof m.avatar_url === 'string' ? m.avatar_url : null,
            });
        }
        if (batch.length < SUPABASE_LIST_PAGE) break;
        pageIdx += 1;
        if (pageIdx > 50) break;
    }

    const ids = [...meta.keys()];
    const { data: profiles, error: pErr } = ids.length
        ? await service.from('profiles').select('id, avatar_url').in('id', ids)
        : { data: [] as any[], error: null };
    if (pErr) throw pErr;

    const avatarById = new Map<string, string | null>();
    for (const p of ((profiles ?? []) as any[])) avatarById.set(p.id, p.avatar_url ?? null);

    const out = new Map<string, UserDirectoryEntry>();
    for (const [id, m] of meta) {
        out.set(id, {
            id,
            email: m.email,
            username: m.username,
            avatar_url: avatarById.get(id) ?? m.metaAvatar ?? null,
        });
    }
    return out;
}

export function applyFiltersAndSort(
    rows: AdminUserRow[],
    opts: { q: string; status: StatusFilter; planFilter: string; sort: string; dir: 'asc' | 'desc' }
): AdminUserRow[] {
    const filtered = rows.filter(r => {
        if (opts.q) {
            const email = (r.email ?? '').toLowerCase();
            const id = r.id.toLowerCase();
            if (!email.includes(opts.q) && !id.includes(opts.q)) return false;
        }
        if (opts.planFilter && opts.planFilter !== 'all' && r.plan_id !== opts.planFilter) return false;
        const banned = isBanned(r.banned_until);
        switch (opts.status) {
            case 'banned': if (!banned) return false; break;
            case 'admin': if (!r.is_admin) return false; break;
            case 'active': if (banned) return false; break;
            case 'low_balance': if (r.token_balance >= 50) return false; break;
            case 'all':
            default: break;
        }
        return true;
    });

    const cmp = (a: AdminUserRow, b: AdminUserRow): number => {
        const av = pickSortValue(a, opts.sort);
        const bv = pickSortValue(b, opts.sort);
        if (av === bv) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        return av < bv ? -1 : 1;
    };
    filtered.sort((a, b) => (opts.dir === 'asc' ? cmp(a, b) : -cmp(a, b)));
    return filtered;
}

function pickSortValue(r: AdminUserRow, key: string): string | number | null {
    switch (key) {
        case 'email': return (r.email ?? '').toLowerCase();
        case 'token_balance': return r.token_balance;
        case 'last_sign_in_at': return r.last_sign_in_at ? Date.parse(r.last_sign_in_at) : null;
        case 'plan_id': return r.plan_id ?? '';
        case 'created_at':
        default:
            return r.created_at ? Date.parse(r.created_at) : null;
    }
}
