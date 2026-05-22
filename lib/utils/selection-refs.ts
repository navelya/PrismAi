import type { Workflow } from '@/lib/nodes/types';
import { sharedRegistry } from '@/lib/nodes/core/shared-registry';

/** A node the user pointed at in chat. Snapshotted at send-time so labels
 *  survive later renames/deletes. Shared by client (chip/send) and server
 *  (prompt/persist). */
export interface NodeRef {
  id: string;
  label: string;
  type: string;
  isGroup?: boolean;
  fromGroup?: string;
}

/** Hard cap on how many refs we send/persist — guards against Ctrl+A on a
 *  huge graph blowing up the prompt. Expansion happens BEFORE the cap. */
export const MAX_NODE_REFS = 25;

/** Resolve a node's display name: user label → registry label → raw type. */
function resolveLabel(node: any): string {
  return (
    (typeof node?.data?.label === 'string' && node.data.label.trim().length > 0
      ? node.data.label
      : undefined) ??
    sharedRegistry[node?.type as string]?.meta?.label ??
    String(node?.type ?? 'node')
  );
}

/**
 * Turn the live selected ID set into a capped, group-expanded NodeRef list.
 * - Filters out IDs not present in the workflow (delete-race safety).
 * - Expands any group_container to include its children (parentNode === group id),
 *   tagging each child with `fromGroup`. Mirrors the duplicate/delete expansion
 *   pattern in EditorCanvas.
 * - Sorts by (position.y, position.x) so the first N kept after the cap are the
 *   visually top-left ones (matching what the chip previews).
 */
export function expandSelectionForChat(
  selectedIds: string[],
  workflow: Workflow | null | undefined,
): NodeRef[] {
  if (!workflow || !Array.isArray(workflow.nodes) || selectedIds.length === 0) {
    return [];
  }
  const byId = new Map<string, any>(workflow.nodes.map((n: any) => [n.id, n]));
  const collected = new Map<string, NodeRef>();

  for (const id of selectedIds) {
    const node = byId.get(id);
    if (!node) continue; // dropped between select and send
    const isGroup = node.type === 'group_container';
    if (!collected.has(id)) {
      collected.set(id, { id, label: resolveLabel(node), type: node.type, isGroup: isGroup || undefined });
    }
    if (isGroup) {
      for (const child of workflow.nodes as any[]) {
        if (child.parentNode === id && !collected.has(child.id)) {
          collected.set(child.id, {
            id: child.id,
            label: resolveLabel(child),
            type: child.type,
            fromGroup: id,
          });
        }
      }
    }
  }

  const refs = Array.from(collected.values());
  refs.sort((a, b) => {
    const na = byId.get(a.id);
    const nb = byId.get(b.id);
    const ay = na?.position?.y ?? 0;
    const by = nb?.position?.y ?? 0;
    if (ay !== by) return ay - by;
    return (na?.position?.x ?? 0) - (nb?.position?.x ?? 0);
  });
  return refs.slice(0, MAX_NODE_REFS);
}
