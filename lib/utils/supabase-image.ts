/**
 * Supabase Storage image-transform helpers.
 *
 * Converts a public-object URL (the URL we store in node_results / config) into
 * its `/render/image/` equivalent so the Storage CDN serves a downscaled
 * version. We MUST pass `resize=contain`: the render endpoint defaults to
 * `resize=cover`, and with only `width` supplied (no explicit height) `cover`
 * crops the image to `width × source-height` instead of scaling it — turning a
 * 16:9 output into a near-square center crop and a 1:1 into a portrait. With
 * `resize=contain` it scales proportionally to the target width, preserving the
 * aspect ratio (verified against the deployment's render backend).
 *
 * Why this matters for the canvas: every node has `backdrop-blur-xl`, and
 * `backdrop-filter: blur()` cost scales with the pixel area of the content
 * underneath. Serving 2048×2048 generated images into a 320px-wide preview
 * burns GPU time on every frame the dragged node moves over them. Showing a
 * 512px thumbnail in the node preview, then loading the full image only when
 * the user clicks into the lightbox, keeps the visual identical and drops the
 * blur cost roughly proportionally to (thumb-area / original-area).
 *
 * Non-Supabase URLs (data:, third-party CDNs, anything that doesn't carry the
 * `/storage/v1/object/public/` segment) pass through unchanged so the helper
 * is always safe to call on any URL we have in hand.
 *
 * Requires Supabase Pro plan (image transformations are gated behind it).
 */

const SUPABASE_OBJECT_PUBLIC = '/storage/v1/object/public/';
const SUPABASE_RENDER_PUBLIC = '/storage/v1/render/image/public/';

export interface ThumbnailOptions {
    /** Target width in pixels. Height is auto-computed to preserve aspect ratio. */
    width?: number;
    /** JPEG/WebP quality 1–100. Default 75. */
    quality?: number;
}

export function toThumbnailUrl(
    url: string | null | undefined,
    options: ThumbnailOptions = {}
): string | undefined {
    if (!url || typeof url !== 'string') return url ?? undefined;
    // Only transform Supabase Storage public-object URLs. Anything else
    // (data:, blob:, external CDN) flows through untouched.
    if (!url.includes(SUPABASE_OBJECT_PUBLIC)) return url;

    const width = options.width ?? 512;
    const quality = options.quality ?? 75;

    const transformed = url.replace(SUPABASE_OBJECT_PUBLIC, SUPABASE_RENDER_PUBLIC);
    const sep = transformed.includes('?') ? '&' : '?';
    return `${transformed}${sep}width=${width}&quality=${quality}&resize=contain`;
}

/**
 * Derive the BAKED thumbnail URL for a result by the sibling-file convention:
 * `…/result_123_0.mp4` → `…/result_123_0.thumb.webp`. The thumbnail is written
 * at this path by media-mirror at generation time (see lib/workflow/thumbnail.ts).
 *
 * Only Supabase Storage public-object URLs are rewritten; data:/blob:/external
 * URLs pass through unchanged so the helper is always safe to call. The caller
 * MUST keep the original URL as an onError fallback — assets generated before
 * this feature (or that the backfill hasn't reached) have no sibling thumb and
 * will 404, at which point the reader swaps in the full-resolution original.
 *
 * Unlike toThumbnailUrl, this needs no Supabase-specific render endpoint, so it
 * keeps working after a migration off Supabase (the thumb is just another file
 * that moves with the bucket).
 */
export function bakedThumbUrl(url: string | null | undefined): string | undefined {
    if (!url || typeof url !== 'string') return url ?? undefined;
    if (!url.includes(SUPABASE_OBJECT_PUBLIC)) return url;

    const qIndex = url.indexOf('?');
    const pathPart = qIndex === -1 ? url : url.slice(0, qIndex);
    const query = qIndex === -1 ? '' : url.slice(qIndex);
    const thumbPath = pathPart.replace(/\.[^./]+$/, '') + '.thumb.webp';
    return `${thumbPath}${query}`;
}
