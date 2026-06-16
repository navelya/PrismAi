import { createServiceClient } from '@/lib/supabase/service';
import { NodeResultType } from '@/lib/workflow/result-format';
import { generateThumbnailBuffer, toThumbStoragePath, THUMB_CONTENT_TYPE } from '@/lib/workflow/thumbnail';
import {
  contentTypeForExt,
  extForContentType,
  extFromUrl,
  defaultExtForType,
} from '@/lib/workflow/media-formats';

// Results are stored byte-for-byte exactly as the provider returned them — no
// transcoding for ANY type (image incl. SVG, video, audio, 3d). The only
// derived data is the sibling `.thumb.webp` (see thumbnail.ts), which never
// replaces the original. The extension + content-type are resolved from the
// response header, then the URL, then an SVG byte-sniff, then the type default.

/**
 * Cheap defensive check: some providers serve SVG as text/plain or
 * application/octet-stream with no .svg in the URL. SVG is XML text, so the
 * leading bytes start with `<?xml` or `<svg`.
 */
function sniffSvg(buffer: Buffer): boolean {
  const head = buffer.subarray(0, 256).toString('utf8').trimStart().toLowerCase();
  return head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'));
}

/**
 * Resolve the storage extension + content-type for a result's bytes.
 * Priority: response Content-Type header → URL extension → SVG sniff →
 * type default. Type-agnostic — identical logic for every media kind.
 */
function resolveStoredFormat(
  buffer: Buffer,
  headerContentType: string | null,
  sourceUrl: string | null,
  resultType: NodeResultType
): { ext: string; contentType: string } {
  if (headerContentType) {
    const ext = extForContentType(headerContentType);
    if (ext) return { ext, contentType: contentTypeForExt(ext)! };
  }
  if (sourceUrl) {
    const urlExt = extFromUrl(sourceUrl);
    if (urlExt) {
      const ct = contentTypeForExt(urlExt);
      if (ct) return { ext: urlExt, contentType: ct };
    }
  }
  if (resultType === 'image' && sniffSvg(buffer)) {
    return { ext: 'svg', contentType: 'image/svg+xml' };
  }
  const ext = defaultExtForType(resultType);
  return { ext, contentType: contentTypeForExt(ext) ?? 'application/octet-stream' };
}

/**
 * Generate and upload a sibling `.thumb.webp` thumbnail for a just-stored
 * result. Best-effort: any failure is logged and swallowed — a result without a
 * thumbnail is valid (the reader falls back to full-res), and a thumbnail
 * problem must never fail the result or mark the node failed. `buffer` is the
 * exact original bytes that were stored at `resultStoragePath` (same for every
 * type — only the derived sibling `.thumb.webp` is WebP).
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

  // Store original bytes. The caller-supplied `ext` is treated as the format
  // hint (sync adapters know their own output format); fall back to sniff/default.
  const outBuffer = buffer;
  const { ext: outExt, contentType: outContentType } = resolveStoredFormat(
    buffer,
    contentTypeForExt(ext),
    null,
    resultType
  );

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
    const headerContentType = response.headers.get('content-type');
    const arrayBuffer = await response.arrayBuffer();
    const buffer: Buffer = Buffer.from(arrayBuffer);

    // Store original bytes for every type; resolve ext/content-type from the
    // response header, then URL, then SVG sniff, then the type default.
    const { ext, contentType } = resolveStoredFormat(
      buffer,
      headerContentType,
      sourceUrl,
      resultType
    );

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

    // Bake a sibling thumbnail from the original bytes we just stored (same for
    // every type — only the thumbnail is WebP). Best-effort — never fails the run.
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
