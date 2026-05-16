import { applyAddNodeOp, applyRemoveNodeOp, applyUpdateNodeOp } from '@/lib/workflow/graph-ops';
import { applyWorkflowPatch, mergeWorkflowPatches, type WorkflowPatch } from '@/lib/workflow/workflow-patch';
import { layoutPatchAsync } from '@/lib/workflow/layout-incremental';
import { sharedRegistry } from '@/lib/nodes/core/shared-registry';
import type { Workflow } from '@/lib/nodes/types';
import type { ToolName } from './definitions';

export interface ToolHandlerState {
  workflow: Workflow;
  idMap: Map<string, string>;
  /**
   * Per-model dynamic input handle ids for ai_generator nodes.
   * Keyed by model_id (number) → array of api_mapping_keys from
   * inputs_schema.handles. Used to validate edge targetHandles for
   * ai_generator nodes — the static registry only lists fallback
   * handles (trigger/prompt/image) which don't apply for most real
   * models.
   */
  aiModelHandles?: Map<number, string[]>;
}

export interface ToolResult {
  success: boolean;
  patch?: WorkflowPatch;
  error?: string;
}

function getValidTargetHandles(
  node: { type?: string; data?: { config?: any } },
  aiModelHandles?: Map<number, string[]>,
): string[] {
  if (!node?.type) return [];

  // ai_generator handles are DYNAMIC per chosen model — the rendered
  // node uses inputs_schema.handles[*].api_mapping_key from ai_models,
  // not the static registry's fallback handles. If we know the model_id
  // and have the handle list cached, return that. Otherwise fall through
  // and accept anything (don't block — the canvas already rejects bad
  // edges, and being too strict here trades a console warning for a
  // hard error in chat).
  if (node.type === 'ai_generator') {
    const modelId = node.data?.config?.model_id;
    if (typeof modelId === 'number' && aiModelHandles) {
      const handles = aiModelHandles.get(modelId);
      if (handles && handles.length > 0) return handles;
    }
    // Unknown model_id or unknown handles — permissive fallback.
    return [];
  }

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

function validateEdgeHandles(
  node: { id?: string; type?: string; data?: { config?: any }; inputs?: any[] },
  aiModelHandles?: Map<number, string[]>,
): string | null {
  const inputs = Array.isArray(node?.inputs) ? node.inputs : [];
  if (inputs.length === 0) return null;
  const validTargets = getValidTargetHandles(node, aiModelHandles);
  // Permissive fallback: empty list means "we don't know the valid
  // handles for this node" (e.g., ai_generator with an unknown
  // model_id). Skip validation rather than reject every edge.
  if (validTargets.length === 0) return null;
  for (const edge of inputs) {
    const target = edge?.targetHandle;
    if (target == null || target === '') continue; // optional handle is fine
    if (typeof target !== 'string') {
      return `Node "${node.id}" has an edge with non-string targetHandle.`;
    }
    if (!validTargets.includes(target)) {
      return `Node "${node.id}" (type "${node.type}") edge from "${edge?.source}" uses targetHandle "${target}" which does not exist. Valid target handles for this node: ${validTargets.join(', ')}.`;
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

export async function runAddNode(state: ToolHandlerState, args: any): Promise<ToolResult> {
  const hasNodes = Array.isArray(args?.nodes) && args.nodes.length > 0;
  const hasEdges = Array.isArray(args?.edges) && args.edges.length > 0;

  if (!hasNodes && !hasEdges) {
    return { success: false, error: 'add_node requires at least one node or one edge.' };
  }

  // Incremental ELK layout: existing canvas nodes are fixed anchors;
  // ELK places the new batch around them with proper spacing and
  // intra-group layout. Rebuilds args.nodes with ELK-computed positions;
  // existing nodes are untouched. See lib/workflow/layout-incremental.ts.
  if (hasNodes) {
    // The chat tool accepts edges in TWO places: top-level args.edges
    // AND inside each node as a legacy `inputs[]` array (still supported
    // by applyAddNodeOp). ELK needs ALL of them to understand topology —
    // missing per-node inputs caused new chains to look disconnected and
    // either get stacked perpendicular to the flow or overlap existing
    // nodes. We synthesize edges for layout only; the actual workflow
    // edges are still applied by applyAddNodeOp from inputs[].
    const inputEdges: any[] = [];
    for (const n of args.nodes) {
      const inputs = Array.isArray(n?.inputs) ? n.inputs : [];
      for (let i = 0; i < inputs.length; i++) {
        const src = inputs[i]?.source;
        if (typeof src === 'string') {
          inputEdges.push({
            id: `__layout_${n.id}_${i}`,
            source: src,
            target: n.id,
          });
        }
      }
    }

    const positions = await layoutPatchAsync({
      existingNodes: state.workflow.nodes,
      existingEdges: state.workflow.edges,
      newNodes: args.nodes,
      newEdges: [...(args.edges ?? []), ...inputEdges],
    });
    args = {
      ...args,
      nodes: args.nodes.map((n: any) => {
        const pos = positions.get(n.id);
        return pos ? { ...n, position: pos } : n;
      }),
    };
  }

  // Pre-validate every node against the registry so a bad config gives one
  // clean error instead of corrupting the workflow halfway through.
  for (const node of (args.nodes || [])) {
    const err = validateNodeConfigAgainstRegistry(node);
    if (err) return { success: false, error: err };
  }

  // Defense-in-depth: reject edges whose targetHandle doesn't exist on the
  // destination node (static handles + dynamic compositor layer ids +
  // dynamic ai_generator handles per model).
  for (const node of (args.nodes || [])) {
    const err = validateEdgeHandles(node, state.aiModelHandles);
    if (err) return { success: false, error: err };
  }

  const patches: WorkflowPatch[] = [];

  // 1. Apply nodes (legacy per-node inputs[] continues to work via applyAddNodeOp)
  for (const node of (args.nodes || [])) {
    const result = applyAddNodeOp(state.workflow, node, state.idMap);
    if (!result.success) {
      return { success: false, error: result.error || 'add_node failed.' };
    }
    state.workflow = result.workflow;
    if (result.patch) patches.push(result.patch);
  }

  // 2. Apply top-level edges. Resolve temp ids; verify both endpoints exist;
  //    validate targetHandle using validateEdgeHandles for the resolved target node.
  if (hasEdges) {
    const newEdges: any[] = [];
    for (const e of args.edges) {
      if (!e?.source || !e?.target) {
        return { success: false, error: 'add_node edge requires both source and target.' };
      }
      const resolvedSource = state.idMap.get(e.source) ?? e.source;
      const resolvedTarget = state.idMap.get(e.target) ?? e.target;

      const sourceNode = state.workflow.nodes.find((n: any) => n.id === resolvedSource);
      const targetNode = state.workflow.nodes.find((n: any) => n.id === resolvedTarget);
      if (!sourceNode) return { success: false, error: `add_node edge: source "${e.source}" not found.` };
      if (!targetNode) return { success: false, error: `add_node edge: target "${e.target}" not found.` };

      // Reuse validateEdgeHandles by giving it a synthetic single-input node.
      const handleErr = validateEdgeHandles(
        {
          id: resolvedTarget,
          type: (targetNode as any).type,
          data: (targetNode as any).data,
          inputs: [{ source: resolvedSource, sourceHandle: e.sourceHandle, targetHandle: e.targetHandle }],
        },
        state.aiModelHandles,
      );
      if (handleErr) return { success: false, error: handleErr };

      newEdges.push({
        id: crypto.randomUUID(),
        source: resolvedSource,
        target: resolvedTarget,
        sourceHandle: e.sourceHandle || undefined,
        targetHandle: e.targetHandle || undefined,
      });
    }
    if (newEdges.length > 0) {
      const edgePatch = { addedEdges: newEdges } as any;
      state.workflow = applyWorkflowPatch(state.workflow, edgePatch);
      patches.push(edgePatch);
    }
  }

  const merged = patches.reduce<WorkflowPatch | null>((acc, p) => mergeWorkflowPatches(acc, p), null);
  return { success: true, patch: merged ?? undefined };
}

export function runUpdateNode(state: ToolHandlerState, args: any): ToolResult {
  const updates = Array.isArray(args?.updates) ? args.updates : null;
  if (!updates || updates.length === 0) {
    return { success: false, error: 'update_node requires a non-empty "updates" array.' };
  }

  const patches: WorkflowPatch[] = [];

  for (let i = 0; i < updates.length; i++) {
    const u = updates[i];
    if (!u || typeof u !== 'object') {
      return { success: false, error: `update_node updates[${i}] must be an object.` };
    }
    if (!u.id || typeof u.id !== 'string') {
      return { success: false, error: `update_node updates[${i}] requires an "id" string.` };
    }

    // Validate replace_inputs edges against the existing node's target handles,
    // merging in any incoming config override for dynamic handle resolution.
    if (Array.isArray(u.replace_inputs) && u.replace_inputs.length > 0) {
      const existing = state.workflow.nodes.find((n: any) => n.id === u.id || state.idMap.get(u.id) === n.id);
      if (existing) {
        const merged = { ...existing, data: { ...(existing.data || {}), config: u.data?.config ?? existing.data?.config } } as any;
        const err = validateEdgeHandles({ ...merged, id: u.id, inputs: u.replace_inputs }, state.aiModelHandles);
        if (err) return { success: false, error: `update_node updates[${i}]: ${err}` };
      }
    }

    const result = applyUpdateNodeOp(state.workflow, u, state.idMap);
    if (!result.success) {
      return { success: false, error: `update_node updates[${i}] (id "${u.id}"): ${result.error || 'failed.'}` };
    }
    state.workflow = result.workflow;
    if (result.patch) patches.push(result.patch);
  }

  const merged = patches.reduce<WorkflowPatch | null>((acc, p) => mergeWorkflowPatches(acc, p), null);
  return { success: true, patch: merged ?? undefined };
}

export function runRemoveNode(state: ToolHandlerState, args: any): ToolResult {
  const ids = Array.isArray(args?.ids) ? args.ids : null;
  if (!ids || ids.length === 0) {
    return { success: false, error: 'remove_node requires a non-empty "ids" array.' };
  }

  const patches: WorkflowPatch[] = [];

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    if (!id || typeof id !== 'string') {
      return { success: false, error: `remove_node ids[${i}] must be a string.` };
    }
    const result = applyRemoveNodeOp(state.workflow, { id }, state.idMap);
    if (!result.success) {
      return { success: false, error: `remove_node ids[${i}] ("${id}"): ${result.error || 'failed.'}` };
    }
    state.workflow = result.workflow;
    if (result.patch) patches.push(result.patch);
  }

  const merged = patches.reduce<WorkflowPatch | null>((acc, p) => mergeWorkflowPatches(acc, p), null);
  return { success: true, patch: merged ?? undefined };
}

export async function dispatchTool(state: ToolHandlerState, name: ToolName, args: any): Promise<ToolResult> {
  switch (name) {
    case 'add_node':    return await runAddNode(state, args);
    case 'update_node': return runUpdateNode(state, args);
    case 'remove_node': return runRemoveNode(state, args);
    case 'ask_clarification':
      // Handled directly by the brain (see brain.ts) — never patch the workflow.
      // Reached only if the brain forwards it here by mistake; treat as a no-op.
      return { success: true };
    case 'propose_plan':
      // Handled directly by the brain (see brain.ts) — never patches the workflow.
      // Reached only if the brain forwards it here by mistake; treat as a no-op,
      // mirroring the ask_clarification handling above.
      return { success: true };
    default: {
      const _exhaustive: never = name;
      return { success: false, error: `Unknown tool: ${_exhaustive}` };
    }
  }
}

/**
 * Dry-run validation of a propose_plan blueprint. Runs the same checks
 * runAddNode does (config schema, edge handle validity) WITHOUT mutating
 * state. Returns { ok: true } if the blueprint would apply cleanly, or
 * { ok: false, error } with a specific failure reason.
 *
 * Note: validateBlueprint takes a ToolHandlerState but does NOT mutate it —
 * the helper only reads state.aiModelHandles for handle validation. The idMap
 * is intentionally not updated here because blueprint validation is a dry run.
 * (validateTaskList passes a shadow state so accumulation across tasks works.)
 *
 * Why we re-validate here: the brain emits the plan event BEFORE any
 * apply happens. If the model produces an invalid blueprint, we want to
 * surface the error immediately so the model self-corrects on the next
 * turn — instead of letting the user click Approve and then hit a
 * confusing apply-time failure.
 *
 * What we deliberately do NOT validate here: top-level edge endpoints
 * (whether `source` and `target` resolve to real nodes). Those checks
 * live inside runAddNode because they require building the temp-id
 * resolution map as nodes are applied. Approve-time dispatchTool catches
 * those — the proposing-time validation is a fast-fail for the easy
 * stuff. This is acceptable because per-node config + per-node edge-
 * handle checks are the most common model errors.
 */
export function validateBlueprint(
  state: ToolHandlerState,
  blueprint: { nodes?: any[]; edges?: any[] } | null | undefined,
): { ok: true } | { ok: false; error: string } {
  if (!blueprint || (typeof blueprint !== 'object')) {
    return { ok: false, error: 'Blueprint missing or not an object.' };
  }
  const nodes = Array.isArray(blueprint.nodes) ? blueprint.nodes : [];
  const edges = Array.isArray(blueprint.edges) ? blueprint.edges : [];

  if (nodes.length === 0 && edges.length === 0) {
    return { ok: false, error: 'Blueprint must contain at least one node or one edge.' };
  }

  // Same per-node aiSchema check runAddNode runs.
  for (const node of nodes) {
    const err = validateNodeConfigAgainstRegistry(node);
    if (err) return { ok: false, error: err };
  }

  // Same per-node edge-handle check runAddNode runs.
  for (const node of nodes) {
    const err = validateEdgeHandles(node, state.aiModelHandles);
    if (err) return { ok: false, error: err };
  }

  return { ok: true };
}

/**
 * Dry-run validation for a task list. Each task's blueprint goes through
 * the same checks as a single-blueprint propose_plan. After each task
 * passes, its node temp ids are manually registered in the shadow idMap
 * (mirroring what applyAddNodeOp does at apply-time), so a later task may
 * reference an earlier task's temp id.
 *
 * Returns ok: false with the first failure's task index + error.
 */
export function validateTaskList(
  state: ToolHandlerState,
  tasks: any[] | null | undefined
): { ok: true } | { ok: false; taskIndex: number; error: string } {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return { ok: false, taskIndex: -1, error: 'tasks must be a non-empty array.' };
  }

  // Shadow state so validation does not mutate the live handler state.
  const shadow: ToolHandlerState = {
    workflow: { ...state.workflow, nodes: [...state.workflow.nodes], edges: [...state.workflow.edges] },
    idMap: new Map(state.idMap),
    aiModelHandles: state.aiModelHandles,
  };

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (!t || typeof t !== 'object') return { ok: false, taskIndex: i, error: 'task must be an object.' };
    if (typeof t.id !== 'string' || t.id.length === 0) return { ok: false, taskIndex: i, error: 'task.id required.' };
    if (typeof t.title !== 'string' || t.title.length === 0) return { ok: false, taskIndex: i, error: 'task.title required.' };
    if (typeof t.summary !== 'string') return { ok: false, taskIndex: i, error: 'task.summary required.' };
    if (!Array.isArray(t.nodes) || !Array.isArray(t.edges)) return { ok: false, taskIndex: i, error: 'task.nodes and task.edges must be arrays.' };

    if (t.group !== undefined) {
      if (!t.group || typeof t.group !== 'object') return { ok: false, taskIndex: i, error: 'task.group must be an object when present.' };
      if (typeof t.group.label !== 'string' || t.group.label.length === 0) return { ok: false, taskIndex: i, error: 'task.group.label required.' };
      if (typeof t.group.icon !== 'string' || t.group.icon.length === 0) return { ok: false, taskIndex: i, error: 'task.group.icon required.' };
      if (t.group.color !== undefined && !['neutral','indigo','emerald','rose','amber','sky'].includes(t.group.color)) {
        return { ok: false, taskIndex: i, error: 'task.group.color must be one of: neutral, indigo, emerald, rose, amber, sky.' };
      }
    }

    // Validate the task's blueprint chunk in the shadow state. The idMap
    // is then manually populated below to mirror applyAddNodeOp's side-
    // effect, so a later task referencing this task's ids will resolve.
    const v = validateBlueprint(shadow, { nodes: t.nodes, edges: t.edges });
    if (!v.ok) return { ok: false, taskIndex: i, error: v.error };

    // Mirror applyAddNodeOp's idMap side-effect — registers each new node's
    // temp id so subsequent tasks can reference it. The actual UUID value
    // does not need to match the eventual real apply; only presence in the
    // map matters for cross-task validation.
    for (const node of t.nodes) {
      if (node && typeof node.id === 'string' && node.id.length > 0 && !shadow.idMap.has(node.id)) {
        shadow.idMap.set(node.id, crypto.randomUUID());
      }
    }
  }

  return { ok: true };
}
