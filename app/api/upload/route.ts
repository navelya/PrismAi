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

        if (!file && !urlToFetch) {
            return NextResponse.json({ error: 'No file or url provided' }, { status: 400 });
        }

        let buffer: Buffer;
        let mimeType: string = 'image/jpeg';
        let ext = 'jpg';

        if (file) {
            if (!file.type.startsWith('image/')) {
                return NextResponse.json({ error: 'Only image files are allowed' }, { status: 400 });
            }
            const MAX_SIZE = 10 * 1024 * 1024;
            if (file.size > MAX_SIZE) {
                return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 400 });
            }
            mimeType = file.type;
            ext = mimeType.split('/')[1] || 'webp';
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

        // Generate scoped path under user directory
        const filename = customFilename || `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const storagePath = `${user.id}/${filename}`;

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
 * DELETE /api/upload — Delete an uploaded image
 * 
 * Expects JSON body with:
 * - path: the storage path to delete
 */
export async function DELETE(request: NextRequest) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;

    const { path } = await request.json();

    if (!path) {
        return NextResponse.json({ error: 'No path provided' }, { status: 400 });
    }

    // Security: Ensure the path belongs to the authenticated user
    if (!path.startsWith(`${user.id}/`)) {
        return NextResponse.json({ error: 'Access denied' }, { status: 403 });
    }

    const { error } = await supabase.storage
        .from('chat-assets')
        .remove([path]);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
}
