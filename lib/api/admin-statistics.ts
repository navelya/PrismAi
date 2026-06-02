export interface AdminStatistics {
    pendingDeletions: number;
    activeSessions: number;
    totalSessions: number;
    totalUsers: number;
    keeperResults: {
        image: number;
        video: number;
        audio: number;
        '3d': number;
        total: number;
    };
}

export interface CleanupBatchResult {
    cleaned: number;
    filesCleared: number;
    remaining: number;
}

async function asJson<T>(res: Response): Promise<T> {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data as any)?.error || `Request failed (${res.status})`);
    return data as T;
}

export const adminStatisticsApi = {
    stats: async (): Promise<AdminStatistics> => {
        const res = await fetch('/api/admin/statistics', { cache: 'no-store' });
        return asJson<AdminStatistics>(res);
    },

    /** Clean one batch of soft-deleted sessions. Call repeatedly until remaining = 0. */
    cleanupBatch: async (limit = 25): Promise<CleanupBatchResult> => {
        const res = await fetch('/api/admin/maintenance/cleanup-sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ limit }),
        });
        return asJson<CleanupBatchResult>(res);
    },
};
