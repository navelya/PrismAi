import type { RunDetail } from '@/lib/billing/run-details';

export interface AdminUserListRow {
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

export interface AdminUserDetail extends AdminUserListRow {
    email_confirmed_at: string | null;
    phone: string | null;
    subscription: null | {
        plan_id: string | null;
        status: string | null;
        next_topup_at: string | null;
        current_period_end: string | null;
        cancel_at_period_end: boolean | null;
    };
}

export interface AdminLedgerRow {
    id: string;
    amount: number;
    reason: string;
    metadata: any;
    execution_id: string | null;
    created_at: string;
}

export interface AdminSessionRow {
    id: string;
    title: string | null;
    created_at: string;
    is_deleted: boolean | null;
    deleted_at: string | null;
}

export interface AdminMessageRow {
    id: string;
    role: 'user' | 'assistant';
    content: string | null;
    images: string[];
    created_at: string;
}

export interface AdminAssetRow {
    id: string;
    source_result_id: string;
    node_id: string;
    result_type: 'image' | 'video' | 'audio' | '3d';
    result_url: string;
    session_id: string | null;
    execution_id: string | null;
    created_at: string;
}

export interface AdminUsersStats {
    total: number;
    active7d: number;
    banned: number;
    admins: number;
    totalTokensIssued: number;
}

export type AdminUserStatusFilter = 'all' | 'active' | 'banned' | 'admin' | 'low_balance';
export type AdminUserSortKey = 'created_at' | 'email' | 'token_balance' | 'last_sign_in_at' | 'plan_id';
export type BanDuration = 'none' | '24h' | '7d' | '30d' | 'permanent';

export interface ListUsersParams {
    q?: string;
    status?: AdminUserStatusFilter;
    plan?: string;
    sort?: AdminUserSortKey;
    dir?: 'asc' | 'desc';
    page?: number;
    pageSize?: number;
}

function buildQuery<T extends object>(params: T): string {
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(params as Record<string, unknown>)) {
        if (v === undefined || v === null || v === '') continue;
        usp.set(k, String(v));
    }
    const s = usp.toString();
    return s ? `?${s}` : '';
}

async function asJson<T>(res: Response): Promise<T> {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as any)?.error || `Request failed (${res.status})`);
    return data as T;
}

export const adminUsersApi = {
    list: async (params: ListUsersParams = {}) => {
        const res = await fetch(`/api/admin/users${buildQuery(params)}`);
        return asJson<{ users: AdminUserListRow[]; total: number; page: number; pageSize: number }>(res);
    },

    stats: async () => {
        const res = await fetch('/api/admin/users/stats');
        return asJson<AdminUsersStats>(res);
    },

    detail: async (id: string) => {
        const res = await fetch(`/api/admin/users/${id}`);
        return asJson<{ user: AdminUserDetail }>(res);
    },

    ledger: async (id: string, page = 0, pageSize = 25) => {
        const res = await fetch(`/api/admin/users/${id}/ledger${buildQuery({ page, pageSize })}`);
        return asJson<{ rows: AdminLedgerRow[]; total: number; page: number; pageSize: number; runDetails: Record<string, RunDetail> }>(res);
    },

    sessions: async (id: string, page = 0, pageSize = 25) => {
        const res = await fetch(`/api/admin/users/${id}/sessions${buildQuery({ page, pageSize })}`);
        return asJson<{ rows: AdminSessionRow[]; total: number; page: number; pageSize: number }>(res);
    },

    sessionMessages: async (id: string, sessionId: string) => {
        const res = await fetch(`/api/admin/users/${id}/sessions/${sessionId}/messages`);
        return asJson<{ rows: AdminMessageRow[] }>(res);
    },

    assets: async (id: string, page = 0, pageSize = 24) => {
        const res = await fetch(`/api/admin/users/${id}/assets${buildQuery({ page, pageSize })}`);
        return asJson<{ rows: AdminAssetRow[]; total: number; page: number; pageSize: number }>(res);
    },

    adjustTokens: async (id: string, amount: number, note?: string) => {
        const res = await fetch(`/api/admin/users/${id}/adjust-tokens`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ amount, note }),
        });
        return asJson<{ new_balance: number; note: string }>(res);
    },

    ban: async (id: string, duration: BanDuration) => {
        const res = await fetch(`/api/admin/users/${id}/ban`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ duration }),
        });
        return asJson<{ banned_until: string | null; duration: BanDuration }>(res);
    },

    toggleAdmin: async (id: string) => {
        const res = await fetch(`/api/admin/users/${id}/toggle-admin`, { method: 'POST' });
        return asJson<{ is_admin: boolean }>(res);
    },

    resetPassword: async (id: string) => {
        const res = await fetch(`/api/admin/users/${id}/reset-password`, { method: 'POST' });
        return asJson<{ sent: boolean }>(res);
    },

    exportCsvUrl: (params: ListUsersParams = {}) => `/api/admin/users/export${buildQuery(params)}`,
};
