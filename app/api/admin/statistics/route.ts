import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

// Matches the cleanup keeper definition and the Assets gallery filter.
const KEEPER_MEDIA_TYPES = ['image', 'video', 'audio', '3d'] as const;

async function headCount(query: any): Promise<number> {
    const { count, error } = await query;
    if (error) throw error;
    return count ?? 0;
}

export async function GET() {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    try {
        const sb = createServiceClient();

        const sessionsCount = () => sb.from('sessions').select('id', { count: 'exact', head: true });
        const [pendingDeletions, activeSessions, totalSessions, totalUsers] = await Promise.all([
            headCount(sessionsCount().eq('is_deleted', true)),
            headCount(sessionsCount().eq('is_deleted', false)),
            headCount(sessionsCount()),
            headCount(sb.from('profiles').select('id', { count: 'exact', head: true })),
        ]);

        // Keeper results per media type (status=completed, non-character node).
        const keeperCount = (type: string) =>
            sb
                .from('node_results')
                .select('id', { count: 'exact', head: true })
                .eq('status', 'completed')
                .eq('result_type', type)
                .or('node_type.is.null,node_type.neq.character');

        const perType = await Promise.all(KEEPER_MEDIA_TYPES.map((t) => headCount(keeperCount(t))));
        const keeperResults = {
            image: perType[0],
            video: perType[1],
            audio: perType[2],
            '3d': perType[3],
            total: perType.reduce((a, b) => a + b, 0),
        };

        return NextResponse.json({
            pendingDeletions,
            activeSessions,
            totalSessions,
            totalUsers,
            keeperResults,
        });
    } catch (err: any) {
        console.error('[Admin Statistics] error:', err);
        return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
    }
}
