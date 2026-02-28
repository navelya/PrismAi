import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Dual-Save Node Output Persistence
 *
 * THUMBNAIL (every successful node):
 *   {userId}/{sessionId}/thumbnails/{nodeId}/{hash}-{i}.ext
 *   Ephemeral — deleted & re-uploaded when the node re-runs.
 *   Only written to node.data.outputMetadata (canvas UI).
 *
 * RESULT (leaf nodes only — nodes with no outgoing edges):
 *   {userId}/{sessionId}/{hash}-{i}.ext   ← flat, NO subfolder
 *   Permanent — never deleted.
 *   Only written to session execution_result (chat history).
 */

export interface PersistNodeResult {
    thumbnailPaths: string[];
    thumbnailUrls: string[];
    /** Populated only for leaf nodes; empty array for intermediate nodes. */
    resultPaths: string[];
    resultUrls: string[];
    computedHash: string;
}

type CacheItem = {
    thumbnailPath: string;
    thumbnailUrl: string;
    /** May be absent for intermediate-node cache entries */
    resultPath?: string;
    resultUrl?: string;
};

async function downloadImage(url: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
    try {
        if (url.startsWith('data:')) {
            const [meta, b64] = url.split(',');
            const mimeType = meta.split(':')[1].split(';')[0] ?? 'image/png';
            return { buffer: Buffer.from(b64, 'base64'), mimeType };
        }
        const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
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
    return data.publicUrl;
}

/**
 * Called for every node that produces image output after it succeeds.
 *
 * @param isLeafNode  true = end-node (no outgoing edges) → also save a flat Result copy
 *                   false = intermediate node → thumbnail only
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
    prevThumbnailPaths: string[],
    isLeafNode: boolean,
    computeHash: (nodeType: string, config: any, inputUrls: string[]) => Promise<string>,
): Promise<PersistNodeResult | null> {
    const { userId, sessionId, nodeId, nodeType, config, inputUrls, output } = params;

    const images: any[] = Array.isArray(output)
        ? output.filter((o: any) => o?.url)
        : output?.url ? [output] : [];

    if (images.length === 0) return null;

    const bucket = 'chat-assets';
    const hash = await computeHash(nodeType, config, inputUrls);

    // ── Cache hit ────────────────────────────────────────────────────────────
    const { data: cached } = await adminSupabase
        .from('node_output_cache')
        .select('output_items')
        .eq('hash', hash)
        .single();

    if (cached?.output_items) {
        const items = cached.output_items as CacheItem[];
        const valid = items.filter(i => i.thumbnailPath && i.thumbnailUrl);

        if (valid.length > 0) {
            // If we need results but the cache entry was created as an intermediate node,
            // we can re-use thumbnail URLs as result URLs (they point to the same content).
            // A full re-upload is avoided.
            const resultPaths = isLeafNode
                ? valid.map(i => i.resultPath ?? i.thumbnailPath)
                : [];
            const resultUrls = isLeafNode
                ? valid.map(i => i.resultUrl ?? i.thumbnailUrl)
                : [];

            await adminSupabase
                .from('node_output_cache')
                .update({ last_used_at: new Date().toISOString() })
                .eq('hash', hash);

            return {
                thumbnailPaths: valid.map(i => i.thumbnailPath),
                thumbnailUrls: valid.map(i => i.thumbnailUrl),
                resultPaths,
                resultUrls,
                computedHash: hash,
            };
        }
    }

    // ── Cache miss ───────────────────────────────────────────────────────────

    // Delete only old thumbnails — results are permanent
    if (prevThumbnailPaths.length > 0) {
        await adminSupabase.storage.from(bucket).remove(prevThumbnailPaths).catch(() => { });
    }

    const outputItems: (CacheItem | undefined)[] = new Array(images.length);

    await Promise.all(images.map(async (img: any, i: number) => {
        const downloaded = await downloadImage(img.url);
        if (!downloaded) {
            console.warn(`[Persist] Could not download image ${i} for node ${nodeId} (${img.url.slice(0, 80)})`);
            return;
        }

        const { buffer, mimeType } = downloaded;
        const ext = mimeType.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';

        // A) Thumbnail — flat under thumbnails/{nodeId}/
        const thumbnailPath = `${userId}/${sessionId}/thumbnails/${nodeId}/${hash}-${i}.${ext}`;

        // B) Result — flat directly under sessionId/ (leaf nodes only)
        const resultPath = isLeafNode
            ? `${userId}/${sessionId}/${hash}-${i}.${ext}`
            : null;

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

    const validItems = outputItems.filter((x): x is CacheItem => !!x);
    if (validItems.length === 0) return null;

    // Insert into cache (stores thumbnail + optional result per item)
    await adminSupabase.from('node_output_cache').upsert({
        hash,
        node_type: nodeType,
        output_items: validItems,
        last_used_at: new Date().toISOString(),
    });

    const resultPaths = isLeafNode
        ? validItems.map(i => i.resultPath!).filter(Boolean)
        : [];
    const resultUrls = isLeafNode
        ? validItems.map(i => i.resultUrl!).filter(Boolean)
        : [];

    return {
        thumbnailPaths: validItems.map(i => i.thumbnailPath),
        thumbnailUrls: validItems.map(i => i.thumbnailUrl),
        resultPaths,
        resultUrls,
        computedHash: hash,
    };
}
