/**
 * Deterministic SHA-256 hash of a node's inputs.
 *
 * Used as a cache key before calling an expensive generative API.
 * The same node configuration + same upstream image URLs → same hash → cache hit.
 *
 * Hash inputs:
 * - nodeType         (string)
 * - config           (JSON-serialised, keys sorted for stability)
 * - inputUrls        (sorted array of upstream Supabase Storage public URLs)
 *
 * NOTE: base64 data URLs are NOT stable across sessions (encoding can vary).
 * Once images are stored in Supabase, pass their public URLs here instead.
 * For nodes that haven't been persisted yet (first run), pass [] for inputUrls
 * and the hash will still cover the config alone.
 */

import { stableStringify } from '@/lib/utils/stable-stringify';

/**
 * Compute a SHA-256 hex string from a node's deterministic inputs.
 */
export async function computeNodeHash(
    nodeType: string,
    config: Record<string, unknown>,
    inputUrls: string[] = [],
): Promise<string> {
    const payload = stableStringify({
        nodeType,
        config,
        // Sort URLs so order of upstream results doesn't change the hash
        inputUrls: [...inputUrls].sort(),
    });

    const encoder = new TextEncoder();
    const data = encoder.encode(payload);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
