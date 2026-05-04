/**
 * Supabase Storage image-transform helpers.
 *
 * Converts a public-object URL (the URL we store in node_results / config) into
 * its `/render/image/` equivalent so the Storage CDN serves a downscaled
 * version. Aspect ratio is preserved automatically when only `width` is
 * supplied — Supabase computes the matching height server-side.
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
    return `${transformed}${sep}width=${width}&quality=${quality}`;
}
