/** The single Supabase Storage bucket all chat/canvas media lives in. */
export const CHAT_ASSETS_BUCKET = 'chat-assets';

/**
 * Convert a Supabase Storage public URL into a bucket-relative storage key
 * (the form `supabase.storage.from(bucket).remove([...])` expects).
 *
 * Returns null when the URL is not under the chat-assets bucket (e.g. media
 * that is still hosted on replicate.delivery because mirroring failed) — there
 * is no local object to act on in that case.
 */
export function storageKeyFromPublicUrl(url: string): string | null {
  const marker = `/object/public/${CHAT_ASSETS_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;

  const afterMarker = url.slice(idx + marker.length);
  const noQuery = afterMarker.split('?')[0]; // drop the ?t= cache-buster
  try {
    return decodeURIComponent(noQuery);
  } catch {
    return noQuery;
  }
}
