export interface AdminFailureRequest {
    nodeType: string;
    label: string | null;
    model: string | null;
    prompt: string | null;
    config: Record<string, any>;
}

export interface AdminFailure {
    id: string;
    executionId: string;
    sessionId: string | null;
    nodeId: string;
    resultType: string | null;
    error: string;
    failedAt: string;
    user: { id: string | null; email: string | null };
    sessionTitle: string | null;
    request: AdminFailureRequest;
}

export interface AdminFailuresSummary {
    totalFailures: number;
    usersAffected: number;
    topError: string | null;
    topModel: string | null;
}

export interface AdminFailuresResponse {
    failures: AdminFailure[];
    summary: AdminFailuresSummary;
    total: number;
    page: number;
    pageSize: number;
    days: number;
    capped: boolean;
}

export interface AdminFailuresQuery {
    days?: number;
    q?: string;
    page?: number;
    pageSize?: number;
}

async function asJson<T>(res: Response): Promise<T> {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as any)?.error || `Request failed (${res.status})`);
    return data as T;
}

export const adminFailuresApi = {
    list: async (query: AdminFailuresQuery = {}): Promise<AdminFailuresResponse> => {
        const params = new URLSearchParams();
        if (query.days != null) params.set('days', String(query.days));
        if (query.q) params.set('q', query.q);
        if (query.page != null) params.set('page', String(query.page));
        if (query.pageSize != null) params.set('pageSize', String(query.pageSize));
        const res = await fetch(`/api/admin/failures?${params.toString()}`, { cache: 'no-store' });
        return asJson<AdminFailuresResponse>(res);
    },
};
