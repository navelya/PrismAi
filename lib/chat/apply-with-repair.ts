import { dispatchTool, type ToolHandlerState, type ToolResult } from './tools/handlers';
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

/**
 * Apply an add_node payload, self-healing on failure. If the apply fails, ask
 * the model to correct the blueprint (ids preserved) and retry — restoring the
 * pre-apply canvas state before each attempt so a partial apply can never
 * corrupt the workflow. After MAX attempts it returns the last failure with the
 * state restored, so the caller's existing failure handling stays valid (never
 * worse than the non-repairing path).
 *
 * This is what makes an approved plan "never error": the deterministic apply
 * stays fast on the happy path, and only a genuine failure pulls the model in
 * to fix the offending node before the user ever sees an error.
 */
export async function applyAddNodeWithRepair(
  state: ToolHandlerState,
  input: { nodes?: any[]; edges?: any[] },
  registry: RegistryContextInput,
): Promise<ToolResult> {
  // Capture the clean pre-apply state up front: a failed dispatchTool may have
  // partially mutated the workflow, so we must restore to THIS point before any
  // retry — not to the post-failure state.
  const snap = snapshot(state);
  let result = await dispatchTool(state, 'add_node', input);
  if (result.success) return result;

  let current = input;

  for (let attempt = 0; attempt < MAX_REPAIR_ATTEMPTS && !result.success; attempt++) {
    restore(state, snap);
    const fixed = await requestBlueprintFix(current, result.error ?? 'add_node failed', registry);
    if (!fixed) break;
    // Preserve any extra top-level fields from the original payload; take the
    // corrected nodes/edges from the model.
    current = { ...current, ...fixed };
    result = await dispatchTool(state, 'add_node', current);
  }

  if (!result.success) restore(state, snap);
  return result;
}
