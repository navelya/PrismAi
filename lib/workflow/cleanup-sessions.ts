import type { SupabaseClient } from '@supabase/supabase-js';
import { storageKeyFromPublicUrl } from '@/lib/storage/public-url';

// A "keeper" result is exactly what the Assets gallery shows: a completed media
// output from a non-ephemeral node. Keepers survive session deletion.
export const KEEPER_MEDIA_TYPES = ['image', 'video', 'audio', '3d'];

export interface SessionRef {
    id: string;
    user_id: string;
}

export interface CleanupResult {
    sessionsCleared: number;
    filesCleared: number;
}

/**
 * Hard-delete the given soft-deleted sessions while PRESERVING "keeper" results.
 *
 * For each session: enumerate keepers once, stamp their `user_id` (so they stay
 * RLS-visible after their `session_id`/`execution_id` are SET NULL), delete the
 * non-keeper storage files, delete the ephemeral `node_results` rows, then
 * delete the session (the FK migration SET NULLs the keepers, so they live on).
 *
 * Fail-closed: any list/removal/row error for a session skips that session's
 * hard delete and leaves it soft-deleted for the next run — never orphaning
 * files or deleting data it could not classify.
 *
 * Shared by the nightly cron and the admin maintenance endpoint so the
 * keeper-preservation logic has exactly one implementation.
 */
export async function cleanupSessions(
    supabaseAdmin: SupabaseClient,
    sessions: SessionRef[],
): Promise<CleanupResult> {
    let filesCleared = 0;
    let sessionsCleared = 0;

    for (const session of sessions) {
        const basePath = `${session.user_id}/${session.id}`;

        // 3a. Enumerate keepers ONCE. Drives stamping, file preservation, and the
        // ephemeral delete — computed once and immune to SQL three-valued-logic.
        const { data: keeperRows, error: keeperErr } = await supabaseAdmin
            .from('node_results')
            .select('id, result_data')
            .eq('session_id', session.id)
            .eq('status', 'completed')
            .in('result_type', KEEPER_MEDIA_TYPES)
            .or('node_type.is.null,node_type.neq.character');

        if (keeperErr) {
            // Could not classify -> do NOT delete anything for this session.
            console.error(`[Cleanup] Keeper query failed for session ${session.id}; skipping:`, keeperErr);
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
                console.error(`[Cleanup] user_id stamp failed for session ${session.id}; skipping:`, stampErr);
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
        // proceed to delete the session row: cleanup only ever revisits sessions
        // (not bare storage prefixes), so a session deleted with files still
        // present would orphan them permanently. On failure leave it soft-deleted.
        const filesToRemove: string[] = [];
        let removalFailed = false;
        async function fetchAllFiles(path: string) {
            const { data, error } = await supabaseAdmin.storage.from('chat-assets').list(path);
            if (error) {
                console.error(`[Cleanup] List error at ${path}:`, error);
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
                    console.error(`[Cleanup] Chunk removal error for session ${session.id}:`, removeError);
                    removalFailed = true;
                } else {
                    filesCleared += chunk.length;
                }
            }
        }

        // Storage cleanup incomplete -> retry next run; do not orphan files.
        if (removalFailed) {
            console.error(`[Cleanup] Storage cleanup incomplete for session ${session.id}; leaving soft-deleted for retry.`);
            continue;
        }

        // 3e. Delete the EPHEMERAL rows (everything for this session that is not a
        // keeper). Must run BEFORE the session delete, while session_id still
        // links them. NULL-safe: keyed on keeperIds, not a predicate.
        let ephemeralDelete = supabaseAdmin
            .from('node_results')
            .delete()
            .eq('session_id', session.id);
        if (keeperIds.length > 0) {
            ephemeralDelete = ephemeralDelete.not('id', 'in', `(${keeperIds.join(',')})`);
        }
        const { error: ephemeralErr } = await ephemeralDelete;
        if (ephemeralErr) {
            console.error(`[Cleanup] Ephemeral row delete failed for session ${session.id}; skipping session delete:`, ephemeralErr);
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
            console.error(`[Cleanup] DB deletion error for session ${session.id}:`, dbError);
        } else {
            sessionsCleared++;
        }
    }

    return { sessionsCleared, filesCleared };
}
