/**
 * Supabase Storage helper for node output assets.
 * 
 * Path structure:
 *   {userId}/{sessionId}/{nodeId}/nodes/{hash}-{i}.ext
 *
 * This hierarchy allows:
 * - Deleting all of a user's assets:   {userId}/
 * - Deleting a session's assets:       {userId}/{sessionId}/
 * - Deleting a single node's assets:   {userId}/{sessionId}/{nodeId}/nodes/
 * - Content-addressed dedup:           same hash → same path → no double upload
 */

import { createClient } from '@/lib/supabase/client';

const BUCKET = 'chat-assets';

export interface UploadResult {
    storagePath: string;   // e.g. node-outputs/uid/sid/nid/abc123.webp
    publicUrl: string;     // Full https:// URL
}

/**
 * Convert a base64 data URL or raw base64 string to a Blob.
 */
function base64ToBlob(base64: string, mimeType = 'image/webp'): Blob {
    const raw = base64.startsWith('data:')
        ? base64.split(',')[1]
        : base64;
    const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
    return new Blob([bytes], { type: mimeType });
}

/**
 * Upload a node output image to Supabase Storage.
 * Overwrites any existing file at the same path (upsert).
 *
 * @param userId    Supabase auth user ID
 * @param sessionId Current session UUID
 * @param nodeId    Node UUID
 * @param imageData base64 data URL or raw base64 string
 * @param hash      SHA-256 hex of the node's inputs (used as filename)
 * @param index     Index when a node produces multiple images (default 0)
 */
export async function uploadNodeImage(
    userId: string,
    sessionId: string,
    nodeId: string,
    imageData: string,
    hash: string,
    index = 0,
): Promise<UploadResult> {
    const supabase = createClient();

    // Detect mime type from data URL
    const mimeType = imageData.startsWith('data:image/png') ? 'image/png'
        : imageData.startsWith('data:image/jpeg') || imageData.startsWith('data:image/jpg') ? 'image/jpeg'
            : imageData.startsWith('data:image/webp') ? 'image/webp'
                : 'image/png';

    const ext = mimeType.split('/')[1] ?? 'png';
    const storagePath = `${userId}/${sessionId}/${nodeId}/nodes/${hash}-${index}.${ext}`;

    const blob = base64ToBlob(imageData, mimeType);

    const { error } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, blob, {
            contentType: mimeType,
            upsert: true, // overwrite if exists (hash collision = same content, safe)
        });

    if (error) throw new Error(`Storage upload failed: ${error.message}`);

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);

    return { storagePath, publicUrl: urlData.publicUrl };
}

/**
 * Delete a node output file from Supabase Storage.
 * Silent no-op if the file doesn't exist.
 */
export async function deleteNodeImage(storagePath: string): Promise<void> {
    if (!storagePath) return;
    const supabase = createClient();
    // Ignore errors — file may already be gone
    await supabase.storage.from(BUCKET).remove([storagePath]);
}

/**
 * Delete ALL output files for a node (entire nodeId folder).
 */
export async function deleteAllNodeImages(
    userId: string,
    sessionId: string,
    nodeId: string,
): Promise<void> {
    const supabase = createClient();
    const prefix = `${userId}/${sessionId}/${nodeId}/nodes/`;

    const { data: files, error } = await supabase.storage.from(BUCKET).list(
        `${userId}/${sessionId}/${nodeId}/nodes`,
    );
    if (error || !files || files.length === 0) return;

    const paths = files.map(f => `${prefix}${f.name}`);
    await supabase.storage.from(BUCKET).remove(paths);
}
