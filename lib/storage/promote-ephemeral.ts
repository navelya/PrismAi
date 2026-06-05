import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Promote a chat-run's terminal ephemeral output into durable storage.
 *
 * Ephemeral nodes (compositor, blur, levels) write their results to the
 * `workflow-ephemeral-tmp` bucket, which `cleanupEphemeralResults`
 * (lib/workflow/orchestrator.ts) deletes the moment an execution reaches a
 * terminal state. When such a node is the LEAF of a chat run, that output is
 * the deliverable the chat freezes onto the message — so it must outlive the
 * cleanup. Copying it into `chat-assets` (the persistent "keeper" bucket the
 * Assets gallery and session-cleanup already understand) makes it durable.
 */

const EPHEMERAL_BUCKET = 'workflow-ephemeral-tmp';
const PERSISTENT_BUCKET = 'chat-assets';
const EPHEMERAL_MARKER = `/object/public/${EPHEMERAL_BUCKET}/`;

/** True when `url` is a public URL pointing at the ephemeral-tmp bucket. */
export function isEphemeralUrl(url: unknown): url is string {
  return typeof url === 'string' && url.includes(EPHEMERAL_MARKER);
}

/** Extract the bucket-relative key from a workflow-ephemeral-tmp public URL. */
export function ephemeralKeyFromUrl(url: string): string | null {
  const idx = url.indexOf(EPHEMERAL_MARKER);
  if (idx === -1) return null;
  const after = url.slice(idx + EPHEMERAL_MARKER.length).split('?')[0];
  if (!after) return null;
  try {
    return decodeURIComponent(after);
  } catch {
    return after;
  }
}

export interface PromoteDest {
  userId: string;
  sessionId: string;
  nodeId: string;
}

/**
 * Copy a single ephemeral-bucket object into `chat-assets` and return its
 * durable public URL. Returns null when `url` isn't an ephemeral URL (already
 * durable / external) or the copy fails — callers MUST keep the original URL on
 * null so a failed promotion degrades to "lives in tmp" rather than "lost".
 *
 * Supabase Storage `.copy()` is same-bucket only, so this round-trips the bytes
 * through the function (results are small mp4s/pngs).
 */
export async function promoteEphemeralUrl(
  supabase: SupabaseClient,
  url: string,
  dest: PromoteDest,
): Promise<string | null> {
  const key = ephemeralKeyFromUrl(url);
  if (!key) return null;

  const filename = key.split('/').pop() || `result-${key.replace(/[^a-z0-9]/gi, '')}`;
  const destPath = `${dest.userId}/${dest.sessionId}/${dest.nodeId}/nodes/${filename}`;

  const { data: blob, error: dlErr } = await supabase.storage
    .from(EPHEMERAL_BUCKET)
    .download(key);
  if (dlErr || !blob) {
    console.error(`[promoteEphemeral] download failed for ${key}:`, dlErr);
    return null;
  }

  const contentType = blob.type || 'application/octet-stream';
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const { error: upErr } = await supabase.storage
    .from(PERSISTENT_BUCKET)
    .upload(destPath, bytes, { contentType, upsert: true });
  if (upErr) {
    console.error(`[promoteEphemeral] upload failed for ${destPath}:`, upErr);
    return null;
  }

  const { data: urlData } = supabase.storage.from(PERSISTENT_BUCKET).getPublicUrl(destPath);
  return urlData.publicUrl;
}
