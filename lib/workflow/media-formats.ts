import { NodeResultType } from '@/lib/workflow/result-format';

/**
 * Single source of truth for how a media result's bytes map to a file
 * extension and HTTP content-type. Storage (media-mirror) and every download
 * path read from this table, so supporting a new format (e.g. another 3d
 * container) is a one-row change here — no new code paths.
 *
 * Pure module: MUST NOT import `sharp` or touch the DOM, so it is safe to
 * import from both server (media-mirror) and client (components).
 */
export interface FormatEntry {
  ext: string;
  contentType: string;
  kind: NodeResultType;
}

// Order matters for content-type → ext resolution: the FIRST matching entry
// wins, so the canonical extension for a content-type is listed first
// (e.g. image/jpeg → 'jpg', not 'jpeg').
export const MEDIA_FORMATS: FormatEntry[] = [
  // image
  { ext: 'png', contentType: 'image/png', kind: 'image' },
  { ext: 'jpg', contentType: 'image/jpeg', kind: 'image' },
  { ext: 'jpeg', contentType: 'image/jpeg', kind: 'image' },
  { ext: 'webp', contentType: 'image/webp', kind: 'image' },
  { ext: 'gif', contentType: 'image/gif', kind: 'image' },
  { ext: 'svg', contentType: 'image/svg+xml', kind: 'image' },
  { ext: 'avif', contentType: 'image/avif', kind: 'image' },
  { ext: 'bmp', contentType: 'image/bmp', kind: 'image' },
  { ext: 'tiff', contentType: 'image/tiff', kind: 'image' },
  // video
  { ext: 'mp4', contentType: 'video/mp4', kind: 'video' },
  { ext: 'webm', contentType: 'video/webm', kind: 'video' },
  { ext: 'mov', contentType: 'video/quicktime', kind: 'video' },
  // audio
  { ext: 'mp3', contentType: 'audio/mpeg', kind: 'audio' },
  { ext: 'wav', contentType: 'audio/wav', kind: 'audio' },
  { ext: 'ogg', contentType: 'audio/ogg', kind: 'audio' },
  { ext: 'm4a', contentType: 'audio/mp4', kind: 'audio' },
  { ext: 'flac', contentType: 'audio/flac', kind: 'audio' },
  // 3d
  { ext: 'glb', contentType: 'model/gltf-binary', kind: '3d' },
  { ext: 'gltf', contentType: 'model/gltf+json', kind: '3d' },
  { ext: 'usdz', contentType: 'model/vnd.usdz+zip', kind: '3d' },
];

const DEFAULT_EXT_BY_KIND: Record<NodeResultType, string> = {
  image: 'png',
  video: 'mp4',
  audio: 'mp3',
  '3d': 'glb',
  text: 'txt',
  json: 'json',
};

/** Extension (with or without a leading dot, any case) → content-type, or null. */
export function contentTypeForExt(ext: string): string | null {
  const e = ext.toLowerCase().replace(/^\./, '');
  const hit = MEDIA_FORMATS.find((f) => f.ext === e);
  return hit ? hit.contentType : null;
}

/** Content-type header value (params stripped) → canonical extension, or null. */
export function extForContentType(contentType: string): string | null {
  const ct = contentType.split(';')[0].trim().toLowerCase();
  const hit = MEDIA_FORMATS.find((f) => f.contentType === ct);
  return hit ? hit.ext : null;
}

/** Last path-segment extension of a URL (query/hash stripped), lowercased, or null. */
export function extFromUrl(url: string): string | null {
  const path = url.split('?')[0].split('#')[0];
  const m = path.match(/\.([a-z0-9]{1,5})$/i);
  return m ? m[1].toLowerCase() : null;
}

/** Fallback extension for a result kind, e.g. 'image' → 'png', '3d' → 'glb'. */
export function defaultExtForType(kind: NodeResultType): string {
  return DEFAULT_EXT_BY_KIND[kind] ?? 'bin';
}
