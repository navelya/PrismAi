export type NodeResultType = 'image' | 'video' | 'audio' | '3d';

/**
 * A single media item produced by a node, flattened from a `node_results` row
 * and enriched with the owning user's identity for the admin browser.
 */
export interface AdminNodeResultItem {
    id: string;                 // `${result_id}:${index}` — unique per media item
    source_result_id: string;
    node_id: string;
    node_type: string | null;
    result_type: NodeResultType;
    result_url: string;
    created_at: string;
    execution_id: string | null;
    session_id: string | null;
    user_id: string | null;
    user_email: string | null;
    user_name: string | null;
    user_avatar_url: string | null;
}

export interface AdminNodeResultsResponse {
    rows: AdminNodeResultItem[];
    page: number;
    pageSize: number;
    hasMore: boolean;
}

export interface ListNodeResultsParams {
    page?: number;
    pageSize?: number;
    type?: NodeResultType | 'all';
    q?: string;
}

async function asJson<T>(res: Response): Promise<T> {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as any)?.error || `Request failed (${res.status})`);
    return data as T;
}

export const adminNodeResultsApi = {
    list: async (params: ListNodeResultsParams = {}): Promise<AdminNodeResultsResponse> => {
        const qs = new URLSearchParams();
        if (params.page != null) qs.set('page', String(params.page));
        if (params.pageSize != null) qs.set('pageSize', String(params.pageSize));
        if (params.type && params.type !== 'all') qs.set('type', params.type);
        if (params.q) qs.set('q', params.q);
        const res = await fetch(`/api/admin/node-results?${qs.toString()}`, { cache: 'no-store' });
        return asJson<AdminNodeResultsResponse>(res);
    },
};
