import type { Workflow, WorkflowNode, WorkflowEdge, AiModel } from '@/lib/nodes/types';
import type { NodeSharedDef, NodeDataType } from '@/lib/nodes/core/types';
import { typesAreCompatible } from '@/lib/editor/handle-compatibility';

export type ValidationError =
    | {
          kind: 'missing-required-input';
          nodeId: string;
          nodeLabel: string;
          inputId: string;
          inputLabel: string;
      }
    | {
          kind: 'no-upstream-data';
          nodeId: string;
          nodeLabel: string;
          inputId: string;
          inputLabel: string;
          sourceNodeId: string;
          sourceNodeLabel: string;
      }
    | {
          kind: 'type-mismatch';
          nodeId: string;
          nodeLabel: string;
          inputId: string;
          inputLabel: string;
          sourceNodeId: string;
          sourceHandleId: string;
          expectedType: string;
          actualType: string;
      };

type ResolvedInput = {
    id: string;
    label: string;
    expectedType: NodeDataType | NodeDataType[];
    isMandatory: boolean;
};

type ResolvedOutput = {
    id: string;
    dataType: NodeDataType | NodeDataType[];
};

export type ValidationContext = {
    workflow: Workflow;
    runMode: 'all' | 'solo' | 'chain' | 'selection';
    targetNodeId: string | null;
    /** For 'selection' mode: the set of selected node ids that will run together. */
    targetNodeIds?: string[];
    /** Node ids that have a usable cached completed result (for solo/chain runs). */
    completedNodeIds: Set<string>;
    sharedRegistry: Record<string, NodeSharedDef<any>>;
    /** Used to resolve the dynamic ai_generator handles. */
    models: AiModel[];
};

export function validateExecution(ctx: ValidationContext): ValidationError[] {
    const { workflow, runMode, targetNodeId, targetNodeIds, completedNodeIds, sharedRegistry, models } = ctx;
    const errors: ValidationError[] = [];

    const executing = computeExecutingNodes(workflow, runMode, targetNodeId, targetNodeIds, sharedRegistry);
    const executingIds = new Set(executing.map((n) => n.id));
    const nodeById = new Map(workflow.nodes.map((n) => [n.id, n]));

    for (const node of executing) {
        if (node.type === 'group_container') continue;

        const inputs = resolveNodeInputs(node, sharedRegistry, models);
        const incomingEdges = workflow.edges.filter((e) => e.target === node.id);

        for (const input of inputs) {
            // Array-style inputs (compositor `layers`, AI-model array handles)
            // can accept multiple edges. Validate every edge independently —
            // checking only the first one silently passes a compositor whose
            // first layer is fine but whose later layers depend on uncached,
            // unselected sources.
            const edgesForInput = findEdgesForInput(node, input, incomingEdges);

            if (edgesForInput.length === 0) {
                if (input.isMandatory) {
                    errors.push({
                        kind: 'missing-required-input',
                        nodeId: node.id,
                        nodeLabel: nodeLabelOf(node),
                        inputId: input.id,
                        inputLabel: input.label,
                    });
                }
                continue;
            }

            for (const edge of edgesForInput) {
                const sourceNode = nodeById.get(edge.source);
                if (!sourceNode) continue;

                const sourceOutput = resolveSourceOutput(sourceNode, edge.sourceHandle, sharedRegistry, models);
                if (sourceOutput && !typesAreCompatible(sourceOutput.dataType as any, input.expectedType as any)) {
                    errors.push({
                        kind: 'type-mismatch',
                        nodeId: node.id,
                        nodeLabel: nodeLabelOf(node),
                        inputId: input.id,
                        inputLabel: input.label,
                        sourceNodeId: sourceNode.id,
                        sourceHandleId: edge.sourceHandle ?? '',
                        expectedType: typeToString(input.expectedType),
                        actualType: typeToString(sourceOutput.dataType),
                    });
                    // Don't also emit no-upstream-data — the type error is the
                    // user-actionable one. A wrong type is wrong regardless of
                    // whether the upstream has cached data.
                    continue;
                }

                // `no-upstream-data` answers "this node can't produce a
                // valid result right now." In 'selection' mode the answer is
                // implicit — the whole point of selecting a set is to run them
                // together so their outputs flow through. A chain like
                //   Scene1 ─┐
                //   Scene2 ─┼─▶ Final
                //   Scene3 ─┘
                // shouldn't fire 5 separate "needs Scene N to run first" errors
                // when Scene N IS in the selection (or reachable via the
                // ephemeral expansion that already feeds executingIds). For
                // selection runs, the only no-upstream-data we still care
                // about is the unreachable case where a wire dangles off a
                // node the workflow no longer contains — and that's already
                // ruled out earlier (`sourceNode` would be null).
                if (
                    runMode !== 'selection' &&
                    !executingIds.has(sourceNode.id) &&
                    !completedNodeIds.has(sourceNode.id)
                ) {
                    errors.push({
                        kind: 'no-upstream-data',
                        nodeId: node.id,
                        nodeLabel: nodeLabelOf(node),
                        inputId: input.id,
                        inputLabel: input.label,
                        sourceNodeId: sourceNode.id,
                        sourceNodeLabel: nodeLabelOf(sourceNode),
                    });
                }
            }
        }
    }

    return errors;
}

function computeExecutingNodes(
    workflow: Workflow,
    runMode: 'all' | 'solo' | 'chain' | 'selection',
    targetNodeId: string | null,
    targetNodeIds?: string[],
    sharedRegistry?: Record<string, NodeSharedDef<any>>,
): WorkflowNode[] {
    if (runMode === 'all') {
        return workflow.nodes.filter((n) => n.type !== 'group_container');
    }
    if (runMode === 'selection') {
        // Multi-solo: each selected node treats its siblings as fellow executors.
        // Also auto-include every ephemeral (non-generative) ancestor — these
        // run for free on the backend (see /api/executions/start), so requiring
        // them to be cached or selected would falsely flag chains like
        //   prompt → blur → ai_gen
        // when the user selects only the leaf. Generative ancestors are NOT
        // expanded — those must be cached (completedNodeIds) or in the selection.
        const expanded = new Set(targetNodeIds ?? []);
        if (sharedRegistry) {
            const queue = Array.from(expanded);
            while (queue.length > 0) {
                const currentId = queue.shift()!;
                for (const edge of workflow.edges) {
                    if (edge.target !== currentId) continue;
                    if (expanded.has(edge.source)) continue;
                    const parent = workflow.nodes.find((n) => n.id === edge.source);
                    if (!parent || parent.type === 'group_container') continue;
                    const def = sharedRegistry[parent.type];
                    const isEphemeral = !!def && (def as any).family !== 'generative';
                    if (isEphemeral) {
                        expanded.add(parent.id);
                        queue.push(parent.id);
                    }
                }
            }
        }
        return workflow.nodes.filter((n) => expanded.has(n.id) && n.type !== 'group_container');
    }
    if (!targetNodeId) return [];
    const target = workflow.nodes.find((n) => n.id === targetNodeId);
    if (!target) return [];
    if (runMode === 'solo') return [target];

    const adj = new Map<string, string[]>();
    for (const e of workflow.edges) {
        if (!adj.has(e.source)) adj.set(e.source, []);
        adj.get(e.source)!.push(e.target);
    }
    const seen = new Set<string>([targetNodeId]);
    const queue = [targetNodeId];
    while (queue.length) {
        const id = queue.shift()!;
        for (const child of adj.get(id) ?? []) {
            if (seen.has(child)) continue;
            seen.add(child);
            queue.push(child);
        }
    }
    return workflow.nodes.filter((n) => seen.has(n.id) && n.type !== 'group_container');
}

function resolveNodeInputs(
    node: WorkflowNode,
    sharedRegistry: Record<string, NodeSharedDef<any>>,
    models: AiModel[],
): ResolvedInput[] {
    if (node.type === 'ai_generator') {
        const modelId = (node.data as any)?.config?.model_id ?? (node.data as any)?.model_id;
        const model = modelId ? models.find((m) => m.id === Number(modelId)) : null;
        if (!model) return [];
        return (model.inputs_schema?.handles ?? [])
            .filter((h) => h.is_visible !== false)
            .map((h) => ({
                id: h.api_mapping_key || h.name,
                label: h.name,
                expectedType: h.type as NodeDataType,
                isMandatory: !!h.is_mandatory,
            }));
    }

    const def = sharedRegistry[node.type];
    if (!def) return [];
    return (def.handles?.inputs ?? []).map((h: any) => ({
        id: h.id,
        label: h.label,
        expectedType: h.expectedType,
        isMandatory: !!h.isMandatory,
    }));
}

function resolveSourceOutput(
    node: WorkflowNode,
    sourceHandle: string | null | undefined,
    sharedRegistry: Record<string, NodeSharedDef<any>>,
    models: AiModel[],
): ResolvedOutput | null {
    if (node.type === 'ai_generator') {
        const modelId = (node.data as any)?.config?.model_id ?? (node.data as any)?.model_id;
        const model = modelId ? models.find((m) => m.id === Number(modelId)) : null;
        const handles = model?.outputs_schema?.handles ?? [];
        const visible = handles.filter((h) => h.is_visible !== false);
        const match =
            visible.find((h) => (h.api_mapping_key || h.name || 'output') === sourceHandle) ?? visible[0];
        if (!match) return null;
        return { id: match.api_mapping_key || match.name || 'output', dataType: match.type as NodeDataType };
    }

    const def = sharedRegistry[node.type];
    if (!def) return null;
    const outputs = def.handles?.outputs ?? [];
    const match = (outputs as any[]).find((o) => o.id === sourceHandle) ?? outputs[0];
    if (!match) return null;
    return { id: match.id, dataType: match.dataType };
}

function findEdgesForInput(
    node: WorkflowNode,
    input: ResolvedInput,
    incomingEdges: WorkflowEdge[],
): WorkflowEdge[] {
    if (node.type === 'compositor' && input.id === 'layers') {
        // Each layer is a separate edge, identified by its layer's
        // sourceHandleId (= the edge id — see orchestrator notes). Returning
        // the full set lets the caller validate every layer, not just the
        // first one.
        const layers: any[] = (node.data as any)?.config?.layers ?? [];
        const layerEdgeIds = new Set(layers.map((l) => l?.sourceHandleId).filter(Boolean));
        return incomingEdges.filter(
            (e) => (e.targetHandle === 'layers' || !e.targetHandle) && layerEdgeIds.has(e.id),
        );
    }

    const direct = incomingEdges.filter((e) => (e.targetHandle ?? '') === input.id);
    if (direct.length > 0) return direct;

    const defaultId = defaultInputIdForNodeType(node.type);
    if (defaultId === input.id) {
        return incomingEdges.filter((e) => !e.targetHandle);
    }
    return [];
}

function defaultInputIdForNodeType(nodeType: string): string | null {
    if (nodeType === 'blur') return 'image';
    if (nodeType === 'compositor') return 'layers';
    return null;
}

function nodeLabelOf(node: WorkflowNode): string {
    const label = (node.data as any)?.label;
    return typeof label === 'string' && label.length > 0 ? label : node.type;
}

function typeToString(t: NodeDataType | NodeDataType[] | string | string[]): string {
    if (Array.isArray(t)) return t.join(' | ');
    return String(t);
}
