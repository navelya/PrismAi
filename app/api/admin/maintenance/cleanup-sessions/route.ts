import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';
import { createServiceClient } from '@/lib/supabase/service';
import { cleanupSessions } from '@/lib/workflow/cleanup-sessions';

export const dynamic = 'force-dynamic';

const DEFAULT_BATCH = 25;
const MAX_BATCH = 50;

/**
 * Admin-triggered manual cleanup — the same job the nightly cron runs, but
 * processed ONE BATCH per request so it stays under the serverless function
 * timeout regardless of backlog size. The client calls this repeatedly until
 * `remaining` reaches 0.
 */
export async function POST(req: NextRequest) {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    try {
        const body = await req.json().catch(() => ({} as any));
        const requested = Number(body?.limit);
        const limit = Number.isFinite(requested)
            ? Math.min(MAX_BATCH, Math.max(1, Math.floor(requested)))
            : DEFAULT_BATCH;

        const supabaseAdmin = createServiceClient();

        // Pull one batch of soft-deleted sessions.
        const { data: batch, error: fetchError } = await supabaseAdmin
            .from('sessions')
            .select('id, user_id')
            .eq('is_deleted', true)
            .limit(limit);

        if (fetchError) {
            return NextResponse.json({ error: fetchError.message }, { status: 500 });
        }

        const { sessionsCleared, filesCleared } =
            batch && batch.length > 0
                ? await cleanupSessions(supabaseAdmin, batch)
                : { sessionsCleared: 0, filesCleared: 0 };

        // How many soft-deleted sessions remain after this batch?
        const { count: remaining, error: countError } = await supabaseAdmin
            .from('sessions')
            .select('id', { count: 'exact', head: true })
            .eq('is_deleted', true);

        if (countError) {
            return NextResponse.json({ error: countError.message }, { status: 500 });
        }

        return NextResponse.json({
            cleaned: sessionsCleared,
            filesCleared,
            remaining: remaining ?? 0,
        });
    } catch (err: any) {
        console.error('[Admin Cleanup] error:', err);
        return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
    }
}
