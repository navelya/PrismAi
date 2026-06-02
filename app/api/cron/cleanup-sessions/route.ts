import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { storageKeyFromPublicUrl } from '@/lib/storage/public-url';

export const dynamic = 'force-dynamic';

// A "keeper" result is exactly what the Assets gallery shows: a completed media
// output from a non-ephemeral node. Keepers survive session deletion.
const KEEPER_MEDIA_TYPES = ['image', 'video', 'audio', '3d'];

export async function GET(request: Request) {
    // 1. Authenticate the Cron request
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
        return new Response('Unauthorized', { status: 401 });
    }

    try {
        const supabaseAdmin = createServiceClient();

        // 2. Fetch soft-deleted sessions
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

        let totalFilesDeleted = 0;
        let totalSessionsDeleted = 0;

        // 3. Process each session
        for (const session of deletedSessions) {
            const basePath = `${session.user_id}/${session.id}`;

            // 3a. Enumerate keepers ONCE. Drives stamping, file preservation,
            // and the ephemeral delete — so the split is computed exactly once
            // and is immune to SQL three-valued-logic edge cases.
            const { data: keeperRows, error: keeperErr } = await supabaseAdmin
                .from('node_results')
                .select('id, result_data')
                .eq('session_id', session.id)
                .eq('status', 'completed')
                .in('result_type', KEEPER_MEDIA_TYPES)
                .or('node_type.is.null,node_type.neq.character');

            if (keeperErr) {
                // Could not classify -> do NOT delete anything for this session.
                console.error(`[Cron Wipe] Keeper query failed for session ${session.id}; skipping:`, keeperErr);
                continue;
            }

            const keeperIds = (keeperRows ?? []).map((r) => r.id);

            // 3b. Stamp user_id on keepers so they stay RLS-visible once orphaned.
            if (keeperIds.length > 0) {
                const { error: stampErr } = await supabaseAdmin
                    .from('node_results')
                    .update({ user_id: session.user_id })
                    .in('id', keeperIds)
                    .is('user_id', null);
                if (stampErr) {
                    console.error(`[Cron Wipe] user_id stamp failed for session ${session.id}; skipping:`, stampErr);
                    continue;
                }
            }

            // 3c. Build the set of storage keys referenced by keeper rows.
            const keeperKeys = new Set<string>();
            for (const row of keeperRows ?? []) {
                const items = Array.isArray(row.result_data) ? row.result_data : [];
                for (const item of items) {
                    if (typeof item === 'string') {
                        const key = storageKeyFromPublicUrl(item);
                        if (key) keeperKeys.add(key);
                    }
                }
            }

            // 3d. Crawl storage under {userId}/{sessionId}, then remove everything
            // EXCEPT keeper files. If any list or removal step fails, we must NOT
            // proceed to delete the session row: the cron only ever revisits
            // sessions (not bare storage prefixes), so a session deleted with
            // files still present would orphan them permanently. On failure we
            // leave the session soft-deleted and retry wholesale next run.
            let filesToRemove: string[] = [];
            let removalFailed = false;
            async function fetchAllFiles(path: string) {
                const { data, error } = await supabaseAdmin.storage.from('chat-assets').list(path);
                if (error) {
                    console.error(`[Cron Wipe] List error at ${path}:`, error);
                    removalFailed = true;
                    return;
                }
                if (!data) return;
                for (const item of data) {
                    if (item.id === null) {
                        await fetchAllFiles(`${path}/${item.name}`);
                    } else {
                        filesToRemove.push(`${path}/${item.name}`);
                    }
                }
            }
            await fetchAllFiles(basePath);

            const removable = filesToRemove.filter((p) => !keeperKeys.has(p));
            if (removable.length > 0) {
                const chunkSize = 100;
                for (let i = 0; i < removable.length; i += chunkSize) {
                    const chunk = removable.slice(i, i + chunkSize);
                    const { error: removeError } = await supabaseAdmin.storage
                        .from('chat-assets')
                        .remove(chunk);
                    if (removeError) {
                        console.error(`[Cron Wipe] Chunk removal error for session ${session.id}:`, removeError);
                        removalFailed = true;
                    } else {
                        totalFilesDeleted += chunk.length;
                    }
                }
            }

            // Storage cleanup incomplete -> retry next run; do not orphan files.
            if (removalFailed) {
                console.error(`[Cron Wipe] Storage cleanup incomplete for session ${session.id}; leaving soft-deleted for retry.`);
                continue;
            }

            // 3e. Delete the EPHEMERAL rows (everything for this session that is
            // not a keeper). Must run BEFORE the session delete, while session_id
            // still links them. NULL-safe: keyed on keeperIds, not a predicate.
            let ephemeralDelete = supabaseAdmin
                .from('node_results')
                .delete()
                .eq('session_id', session.id);
            if (keeperIds.length > 0) {
                ephemeralDelete = ephemeralDelete.not('id', 'in', `(${keeperIds.join(',')})`);
            }
            const { error: ephemeralErr } = await ephemeralDelete;
            if (ephemeralErr) {
                console.error(`[Cron Wipe] Ephemeral row delete failed for session ${session.id}; skipping session delete:`, ephemeralErr);
                continue;
            }

            // 3f. Hard delete the session. Keeper node_results rows get their
            // session_id and execution_id SET NULL and survive as a session-less
            // library entry (visible via user_id RLS). messages cascade.
            const { error: dbError } = await supabaseAdmin
                .from('sessions')
                .delete()
                .eq('id', session.id);

            if (dbError) {
                console.error(`[Cron Wipe] DB deletion error for session ${session.id}:`, dbError);
            } else {
                totalSessionsDeleted++;
            }
        }

        console.log(`[Cron] Cleanup complete. Removed ${totalFilesDeleted} files across ${totalSessionsDeleted} sessions.`);

        return NextResponse.json({
            success: true,
            sessionsCleared: totalSessionsDeleted,
            filesCleared: totalFilesDeleted
        });

    } catch (error: any) {
        console.error('[Cron] Critical failure during cleanup:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
