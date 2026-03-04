import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';

interface RouteParams {
    params: { id: string };
}

/**
 * GET /api/sessions/:id — Load a session with its messages
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;

    const { data: session, error: sessionError } = await supabase
        .from('sessions')
        .select('*')
        .eq('id', params.id)
        .eq('user_id', user.id) // Enforce ownership
        .single();

    if (sessionError || !session) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const { data: messages, error: messagesError } = await supabase
        .from('messages')
        .select('*')
        .eq('session_id', params.id)
        .order('created_at', { ascending: true });

    if (messagesError) {
        return NextResponse.json({ error: messagesError.message }, { status: 500 });
    }

    return NextResponse.json({ session, messages: messages || [] });
}

/**
 * PATCH /api/sessions/:id — Update a session (title, canvas_state, etc.)
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;

    const body = await request.json();

    // Only allow whitelisted fields
    const allowedFields: Record<string, any> = {};
    if (body.title !== undefined) allowedFields.title = body.title;
    if (body.canvas_state !== undefined) allowedFields.canvas_state = body.canvas_state;
    allowedFields.updated_at = new Date().toISOString();

    if (Object.keys(allowedFields).length === 1) {
        // Only updated_at — nothing meaningful to update
        return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const { data, error } = await supabase
        .from('sessions')
        .update(allowedFields)
        .eq('id', params.id)
        .eq('user_id', user.id) // Enforce ownership
        .select()
        .single();

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
        return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 });
    }

    return NextResponse.json({ session: data });
}

/**
 * DELETE /api/sessions/:id — Delete a session and all associated assets
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;

    try {
        // 1. Authenticate & Verify Ownership
        const { data: session, error: sessionFetchError } = await supabase
            .from('sessions')
            .select('id')
            .eq('id', params.id)
            .eq('user_id', user.id)
            .single();

        if (sessionFetchError || !session) {
            return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 });
        }

        // 2. Wipe Storage Directory (Cascade)
        // We enforce the `{userId}/{sessionId}/{filename}` hierarchy for all session assets
        const basePath = `${user.id}/${params.id}`;

        let filesToRemove: string[] = [];

        // Helper function for recursive traversal
        async function fetchAllFiles(path: string) {
            const { data, error } = await supabase.storage.from('chat-assets').list(path);
            if (error) {
                console.error(`[Session Delete] Failed to list storage directory at ${path}:`, error);
                return;
            }
            if (!data) return;

            for (const item of data) {
                // If it has no id, it's a sub-folder
                if (item.id === null) {
                    await fetchAllFiles(`${path}/${item.name}`);
                } else {
                    // It's a file
                    filesToRemove.push(`${path}/${item.name}`);
                }
            }
        }

        // Recursively build list of all nested files starting from session root
        await fetchAllFiles(basePath);

        let deletedFilesCount = 0;

        if (filesToRemove.length > 0) {
            // Supabase API limits batch removals to 100 objects per request
            const chunkSize = 100;
            for (let i = 0; i < filesToRemove.length; i += chunkSize) {
                const chunk = filesToRemove.slice(i, i + chunkSize);
                const { error: removeError } = await supabase.storage
                    .from('chat-assets')
                    .remove(chunk);

                if (removeError) {
                    console.error('[Session Delete] Failed to remove chunk from storage:', removeError);
                    // Don't throw 500 here immediately, try to delete as much as we can then surface it
                } else {
                    deletedFilesCount += chunk.length;
                }
            }
        }

        // 3. Delete Database Records
        // Delete messages first (cascade), then session
        await supabase.from('messages').delete().eq('session_id', params.id);
        const { error: dbError } = await supabase.from('sessions').delete().eq('id', params.id);

        if (dbError) {
            return NextResponse.json({ error: dbError.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, deletedFiles: deletedFilesCount });

    } catch (error: any) {
        console.error('Session deletion error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
