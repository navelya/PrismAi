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
