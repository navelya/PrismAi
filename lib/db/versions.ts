import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import { stableStringify } from '@/lib/utils/stable-stringify';
import { Workflow } from '@/lib/nodes/types';

const AUTO_VERSION_KEEP = 20;

export interface VersionRow {
  id: string;
  canvas_id: string;
  kind: 'auto' | 'checkpoint';
  label: string | null;
  content_hash: string;
  created_by: string | null;
  created_at: string;
}

/**
 * Hash the graph the same way autosave does: only nodes/edges matter, and
 * volatile per-node execution state (status/output) is stripped so identical
 * graphs across runs dedup correctly.
 */
export function hashCanvasState(canvasState: any): string {
  const nodes = Array.isArray(canvasState?.nodes) ? canvasState.nodes : [];
  const edges = Array.isArray(canvasState?.edges) ? canvasState.edges : [];
  const sanitized = {
    nodes: nodes.map((n: any) => ({
      ...n,
      data: { ...(n.data || {}), status: undefined, output: undefined },
    })),
    edges,
  };
  return createHash('sha256').update(stableStringify(sanitized)).digest('hex');
}

/** List versions (metadata only — no canvas_state payload), newest first. */
export async function listVersions(
  client: SupabaseClient,
  canvasId: string
): Promise<VersionRow[]> {
  const { data, error } = await client
    .from('workflow_versions')
    .select('id, canvas_id, kind, label, content_hash, created_by, created_at')
    .eq('canvas_id', canvasId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []) as VersionRow[];
}

/** Fetch one version's full canvas_state. */
export async function getVersion(
  client: SupabaseClient,
  id: string
): Promise<{ canvas_id: string; canvas_state: Workflow } | null> {
  const { data, error } = await client
    .from('workflow_versions')
    .select('canvas_id, canvas_state')
    .eq('id', id)
    .single();
  if (error || !data) return null;
  return data as { canvas_id: string; canvas_state: Workflow };
}

/** Create a manual checkpoint from the canvas's CURRENT canvas_state (no dedup). */
export async function createCheckpoint(
  client: SupabaseClient,
  canvasId: string,
  label: string,
  userId: string
): Promise<VersionRow> {
  const { data: session, error: sErr } = await client
    .from('sessions')
    .select('canvas_state')
    .eq('id', canvasId)
    .single();
  if (sErr || !session) throw new Error('Canvas not found');

  const canvasState = session.canvas_state || { nodes: [], edges: [] };
  const { data, error } = await client
    .from('workflow_versions')
    .insert({
      canvas_id: canvasId,
      kind: 'checkpoint',
      label: label || 'Checkpoint',
      canvas_state: canvasState,
      content_hash: hashCanvasState(canvasState),
      created_by: userId,
    })
    .select('id, canvas_id, kind, label, content_hash, created_by, created_at')
    .single();
  if (error) throw new Error(error.message);
  return data as VersionRow;
}

/**
 * Create an auto-version from a provided pre-edit canvas_state, but only if it
 * differs (by hash) from the newest existing version for this canvas. Returns
 * the new row, or null if skipped (empty graph or duplicate). Prunes afterward.
 */
export async function createAutoVersion(
  client: SupabaseClient,
  canvasId: string,
  preEditState: any,
  userId: string | null
): Promise<VersionRow | null> {
  const nodes = Array.isArray(preEditState?.nodes) ? preEditState.nodes : [];
  if (nodes.length === 0) return null; // nothing meaningful to snapshot

  const hash = hashCanvasState(preEditState);

  const { data: latest } = await client
    .from('workflow_versions')
    .select('content_hash')
    .eq('canvas_id', canvasId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest && latest.content_hash === hash) return null; // dedup

  const { data, error } = await client
    .from('workflow_versions')
    .insert({
      canvas_id: canvasId,
      kind: 'auto',
      label: null,
      canvas_state: { nodes, edges: Array.isArray(preEditState?.edges) ? preEditState.edges : [] },
      content_hash: hash,
      created_by: userId,
    })
    .select('id, canvas_id, kind, label, content_hash, created_by, created_at')
    .single();
  if (error) throw new Error(error.message);

  await pruneAutoVersions(client, canvasId);
  return data as VersionRow;
}

/** Delete 'auto' rows beyond the newest AUTO_VERSION_KEEP for this canvas. */
export async function pruneAutoVersions(
  client: SupabaseClient,
  canvasId: string
): Promise<void> {
  const { data: autos, error } = await client
    .from('workflow_versions')
    .select('id')
    .eq('canvas_id', canvasId)
    .eq('kind', 'auto')
    .order('created_at', { ascending: false });
  if (error || !autos) {
    if (error) console.warn('[versions] prune select failed:', error.message);
    return;
  }
  const stale = autos.slice(AUTO_VERSION_KEEP).map((r: any) => r.id);
  if (stale.length === 0) return;
  const { error: delErr } = await client.from('workflow_versions').delete().in('id', stale);
  if (delErr) console.warn('[versions] prune delete failed:', delErr.message);
}

/** Delete a checkpoint (or any single version row). */
export async function deleteVersion(
  client: SupabaseClient,
  id: string
): Promise<void> {
  const { error } = await client.from('workflow_versions').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/**
 * Restore a version: safety-snapshot the current canvas as an auto-version,
 * then overwrite sessions.canvas_state with the target version. Returns the
 * restored canvas_state. Caller must have already verified ownership.
 */
export async function restoreVersion(
  client: SupabaseClient,
  id: string,
  userId: string
): Promise<{ canvasId: string; canvasState: Workflow }> {
  const target = await getVersion(client, id);
  if (!target) throw new Error('Version not found');
  const canvasId = target.canvas_id;

  // Safety snapshot of the current state (dedup'd; may be skipped).
  const { data: session } = await client
    .from('sessions')
    .select('canvas_state')
    .eq('id', canvasId)
    .single();
  if (session?.canvas_state) {
    await createAutoVersion(client, canvasId, session.canvas_state, userId);
  }

  // Overwrite.
  const { error: upErr } = await client
    .from('sessions')
    .update({ canvas_state: target.canvas_state, updated_at: new Date().toISOString() })
    .eq('id', canvasId);
  if (upErr) throw new Error(upErr.message);

  return { canvasId, canvasState: target.canvas_state };
}
