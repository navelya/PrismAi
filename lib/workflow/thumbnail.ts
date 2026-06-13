import sharp from 'sharp';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { NodeResultType } from '@/lib/workflow/result-format';

/**
 * Baked thumbnails for asset previews.
 *
 * Every image and video result gets a small static WebP thumbnail stored as a
 * SIBLING of the result file: `result_123_0.mp4` → `result_123_0.thumb.webp`.
 * The reader derives the thumbnail URL by string transform (see
 * `bakedThumbUrl` in lib/utils/supabase-image.ts) and falls back to the
 * full-resolution original on error, so a missing thumbnail is never fatal.
 *
 * Why bake our own instead of leaning on Supabase's `/render/image/` transform:
 *   - The render endpoint only handles images, NOT video — video previews are
 *     the biggest gap and this is the only way to give them a poster.
 *   - A baked file is portable: it lives in the same bucket as the result, so a
 *     future migration off Supabase carries it automatically. The render-URL
 *     rewrite is Supabase-specific and dies with it.
 *
 * Generation is BEST-EFFORT: `generateThumbnailBuffer` swallows every error and
 * returns null. Callers must treat null as "no thumbnail" and never fail the
 * result over it.
 */

// Long-edge cap for the thumbnail. Big enough to look crisp in a ~500px tile on
// a retina display without re-introducing the full-res payload we're avoiding.
const THUMB_MAX_DIM = 512;
const THUMB_QUALITY = 70;

/** Suffix (replacing the result's own extension) for the sibling thumbnail. */
export const THUMB_SUFFIX = '.thumb.webp';
export const THUMB_CONTENT_TYPE = 'image/webp';

/**
 * Derive the sibling thumbnail STORAGE PATH from a result's storage path:
 * `…/result_123_0.mp4` → `…/result_123_0.thumb.webp`. If the path has no
 * extension the suffix is appended (defensive — our result paths always carry
 * one).
 */
export function toThumbStoragePath(resultStoragePath: string): string {
  return resultStoragePath.replace(/\.[^./]+$/, '') + THUMB_SUFFIX;
}

async function encodeImageThumb(buffer: Buffer): Promise<Buffer> {
  // First frame only (no `animated`) — a poster-style still is all a tile needs
  // and keeps the file tiny even for animated GIF/WebP sources.
  return sharp(buffer)
    .resize(THUMB_MAX_DIM, THUMB_MAX_DIM, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: THUMB_QUALITY })
    .toBuffer();
}

/**
 * Grab frame 0 of a video and encode it as a WebP thumbnail. Reuses the same
 * fluent-ffmpeg + @ffmpeg-installer stack the extract_frame node uses (already
 * bundled for Vercel by next.config.js). The provider's video bytes are only
 * READ here — never re-encoded or remuxed.
 */
async function encodeVideoPoster(buffer: Buffer): Promise<Buffer> {
  const ffmpegLib = await import('fluent-ffmpeg');
  const ffmpegInstaller = await import('@ffmpeg-installer/ffmpeg');
  const ffmpeg = ffmpegLib.default;
  ffmpeg.setFfmpegPath(ffmpegInstaller.default.path);

  // /tmp is the only writable area in the Vercel/Lambda sandbox.
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'thumb-'));
  const inputPath = path.join(tmpDir, 'in');
  const framePath = path.join(tmpDir, 'frame.png');
  try {
    await fs.writeFile(inputPath, buffer);
    await new Promise<void>((resolve, reject) => {
      ffmpeg(inputPath)
        .seekInput(0)
        .outputOptions(['-frames:v', '1'])
        .on('end', () => resolve())
        .on('error', (err: Error) => reject(err))
        .save(framePath);
    });
    const frame = await fs.readFile(framePath);
    return encodeImageThumb(frame);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Produce a thumbnail buffer for a result, or null when none applies (audio/3d)
 * or generation fails. NEVER throws.
 */
export async function generateThumbnailBuffer(
  buffer: Buffer,
  resultType: NodeResultType
): Promise<Buffer | null> {
  try {
    if (resultType === 'image') return await encodeImageThumb(buffer);
    if (resultType === 'video') return await encodeVideoPoster(buffer);
    return null;
  } catch (err) {
    console.warn(
      `[thumbnail] generation failed for ${resultType}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return null;
  }
}
