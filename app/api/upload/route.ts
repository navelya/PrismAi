import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';

/**
 * POST /api/upload — Upload an image to Supabase Storage
 * 
 * Expects a FormData body with:
 * - file: the image blob
 * - filename (optional): custom filename
 * 
 * Images are stored under the user's folder: chat-assets/{userId}/{filename}
 */
export async function POST(request: NextRequest) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;

    try {
        const formData = await request.formData();
        const file = formData.get('file') as Blob | null;
        const urlToFetch = formData.get('url') as string | null;
        const customFilename = formData.get('filename') as string | null;
        const sessionId = formData.get('sessionId') as string | null;
        const nodeId = formData.get('nodeId') as string | null;
        // `track=1` marks a genuine user file-upload (canvas drop / media_input
        // picker) — indexed in `uploads` so it can appear in the Uploads tab.
        // URL-copies and AI-result re-hosts don't set it, so they're excluded.
        const track = formData.get('track') != null;

        if (!file && !urlToFetch) {
            return NextResponse.json({ error: 'No file or url provided' }, { status: 400 });
        }

        let buffer: Buffer;
        let mimeType: string = 'image/jpeg';
        let ext = 'jpg';

        if (file) {
            if (!file.type.startsWith('image/') && !file.type.startsWith('video/') && !file.type.startsWith('audio/')) {
                return NextResponse.json({ error: 'Only image, video, and audio files are allowed' }, { status: 400 });
            }
            const MAX_SIZE = 50 * 1024 * 1024; // Increased to 50MB for video support
            if (file.size > MAX_SIZE) {
                return NextResponse.json({ error: 'File too large (max 50MB)' }, { status: 400 });
            }
            mimeType = file.type;
            // Prefer the original filename's extension. The MIME-derived fallback
            // is unreliable for audio (audio/mpeg→".mpeg", audio/mp4→".mp4",
            // audio/webm→".webm"), which breaks URL-based media-type detection
            // (an mp3 reads as a broken image, an m4a reads as video). Keeping the
            // real extension makes detectMediaTypeFromUrl resolve it correctly.
            const originalName = (file as File).name || '';
            const nameExt = originalName.includes('.')
                ? originalName.split('.').pop()!.toLowerCase().replace(/[^a-z0-9]/g, '')
                : '';
            ext = nameExt || mimeType.split('/')[1]?.split('+')[0] || 'webp';
            const arrayBuffer = await file.arrayBuffer();
            buffer = Buffer.from(arrayBuffer);
        } else if (urlToFetch) {
            try {
                // Fetch external URL server-side to avoid browser CORS
                const resp = await fetch(urlToFetch);
                if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                mimeType = resp.headers.get('content-type') || 'image/jpeg';
                ext = mimeType.split('/')[1] || 'jpg';
                const arrayBuffer = await resp.arrayBuffer();
                buffer = Buffer.from(arrayBuffer);
            } catch (err) {
                return NextResponse.json({ error: 'Failed to download external image URL' }, { status: 400 });
            }
        } else {
            throw new Error('Unreachable');
        }

        // Generate scoped path: {userId}/{sessionId}/thumbnails/{nodeId}/{filename}
        const filename = customFilename || `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

        let storagePath = `${user.id}/${filename}`;
        if (sessionId) {
            storagePath = nodeId
                ? `${user.id}/${sessionId}/thumbnails/${nodeId}/${filename}`
                : `${user.id}/${sessionId}/${filename}`;
        }

        const { data, error } = await supabase.storage
            .from('chat-assets')
            .upload(storagePath, buffer, {
                contentType: mimeType,
                upsert: false,
            });

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        // Get public URL
        const { data: urlData } = supabase.storage
            .from('chat-assets')
            .getPublicUrl(storagePath);

        // Index genuine user file-uploads so they surface in the Uploads tab.
        // Best-effort: a tracking failure must never fail the upload itself.
        if (track && file) {
            const mediaType = mimeType.startsWith('video/')
                ? 'video'
                : mimeType.startsWith('audio/')
                    ? 'audio'
                    : 'image';
            try {
                await supabase.from('uploads').upsert(
                    {
                        user_id: user.id,
                        url: urlData.publicUrl,
                        storage_path: data.path,
                        media_type: mediaType,
                        mime_type: mimeType,
                        session_id: sessionId,
                    },
                    { onConflict: 'user_id,url', ignoreDuplicates: true },
                );
            } catch {
                // ignore — the file is uploaded; only the index entry is missing.
            }
        }

        return NextResponse.json({
            path: data.path,
            publicUrl: urlData.publicUrl,
        }, { status: 201 });
    } catch (err) {
        return NextResponse.json(
            { error: 'Upload failed' },
            { status: 500 }
        );
    }
}

/**
 * DELETE /api/upload — Delete an uploaded image or folder
 * 
 * Expects JSON body with:
 * - path: the storage path to delete (file or folder prefix)
 * - isFolder: boolean (optional)
 */
export async function DELETE(request: NextRequest) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;

    const { path, isFolder } = await request.json();

    if (!path) {
        return NextResponse.json({ error: 'No path provided' }, { status: 400 });
    }

    // Security: Ensure the path belongs to the authenticated user
    if (!path.startsWith(`${user.id}/`)) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    if (isFolder) {
        // Recursive delete for folders
        // First list all files in the folder
        const { data: files, error: listError } = await supabase.storage
            .from('chat-assets')
            .list(path);

        if (listError) {
            return NextResponse.json({ error: listError.message }, { status: 500 });
        }

        if (files && files.length > 0) {
            const filesToRemove = files.map(f => `${path}/${f.name}`);
            const { error: removeError } = await supabase.storage
                .from('chat-assets')
                .remove(filesToRemove);

            if (removeError) {
                return NextResponse.json({ error: removeError.message }, { status: 500 });
            }
        }
        // Drop any upload-index rows under this folder prefix so the Uploads
        // tab never lists a deleted object (best-effort).
        try {
            await supabase
                .from('uploads')
                .delete()
                .eq('user_id', user.id)
                .like('storage_path', `${path}/%`);
        } catch { /* ignore — storage already cleaned */ }
    } else {
        // Single file delete
        const { error } = await supabase.storage
            .from('chat-assets')
            .remove([path]);

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }
        // Remove its upload-index row, if any (best-effort).
        try {
            await supabase
                .from('uploads')
                .delete()
                .eq('user_id', user.id)
                .eq('storage_path', path);
        } catch { /* ignore — storage already cleaned */ }
    }

    return NextResponse.json({ success: true });
}
