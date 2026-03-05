import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

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
            let filesToRemove: string[] = [];

            // Helper function for recursive traversal using the Admin client
            async function fetchAllFiles(path: string) {
                const { data, error } = await supabaseAdmin.storage.from('chat-assets').list(path);
                if (error) {
                    console.error(`[Cron Wipe] List error at ${path}:`, error);
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

            // Crawl storage bucket for nested output
            await fetchAllFiles(basePath);

            // Chunk and remove
            if (filesToRemove.length > 0) {
                const chunkSize = 100;
                for (let i = 0; i < filesToRemove.length; i += chunkSize) {
                    const chunk = filesToRemove.slice(i, i + chunkSize);
                    const { error: removeError } = await supabaseAdmin.storage
                        .from('chat-assets')
                        .remove(chunk);

                    if (removeError) {
                        console.error(`[Cron Wipe] Chunk removal error for session ${session.id}:`, removeError);
                    } else {
                        totalFilesDeleted += chunk.length;
                    }
                }
            }

            // 4. Hard delete from DB (messages cascade automatically)
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
