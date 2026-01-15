import { createClient } from '@/lib/supabase/server';
import { NextRequest, NextResponse } from 'next/server';

export async function DELETE(
    req: NextRequest,
    { params }: { params: { sessionId: string } }
) {
    try {
        const sessionId = params.sessionId;
        if (!sessionId) {
            return NextResponse.json({ error: 'Session ID required' }, { status: 400 });
        }

        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        // 1. Verify specific session existence and ownership
        const { data: session, error: sessionFetchError } = await supabase
            .from('sessions')
            .select('id, user_id')
            .eq('id', sessionId)
            .eq('user_id', user.id)
            .single();

        if (sessionFetchError || !session) {
            return NextResponse.json({ error: 'Session not found or unauthorized' }, { status: 404 });
        }

        // 2. Collect all file paths associated with this session
        // We need to fetch all messages to find images
        const { data: messages, error: messagesError } = await supabase
            .from('messages')
            .select('role, content, images, result')
            .eq('session_id', sessionId);

        if (messagesError) {
            throw messagesError;
        }

        const pathsToDelete: Set<string> = new Set();
        const bucketUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/chat-assets/`;

        // Helper to extract path from URL or keep relative path
        const extractPath = (urlOrPath: string) => {
            if (!urlOrPath) return null;
            if (urlOrPath.includes('chat-assets/')) {
                // If full URL, extract part after chat-assets/
                const parts = urlOrPath.split('chat-assets/');
                if (parts.length > 1) return parts[1];
            }
            // Assume it's a relative path if it doesn't look like a URL
            if (!urlOrPath.startsWith('http')) return urlOrPath;
            return null;
        };

        // Recursive helper to find image URLs in result JSON
        const findImagesInResult = (obj: any) => {
            if (!obj) return;
            if (typeof obj === 'string') {
                const path = extractPath(obj);
                if (path) pathsToDelete.add(path);
                return;
            }
            if (typeof obj === 'object') {
                if (obj.url && typeof obj.url === 'string') {
                    const path = extractPath(obj.url);
                    if (path) pathsToDelete.add(path);
                }
                // Traverse children
                for (const key in obj) {
                    findImagesInResult(obj[key]);
                }
            }
        };

        // Iterate messages
        messages?.forEach(msg => {
            // User images (array of strings/paths)
            if (msg.role === 'user' && Array.isArray(msg.images)) {
                msg.images.forEach((img: any) => {
                    if (typeof img === 'string') {
                        const path = extractPath(img);
                        if (path) pathsToDelete.add(path);
                    }
                });
            }

            // Assistant result (JSON)
            if (msg.role === 'assistant' && msg.result) {
                findImagesInResult(msg.result);
            }
        });

        const paths = Array.from(pathsToDelete);
        console.log(`[DELETE Session] Found ${paths.length} files to delete for session ${sessionId}`);

        // 3. Delete files from Storage
        if (paths.length > 0) {
            const { error: storageError } = await supabase.storage
                .from('chat-assets')
                .remove(paths);

            if (storageError) {
                console.error('[DELETE Session] Storage deletion failed partially', storageError);
                // We continue to delete the session anyway to avoid blocking user
            } else {
                console.log('[DELETE Session] Successfully deleted files from storage');
            }
        }

        // 4. Delete Session from DB (Cascade will delete messages)
        const { error: deleteError } = await supabase
            .from('sessions')
            .delete()
            .eq('id', sessionId);

        if (deleteError) {
            throw deleteError;
        }

        return NextResponse.json({ success: true, deletedFiles: paths.length });

    } catch (error: any) {
        console.error('Session deletion error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
