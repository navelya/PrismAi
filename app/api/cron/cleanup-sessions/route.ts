import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { cleanupSessions } from '@/lib/workflow/cleanup-sessions';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    // 1. Authenticate the Cron request
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return new Response('Unauthorized', { status: 401 });
    }

    try {
        const supabaseAdmin = createServiceClient();

        // Fetch ALL soft-deleted sessions and clean them in one pass.
        const { data: deletedSessions, error: fetchError } = await supabaseAdmin
            .from('sessions')
            .select('id, user_id')
            .eq('is_deleted', true);

        if (fetchError) {
            console.error('[Cron] Failed to fetch deleted sessions:', fetchError);
            return NextResponse.json({ error: fetchError.message }, { status: 500 });
        }

        if (!deletedSessions || deletedSessions.length === 0) {
            return NextResponse.json({ message: 'No deleted sessions to clean up.' });
        }

        console.log(`[Cron] Found ${deletedSessions.length} session(s) pending hard deletion.`);

        // Keeper-preserving cleanup lives in one shared place (also used by the
        // admin maintenance endpoint) so the logic can never drift.
        const { sessionsCleared, filesCleared } = await cleanupSessions(supabaseAdmin, deletedSessions);

        console.log(`[Cron] Cleanup complete. Removed ${filesCleared} files across ${sessionsCleared} sessions.`);

        return NextResponse.json({
            success: true,
            sessionsCleared,
            filesCleared,
        });
    } catch (error: any) {
        console.error('[Cron] Critical failure during cleanup:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
