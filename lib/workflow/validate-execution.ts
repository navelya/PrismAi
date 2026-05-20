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
    runMode: 'all' | 'solo' | 'chain';
    targetNodeId: string | null;
    /** Node ids that have a usable cached completed result (for solo/chain runs). */
    completedNodeIds: Set<string>;
    sharedRegistry: Record<string, NodeSharedDef<any>>;
    /** Used to resolve the dynamic ai_generator handles. */
    models: AiModel[];
};

export function validateExecution(ctx: ValidationContext): ValidationError[] {
    const { workflow, runMode, targetNodeId, completedNodeIds, sharedRegistry, models } = ctx;
    const errors: ValidationError[] = [];

    const executing = computeExecutingNodes(workflow, runMode, targetNodeId);
    const executingIds = new Set(executing.map((n) => n.id));
    const nodeById = new Map(workflow.nodes.map((n) => [n.id, n]));

    for (const node of executing) {
        if (node.type === 'group_container') continue;

        const inputs = resolveNodeInputs(node, sharedRegistry, models);
        const incomingEdges = workflow.edges.filter((e) => e.target === node.id);

        for (const input of inputs) {
            const edge = findEdgeForInput(node, input, incomingEdges);

            if (!edge) {
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

            if (!executingIds.has(sourceNode.id) && !completedNodeIds.has(sourceNode.id)) {
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

    return errors;
}

function computeExecutingNodes(
    workflow: Workflow,
    runMode: 'all' | 'solo' | 'chain',
    targetNodeId: string | null,
): WorkflowNode[] {
    if (runMode === 'all') {
        return workflow.nodes.filter((n) => n.type !== 'group_container');
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

function findEdgeForInput(
    node: WorkflowNode,
    input: ResolvedInput,
    incomingEdges: WorkflowEdge[],
): WorkflowEdge | null {
    if (node.type === 'compositor' && input.id === 'layers') {
        const layers: any[] = (node.data as any)?.config?.layers ?? [];
        const layerEdgeIds = new Set(layers.map((l) => l?.sourceHandleId).filter(Boolean));
        const layerEdges = incomingEdges.filter(
            (e) => (e.targetHandle === 'layers' || !e.targetHandle) && layerEdgeIds.has(e.id),
        );
        return layerEdges[0] ?? null;
    }

    return (
        incomingEdges.find((e) => (e.targetHandle ?? '') === input.id) ??
        incomingEdges.find((e) => !e.targetHandle && input.id === defaultInputIdForNodeType(node.type)) ??
        null
    );
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
