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
        // 1. Fetch ALL session data to find file paths
        // We need canvas_state and messages to find images
        const { data: session, error: sessionFetchError } = await supabase
            .from('sessions')
            .select('*')
            .eq('id', params.id)
            .eq('user_id', user.id)
            .single();

        if (sessionFetchError || !session) {
            return NextResponse.json({ error: 'Session not found or access denied' }, { status: 404 });
        }

        const { data: messages } = await supabase
            .from('messages')
            .select('*')
            .eq('session_id', params.id);

        // 2. Recursively find all storage paths in session and messages
        const pathsToDelete: Set<string> = new Set();
        const buckets = ['chat-assets', 'uploads'];

        const extractPath = (urlOrPath: string): string | null => {
            if (!urlOrPath || typeof urlOrPath !== 'string') return null;

            // Check against known buckets
            for (const bucket of buckets) {
                if (urlOrPath.includes(`${bucket}/`)) {
                    const parts = urlOrPath.split(`${bucket}/`);
                    if (parts.length > 1) return `${bucket}/${parts[1]}`; // Return generic path pattern if needed, or just path
                    // Actually supabase storage.from('bucket').remove(['path']) expects path relative to bucket
                    // So we should probably allow the caller to handle bucket selection or store generic "bucket/path"
                    // For now, let's assume we are mostly cleaning 'chat-assets' as that's the main one. 
                    // But 'uploads' might be used too. 
                    // Let's settle on extracting the path relative to the bucket if we know the bucket.
                    return parts[1];
                }
            }
            return null;
        };

        const recursiveExtractPaths = (obj: any, targetSet: Set<string>) => {
            if (!obj) return;
            if (typeof obj === 'string') {
                // Check for generic relative paths (userId/filename) used in messages
                if (obj.startsWith(`${user.id}/`)) {
                    // Assume default bucket 'chat-assets' for these relative paths
                    targetSet.add(`chat-assets:${obj}`);
                    return;
                }

                // Heuristic: Check if it looks like a storage URL/path
                // We check for our known buckets
                for (const bucket of buckets) {
                    if (obj.includes(`/${bucket}/`)) {
                        const parts = obj.split(`/${bucket}/`);
                        if (parts.length > 1) {
                            // Store as "bucket:path" to handle multiple buckets
                            targetSet.add(`${bucket}:${parts[1]}`);
                        }
                    }
                }
                return;
            }
            if (typeof obj === 'object') {
                for (const key in obj) {
                    recursiveExtractPaths(obj[key], targetSet);
                }
            }
        };

        // Scan everything
        recursiveExtractPaths(session, pathsToDelete);
        recursiveExtractPaths(messages, pathsToDelete);

        // 3. Delete files from Storage
        const filesByBucket: Record<string, string[]> = {};

        pathsToDelete.forEach(entry => {
            const [bucket, path] = entry.split(':');
            if (!filesByBucket[bucket]) filesByBucket[bucket] = [];
            filesByBucket[bucket].push(path);
        });

        for (const bucket in filesByBucket) {
            const paths = filesByBucket[bucket];
            if (paths.length > 0) {
                await supabase.storage.from(bucket).remove(paths);
            }
        }

        // 4. Delete Database Records
        // Delete messages first (cascade), then session
        await supabase.from('messages').delete().eq('session_id', params.id);
        const { error } = await supabase.from('sessions').delete().eq('id', params.id);

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        return NextResponse.json({ success: true, deletedFiles: pathsToDelete.size });

    } catch (error: any) {
        console.error('Session deletion error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
