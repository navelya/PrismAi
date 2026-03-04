import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Dual-Save Node Output Persistence
 *
 * THUMBNAIL (every successful node):
 *   {userId}/{sessionId}/thumbnails/{nodeId}/thumbnail_{n+1}.ext
 *   Ephemeral — the ENTIRE folder is wiped before each new run.
 *   Displayed on the canvas node card.
 *
 * RESULT (leaf nodes only — nodes with no outgoing edges):
 *   {userId}/{sessionId}/{hash}_{n+1}.ext
 *   Permanent — never deleted.
 *   Appended to chat history.
 *
 * Concurrency: each node gets its own storage path, so multiple nodes
 * can persist in parallel without any path collisions.
 */

export interface PersistNodeResult {
    thumbnailPaths: string[];
    thumbnailUrls: string[];
    /** Populated only for leaf nodes; empty array for intermediate nodes. */
    resultPaths: string[];
    resultUrls: string[];
    computedHash: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

async function downloadImage(url: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
    try {
        if (url.startsWith('data:')) {
            const [meta, b64] = url.split(',');
            const mimeType = meta.split(':')[1].split(';')[0] ?? 'image/png';
            return { buffer: Buffer.from(b64, 'base64'), mimeType };
        }
        // Strip existing cache-busters before fetching (Supabase won't recognise ?t= for CDN bypass)
        const cleanUrl = url.split('?')[0];
        const res = await fetch(cleanUrl, { signal: AbortSignal.timeout(20_000) });
        if (!res.ok) return null;
        const buffer = Buffer.from(await res.arrayBuffer());
        const mimeType = res.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg';
        return { buffer, mimeType };
    } catch {
        return null;
    }
}

async function uploadBuffer(
    adminSupabase: SupabaseClient,
    bucket: string,
    storagePath: string,
    buffer: Buffer,
    mimeType: string,
): Promise<string | null> {
    const { error } = await adminSupabase.storage
        .from(bucket)
        .upload(storagePath, buffer, { contentType: mimeType, upsert: true });
    if (error) {
        console.warn(`[Persist] Upload failed for ${storagePath}:`, error.message);
        return null;
    }
    const { data } = adminSupabase.storage.from(bucket).getPublicUrl(storagePath);
    // Append a cache-buster so browsers always fetch the freshly uploaded file.
    // Without this, re-running a node with the same prompt (same filename) hits the CDN old copy.
    return `${data.publicUrl}?t=${Date.now()}`;
}

/**
 * Wipe every file currently inside a node-specific folder prefix.
 * Called before saving new thumbnails so stale files never accumulate.
 */
async function clearNodeFolder(
    adminSupabase: SupabaseClient,
    bucket: string,
    folderPrefix: string,
): Promise<void> {
    try {
        // List all objects under this prefix (limit=1000 is more than enough for a single node)
        const { data: objects, error } = await adminSupabase.storage
            .from(bucket)
            .list(folderPrefix, { limit: 1000 });

        if (error || !objects || objects.length === 0) return;

        const paths = objects.map((o) => `${folderPrefix}/${o.name}`);
        await adminSupabase.storage.from(bucket).remove(paths);
    } catch (e) {
        // Non-fatal — if cleanup fails we still proceed with the upload
        console.warn(`[Persist] Failed to clear folder ${folderPrefix}:`, e);
    }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Called for every node that produces image output after it succeeds.
 *
 * @param isLeafNode  true = end-node (no outgoing edges) → also save a Result copy under results/{nodeId}/
 *                   false = intermediate node → thumbnail only
 * @param forceOverwrite  skip cache lookup and always upload fresh
 */
export async function persistNodeOutputs(
    adminSupabase: SupabaseClient,
    params: {
        userId: string;
        sessionId: string;
        nodeId: string;
        nodeType: string;
        config: any;
        inputUrls: string[];
        output: any;
    },
    _prevThumbnailPaths: string[],   // kept for API compat; we now do folder-based cleanup
    isLeafNode: boolean,
    computeHash: (nodeType: string, config: any, inputUrls: string[], nodeId?: string) => Promise<string>,
    forceOverwrite: boolean = false
): Promise<PersistNodeResult | null> {
    const { userId, sessionId, nodeId, nodeType, config, inputUrls, output } = params;

    const images: any[] = Array.isArray(output)
        ? output.filter((o: any) => o?.url)
        : output?.url ? [output] : [];

    if (images.length === 0) return null;

    const bucket = 'chat-assets';
    const hash = await computeHash(nodeType, config, inputUrls, nodeId);

    // Folder paths (used for pre-run wipe)
    const thumbnailFolder = `${userId}/${sessionId}/thumbnails/${nodeId}`;

    // ── Cache hit (skip on forceOverwrite) ───────────────────────────────────
    if (!forceOverwrite) {
        const { data: cached } = await adminSupabase
            .from('node_output_cache')
            .select('output_items')
            .eq('hash', hash)
            .single();

        if (cached?.output_items) {
            const items = cached.output_items as Array<{
                thumbnailPath: string;
                thumbnailUrl: string;
                resultPath?: string;
                resultUrl?: string;
            }>;
            const valid = items.filter(i => i.thumbnailPath && i.thumbnailUrl);

            if (valid.length > 0) {
                await adminSupabase
                    .from('node_output_cache')
                    .update({ last_used_at: new Date().toISOString() })
                    .eq('hash', hash);

                return {
                    thumbnailPaths: valid.map(i => i.thumbnailPath),
                    thumbnailUrls: valid.map(i => i.thumbnailUrl),
                    resultPaths: isLeafNode ? valid.map(i => i.resultPath ?? i.thumbnailPath) : [],
                    resultUrls: isLeafNode ? valid.map(i => i.resultUrl ?? i.thumbnailUrl) : [],
                    computedHash: hash,
                };
            }
        }
    }

    // ── Pre-run folder wipe ───────────────────────────────────────────────────
    // Empty the node's thumbnail folder before uploading new files.
    // This ensures no stale images from previous runs remain.
    await clearNodeFolder(adminSupabase, bucket, thumbnailFolder);
    // Note: Result images are permanent, flat under the session root, and never wiped.

    // ── Upload new images in parallel ────────────────────────────────────────
    const outputItems: Array<{
        thumbnailPath: string;
        thumbnailUrl: string;
        resultPath?: string;
        resultUrl?: string;
    } | undefined> = new Array(images.length);

    await Promise.all(images.map(async (img: any, i: number) => {
        const downloaded = await downloadImage(img.url);
        if (!downloaded) {
            console.warn(`[Persist] Could not download image ${i} for node ${nodeId} (${String(img.url).slice(0, 80)})`);
            return;
        }

        const { buffer, mimeType } = downloaded;
        const ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';

        // Canonical names for ephemeral thumbnails
        const thumbnailPath = `${thumbnailFolder}/thumbnail_${i + 1}.${ext}`;
        // Results are permanent, flat under sessionId/
        const resultPath = isLeafNode ? `${userId}/${sessionId}/${hash}_${i + 1}.${ext}` : null;

        const uploads: Promise<string | null>[] = [
            uploadBuffer(adminSupabase, bucket, thumbnailPath, buffer, mimeType),
        ];
        if (resultPath) {
            uploads.push(uploadBuffer(adminSupabase, bucket, resultPath, buffer, mimeType));
        }

        const [thumbnailUrl, resultUrl] = await Promise.all(uploads);

        if (thumbnailUrl) {
            outputItems[i] = {
                thumbnailPath,
                thumbnailUrl,
                ...(resultPath && resultUrl ? { resultPath, resultUrl } : {}),
            };
        }
    }));

    const validItems = outputItems.filter(
        (x): x is NonNullable<(typeof outputItems)[0]> => !!x
    );
    if (validItems.length === 0) return null;

    // ── Persist to cache table ────────────────────────────────────────────────
    await adminSupabase.from('node_output_cache').upsert({
        hash,
        node_type: nodeType,
        output_items: validItems,
        last_used_at: new Date().toISOString(),
    });

    return {
        thumbnailPaths: validItems.map(i => i.thumbnailPath),
        thumbnailUrls: validItems.map(i => i.thumbnailUrl),
        resultPaths: isLeafNode ? validItems.map(i => i.resultPath!).filter(Boolean) : [],
        resultUrls: isLeafNode ? validItems.map(i => i.resultUrl!).filter(Boolean) : [],
        computedHash: hash,
    };
}
