import { applyAddNodeOp, applyRemoveNodeOp, applyUpdateNodeOp } from '@/lib/workflow/graph-ops';
import { mergeWorkflowPatches, type WorkflowPatch } from '@/lib/workflow/workflow-patch';
import { sharedRegistry } from '@/lib/nodes/core/shared-registry';
import type { Workflow } from '@/lib/nodes/types';
import type { ToolName } from './definitions';

export interface ToolHandlerState {
  workflow: Workflow;
  idMap: Map<string, string>;
}

export interface ToolResult {
  success: boolean;
  patch?: WorkflowPatch;
  error?: string;
}

function getValidTargetHandles(node: { type?: string; data?: { config?: any } }): string[] {
  if (!node?.type) return [];
  const def = (sharedRegistry as any)[node.type];
  const staticIds: string[] = Array.isArray(def?.handles?.inputs)
    ? def.handles.inputs.map((h: any) => h?.id).filter((id: any): id is string => typeof id === 'string')
    : [];

  // For compositor, only the static "layers" handle is valid. The
  // sourceHandleId field in config.layers is the runtime edge id, NOT
  // a handle name on the node — see CompositorNode.tsx where edges are
  // filtered by `targetHandle === 'layers'`. We deliberately don't add
  // config.layers values here so layer_0/layer_1/etc. tool calls get
  // rejected.
  return staticIds;
}

function validateEdgeHandles(node: { id?: string; type?: string; data?: { config?: any }; inputs?: any[] }): string | null {
  const inputs = Array.isArray(node?.inputs) ? node.inputs : [];
  if (inputs.length === 0) return null;
  const validTargets = getValidTargetHandles(node);
  for (const edge of inputs) {
    const target = edge?.targetHandle;
    if (target == null || target === '') continue; // optional handle is fine
    if (typeof target !== 'string') {
      return `Node "${node.id}" has an edge with non-string targetHandle.`;
    }
    if (!validTargets.includes(target)) {
      return `Node "${node.id}" (type "${node.type}") edge from "${edge?.source}" uses targetHandle "${target}" which does not exist. Valid target handles for this node: ${validTargets.length > 0 ? validTargets.join(', ') : '(none)'}.`;
    }
  }
  return null;
}

/**
 * Lightweight aiSchema validator: checks that every required key listed in
 * the registry's aiSchema is present in the node's data.config. We don't
 * fully type-check values — applyAddNodeOp does deeper validation. The
 * goal here is to catch missing required fields before the patch lands so
 * the model sees a clean error and self-corrects.
 */
function validateNodeConfigAgainstRegistry(node: { type: string; data?: { config?: any } }): string | null {
  const def = (sharedRegistry as any)[node.type];
  if (!def) return `Unknown node type "${node.type}".`;
  const schema = def.aiSchema;
  if (!schema || typeof schema !== 'object') return null;

  const config = node.data?.config ?? {};
  const required: string[] = Array.isArray(schema.required) ? schema.required : [];
  const missing = required.filter(k => !(k in config));
  if (missing.length > 0) {
    return `Node "${node.type}" missing required config keys: ${missing.join(', ')}.`;
  }
  return null;
}

export function runAddNode(state: ToolHandlerState, args: any): ToolResult {
  if (!Array.isArray(args?.nodes) || args.nodes.length === 0) {
    return { success: false, error: 'add_node requires a non-empty "nodes" array.' };
  }

  // Pre-validate every node against the registry so a bad config gives one
  // clean error instead of corrupting the workflow halfway through.
  for (const node of args.nodes) {
    const err = validateNodeConfigAgainstRegistry(node);
    if (err) return { success: false, error: err };
  }

  // Defense-in-depth: reject edges whose targetHandle doesn't exist on the
  // destination node (static handles + dynamic compositor layer ids).
  for (const node of args.nodes) {
    const err = validateEdgeHandles(node);
    if (err) return { success: false, error: err };
  }

  const patches: WorkflowPatch[] = [];
  for (const node of args.nodes) {
    const result = applyAddNodeOp(state.workflow, node, state.idMap);
    if (!result.success) {
      return { success: false, error: result.error || 'add_node failed.' };
    }
    state.workflow = result.workflow;
    if (result.patch) patches.push(result.patch);
  }

  const merged = patches.reduce<WorkflowPatch | null>((acc, p) => mergeWorkflowPatches(acc, p), null);
  return { success: true, patch: merged ?? undefined };
}

export function runUpdateNode(state: ToolHandlerState, args: any): ToolResult {
  if (!args?.id || typeof args.id !== 'string') {
    return { success: false, error: 'update_node requires an "id" string.' };
  }

  // Validate replace_inputs edges against the existing node's target handles,
  // merging in any incoming config override for dynamic handle resolution.
  if (Array.isArray(args.replace_inputs) && args.replace_inputs.length > 0) {
    const existing = state.workflow.nodes.find((n: any) => n.id === args.id || state.idMap.get(args.id) === n.id);
    if (existing) {
      const merged = { ...existing, data: { ...(existing.data || {}), config: args.data?.config ?? existing.data?.config } } as any;
      const err = validateEdgeHandles({ ...merged, id: args.id, inputs: args.replace_inputs });
      if (err) return { success: false, error: err };
    }
  }

  const result = applyUpdateNodeOp(state.workflow, args, state.idMap);
  if (!result.success) return { success: false, error: result.error || 'update_node failed.' };
  state.workflow = result.workflow;
  return { success: true, patch: result.patch ?? undefined };
}

export function runRemoveNode(state: ToolHandlerState, args: any): ToolResult {
  if (!args?.id || typeof args.id !== 'string') {
    return { success: false, error: 'remove_node requires an "id" string.' };
  }
  const result = applyRemoveNodeOp(state.workflow, args, state.idMap);
  if (!result.success) return { success: false, error: result.error || 'remove_node failed.' };
  state.workflow = result.workflow;
  return { success: true, patch: result.patch ?? undefined };
}

export function dispatchTool(state: ToolHandlerState, name: ToolName, args: any): ToolResult {
  switch (name) {
    case 'add_node':    return runAddNode(state, args);
    case 'update_node': return runUpdateNode(state, args);
    case 'remove_node': return runRemoveNode(state, args);
    default: {
      const _exhaustive: never = name;
      return { success: false, error: `Unknown tool: ${_exhaustive}` };
    }
  }
}
