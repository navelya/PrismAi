import { dispatchTool, type ToolHandlerState, type ToolResult } from './tools/handlers';
import { mergeWorkflowPatches, type WorkflowPatch } from '@/lib/workflow/workflow-patch';
import { requestBlueprintFix } from './repair-blueprint';
import type { RegistryContextInput } from './prompt/registry-context';

const MAX_REPAIR_ATTEMPTS = 2;

type Snapshot = { nodes: any[]; edges: any[]; idMap: Map<string, string> };

function snapshot(state: ToolHandlerState): Snapshot {
  return {
    nodes: [...state.workflow.nodes],
    edges: [...state.workflow.edges],
    idMap: new Map(state.idMap),
  };
}

function restore(state: ToolHandlerState, snap: Snapshot): void {
  state.workflow.nodes = snap.nodes;
  state.workflow.edges = snap.edges;
  state.idMap = snap.idMap;
}

/** A blueprint is a full workflow patch, not just an insert. */
export interface ApprovedBlueprint {
  nodes?: any[];
  edges?: any[];
  updatedNodes?: any[];
  removedNodeIds?: string[];
}

/**
 * Apply an approved blueprint, self-healing on failure. A blueprint is a full
 * PATCH — it can DELETE existing nodes (removedNodeIds), ADD new ones
 * (nodes/edges), and MODIFY existing ones in place (updatedNodes) — so an
 * approved plan can edit a complex workflow rather than rebuilding it beside the
 * original (which left the old graph orphaned). Operations dispatch in the order
 * remove → add → update, mirroring how the brain emits the same live tools:
 *   - remove first frees the graph of nodes the plan replaces;
 *   - add then creates new nodes and registers their temp ids in the idMap;
 *   - update last, so an updatedNode's replace_inputs can wire to a just-added
 *     node by its temp id (resolved through that idMap).
 *
 * Only the ADD step is model-repairable (it's where schema/handle errors live);
 * a failing remove/update is a dangling-id error the model rarely fixes, so we
 * restore and surface it. On ANY failure the whole pre-apply canvas state is
 * restored, so a partial apply can never corrupt the workflow — never worse than
 * the non-repairing path.
 *
 * The returned patch is the MERGE of every sub-op's patch (all carrying resolved
 * real ids), which the client applies verbatim via applyWorkflowPatch.
 */
export async function applyBlueprintWithRepair(
  state: ToolHandlerState,
  input: ApprovedBlueprint,
  registry: RegistryContextInput,
): Promise<ToolResult> {
  // Clean pre-apply state for the whole sequence: any sub-op may partially
  // mutate the workflow, so a full-sequence failure must restore to THIS point.
  const snap = snapshot(state);
  const patches: WorkflowPatch[] = [];

  const removedNodeIds = Array.isArray(input.removedNodeIds) ? input.removedNodeIds : [];
  const updatedNodes = Array.isArray(input.updatedNodes) ? input.updatedNodes : [];
  const hasNodes = Array.isArray(input.nodes) && input.nodes.length > 0;
  const hasEdges = Array.isArray(input.edges) && input.edges.length > 0;
  const hasAdds = hasNodes || hasEdges;

  if (removedNodeIds.length === 0 && updatedNodes.length === 0 && !hasAdds) {
    return { success: false, error: 'Blueprint contained no operations to apply.' };
  }

  // 1. Removes — delete nodes the plan replaces/drops (and their edges).
  if (removedNodeIds.length > 0) {
    const result = await dispatchTool(state, 'remove_node', { ids: removedNodeIds });
    if (!result.success) {
      restore(state, snap);
      return result;
    }
    if (result.patch) patches.push(result.patch);
  }

  // 2. Adds — with self-heal. Restores to the POST-remove point between repair
  //    attempts (not the top), so a repaired add doesn't resurrect removed nodes.
  if (hasAdds) {
    const addSnap = snapshot(state);
    let current: { nodes?: any[]; edges?: any[] } = { nodes: input.nodes, edges: input.edges };
    let result = await dispatchTool(state, 'add_node', current);

    for (let attempt = 0; attempt < MAX_REPAIR_ATTEMPTS && !result.success; attempt++) {
      restore(state, addSnap);
      const fixed = await requestBlueprintFix(current, result.error ?? 'add_node failed', registry);
      if (!fixed) break;
      current = { ...current, ...fixed };
      result = await dispatchTool(state, 'add_node', current);
    }

    if (!result.success) {
      restore(state, snap);
      return result;
    }
    if (result.patch) patches.push(result.patch);
  }

  // 3. Updates — in-place edits; replace_inputs may reference just-added nodes
  //    by temp id (resolved through the idMap the add step populated).
  if (updatedNodes.length > 0) {
    const result = await dispatchTool(state, 'update_node', { updates: updatedNodes });
    if (!result.success) {
      restore(state, snap);
      return result;
    }
    if (result.patch) patches.push(result.patch);
  }

  const merged = patches.reduce<WorkflowPatch | null>((acc, p) => mergeWorkflowPatches(acc, p), null);
  return { success: true, patch: merged ?? undefined };
}
