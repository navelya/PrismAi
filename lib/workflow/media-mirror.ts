import sharp from 'sharp';
import { createServiceClient } from '@/lib/supabase/service';
import { NodeResultType } from '@/lib/workflow/result-format';
import { generateThumbnailBuffer, toThumbStoragePath, THUMB_CONTENT_TYPE } from '@/lib/workflow/thumbnail';

// Image results are re-encoded to WebP before storage. Resolution is preserved
// exactly — sharp is never asked to .resize() — so a 4K generation is saved at
// 4K; only the container/codec changes. Quality 92 is visually indistinguishable
// from the source in practice while keeping files far smaller than PNG. Video,
// audio and 3d are stored byte-for-byte as the provider returned them.
const RESULT_WEBP_QUALITY = 92;

const IMAGE_EXT_CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

/**
 * Re-encode an image result buffer to full-resolution WebP. On any encode
 * failure (e.g. an unexpected/corrupt format sharp can't read) we fall back to
 * storing the original bytes rather than losing a successful generation.
 */
async function prepareImageForStorage(
  buffer: Buffer,
  fallbackExt: string
): Promise<{ buffer: Buffer; ext: string; contentType: string }> {
  try {
    // `animated: true` preserves multi-frame sources (animated GIF/WebP); it is
    // a harmless no-op for single-frame stills.
    const webp = await sharp(buffer, { animated: true })
      .webp({ quality: RESULT_WEBP_QUALITY })
      .toBuffer();
    return { buffer: webp, ext: 'webp', contentType: 'image/webp' };
  } catch (err) {
    console.warn(
      `[media-mirror] WebP re-encode failed; storing original bytes. ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return {
      buffer,
      ext: fallbackExt,
      contentType: IMAGE_EXT_CONTENT_TYPES[fallbackExt] ?? WEBHOOK_MEDIA_CONTENT_TYPES.image,
    };
  }
}

/**
 * Generate and upload a sibling `.thumb.webp` thumbnail for a just-stored
 * result. Best-effort: any failure is logged and swallowed — a result without a
 * thumbnail is valid (the reader falls back to full-res), and a thumbnail
 * problem must never fail the result or mark the node failed. `buffer` is the
 * exact bytes that were stored at `resultStoragePath` (re-encoded WebP for
 * images, original bytes for video).
 */
async function uploadThumbnailBestEffort(
  supabase: ReturnType<typeof createServiceClient>,
  buffer: Buffer,
  resultType: NodeResultType,
  resultStoragePath: string
): Promise<void> {
  try {
    const thumb = await generateThumbnailBuffer(buffer, resultType);
    if (!thumb) return; // audio/3d, or generation failed (already logged)
    const thumbPath = toThumbStoragePath(resultStoragePath);
    const { error } = await supabase.storage.from('chat-assets').upload(thumbPath, thumb, {
      contentType: THUMB_CONTENT_TYPE,
      cacheControl: '3600',
      upsert: true,
    });
    if (error) console.warn(`[media-mirror] thumbnail upload failed (${thumbPath}): ${error.message}`);
  } catch (err) {
    console.warn(
      `[media-mirror] thumbnail step failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

export const WEBHOOK_MEDIA_EXTENSIONS: Record<NodeResultType, string> = {
  image: 'png',
  video: 'mp4',
  audio: 'mp3',
  '3d': 'glb',
  text: 'txt',
  json: 'json',
};

export const WEBHOOK_MEDIA_CONTENT_TYPES: Record<NodeResultType, string> = {
  image: 'image/png',
  video: 'video/mp4',
  audio: 'audio/mpeg',
  '3d': 'model/gltf-binary',
  text: 'text/plain',
  json: 'application/json',
};

export async function fetchWithRetry(url: string, maxAttempts = 3, delayMs = 1500): Promise<Response> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res;
    console.warn(
      `[media-mirror] Fetch attempt ${attempt}/${maxAttempts} failed (${res.status}). ${
        attempt < maxAttempts ? `Retrying in ${delayMs}ms...` : 'No more retries.'
      }`
    );
    if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`Failed to fetch media after ${maxAttempts} attempts`);
}

// Cap on simultaneous fetch+upload pairs. Each in-flight item holds the full
// media payload in memory as a Buffer, so unbounded Promise.all would OOM the
// function on large batches of video.
const MIRROR_CONCURRENCY = 5;

/**
 * Upload one in-memory result buffer to the permanent results path and return
 * its public URL. Used by sync provider adapters (e.g. ElevenLabs) that receive
 * raw bytes instead of a hosted URL. Mirrors the storage-path convention used by
 * mirrorMediaToStorage so node deletion never wipes a node's only output copy.
 */
export async function uploadResultBuffer(
  supabase: ReturnType<typeof createServiceClient>,
  buffer: Buffer,
  resultType: NodeResultType,
  ext: string,
  userId: string,
  sessionId: string,
  nodeId: string,
  index = 0
): Promise<string> {
  const now = Date.now();

  // Image results are stored as full-resolution WebP; everything else keeps its
  // provider bytes/extension untouched.
  let outBuffer = buffer;
  let outExt = ext;
  let outContentType = WEBHOOK_MEDIA_CONTENT_TYPES[resultType];
  if (resultType === 'image') {
    const prepared = await prepareImageForStorage(buffer, ext);
    outBuffer = prepared.buffer;
    outExt = prepared.ext;
    outContentType = prepared.contentType;
  }

  // Store under `results/`, NOT `thumbnails/`. The `thumbnails/{nodeId}` folder
  // is treated as ephemeral and is wiped wholesale when a node is deleted
  // (see deleteNodeWithAssets in lib/store/slices/ui-slice.ts). This is the only
  // persisted copy of a node's output, so it must live in a permanent path that
  // node deletion never touches.
  const storagePath = `${userId}/${sessionId}/results/${nodeId}/result_${now}_${index}.${outExt}`;
  const { error: uploadError } = await supabase.storage.from('chat-assets').upload(storagePath, outBuffer, {
    contentType: outContentType,
    cacheControl: '3600',
    upsert: true,
  });
  if (uploadError) {
    throw new Error(`Supabase Storage upload failed: ${uploadError.message}`);
  }

  // Bake a sibling thumbnail (image only here — audio adapters get null).
  await uploadThumbnailBestEffort(supabase, outBuffer, resultType, storagePath);

  const { data: urlData } = supabase.storage.from('chat-assets').getPublicUrl(storagePath);
  return urlData.publicUrl;
}

export async function mirrorMediaToStorage(
  supabase: ReturnType<typeof createServiceClient>,
  urls: string[],
  resultType: NodeResultType,
  userId: string,
  sessionId: string,
  nodeId: string
): Promise<string[]> {
  const now = Date.now();
  // Pre-sized and written by index — downstream consumers rely on positional
  // alignment with the input `urls` array, so order must be preserved across
  // the parallel workers below.
  const mirroredUrls: string[] = new Array(urls.length);

  const processOne = async (i: number): Promise<void> => {
    const sourceUrl = urls[i];

    if (!sourceUrl.startsWith('http')) {
      mirroredUrls[i] = sourceUrl;
      return;
    }

    const response = await fetchWithRetry(sourceUrl);
    const arrayBuffer = await response.arrayBuffer();
    let buffer: Buffer = Buffer.from(arrayBuffer);

    const extMatch = sourceUrl.match(/\.(png|jpe?g|webp|gif|mp4|webm|mov|avi|mkv|mp3|wav|ogg|m4a|aac|flac|glb|gltf|obj|fbx|stl|usd|usdz)(\?|$)/i);
    let ext = extMatch?.[1]?.toLowerCase() || WEBHOOK_MEDIA_EXTENSIONS[resultType];
    let contentType = WEBHOOK_MEDIA_CONTENT_TYPES[resultType];

    // Image results are re-encoded to full-resolution WebP before storage;
    // video/audio/3d keep their original bytes and extension.
    if (resultType === 'image') {
      const prepared = await prepareImageForStorage(buffer, ext);
      buffer = prepared.buffer;
      ext = prepared.ext;
      contentType = prepared.contentType;
    }

    // Store under `results/`, NOT `thumbnails/` — the thumbnails folder is wiped
    // on node deletion; this is the only persisted copy of the node's output.
    const storagePath = `${userId}/${sessionId}/results/${nodeId}/result_${now}_${i}.${ext}`;

    const { error: uploadError } = await supabase.storage.from('chat-assets').upload(storagePath, buffer, {
      contentType,
      cacheControl: '3600',
      upsert: true,
    });

    if (uploadError) {
      throw new Error(`Supabase Storage upload failed: ${uploadError.message}`);
    }

    // Bake a sibling thumbnail from the bytes we just stored (re-encoded WebP
    // for images, original bytes for video). Best-effort — never fails the run.
    await uploadThumbnailBestEffort(supabase, buffer, resultType, storagePath);

    const { data: urlData } = supabase.storage.from('chat-assets').getPublicUrl(storagePath);
    mirroredUrls[i] = urlData.publicUrl;
  };

  // Worker pool: N workers pull from a shared cursor. If a worker throws,
  // Promise.all rejects with that error; other workers may finish their current
  // task harmlessly (uploads are idempotent via upsert:true) before the rejection
  // propagates to the caller's try/catch.
  let cursor = 0;
  const workerCount = Math.min(MIRROR_CONCURRENCY, urls.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= urls.length) return;
      await processOne(i);
    }
  });
  await Promise.all(workers);

  return mirroredUrls;
}
