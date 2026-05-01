import { Workflow, WorkflowEdge, WorkflowNode } from '@/lib/nodes/types';
import { applyWorkflowPatch, WorkflowNodeInputRef, WorkflowPatch } from '@/lib/workflow/workflow-patch';

interface AddNodeOp {
    id: string;
    type: string;
    node_type_id?: string;
    model_id?: number;
    position: { x: number; y: number };
    data: {
        config: Record<string, any>;
    };
    inputs?: WorkflowNodeInputRef[];
}

interface UpdateNodeOp {
    id: string;
    data?: {
        config?: Record<string, any>;
    };
    position?: { x: number; y: number };
    replace_inputs?: WorkflowNodeInputRef[];
}

interface RemoveNodeOp {
    id: string;
}

type GraphOpSuccess = {
    success: true;
    workflow: Workflow;
    patch: WorkflowPatch;
    resolvedNodeId?: string;
};

type GraphOpFailure = {
    success: false;
    error: string;
};

export type GraphOpResult = GraphOpSuccess | GraphOpFailure;

function resolveNodeId(id: string, idMap: Map<string, string>): string {
    return idMap.get(id) || id;
}

function ensureNodeExists(workflow: Workflow, nodeId: string): boolean {
    return workflow.nodes.some((n) => n.id === nodeId);
}

function defaultLabel(type: string): string {
    return type.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function buildInputEdges(targetId: string, inputs: WorkflowNodeInputRef[], idMap: Map<string, string>, workflow: Workflow): WorkflowEdge[] | null {
    const edges: WorkflowEdge[] = [];
    for (const input of inputs) {
        const resolvedSource = resolveNodeId(input.source, idMap);
        if (!ensureNodeExists(workflow, resolvedSource)) {
            return null;
        }
        edges.push({
            id: crypto.randomUUID(),
            source: resolvedSource,
            target: targetId,
            sourceHandle: input.sourceHandle || undefined,
            targetHandle: input.targetHandle || undefined
        });
    }
    return edges;
}

export function applyAddNodeOp(workflow: Workflow, op: AddNodeOp, idMap: Map<string, string>): GraphOpResult {
    if (idMap.has(op.id) || ensureNodeExists(workflow, op.id)) {
        return { success: false, error: `Node ID "${op.id}" already exists.` };
    }

    const resolvedNodeId = crypto.randomUUID();
    idMap.set(op.id, resolvedNodeId);

    const node: WorkflowNode = {
        id: resolvedNodeId,
        type: op.type as any,
        position: op.position,
        data: {
            label: defaultLabel(op.type),
            config: {
                ...(op.data?.config || {}),
                ...(op.node_type_id ? { node_type_id: op.node_type_id } : {}),
                ...(op.model_id ? { model_id: op.model_id } : {})
            },
            isNew: true
        }
    };

    const safeWorkflow = { ...workflow, nodes: [...(workflow.nodes || [])], edges: [...(workflow.edges || [])] };
    const addedEdges = buildInputEdges(resolvedNodeId, op.inputs || [], idMap, safeWorkflow);
    if (!addedEdges) {
        return {
            success: false,
            error: `Topological order violation: one or more input source nodes for "${op.id}" do not exist yet.`
        };
    }

    const patch: WorkflowPatch = {
        addedNodes: [node],
        addedEdges
    };
    const updatedWorkflow = applyWorkflowPatch(workflow, patch);

    return {
        success: true,
        workflow: updatedWorkflow,
        patch,
        resolvedNodeId
    };
}

export function applyUpdateNodeOp(workflow: Workflow, op: UpdateNodeOp, idMap: Map<string, string>): GraphOpResult {
    const nodeId = resolveNodeId(op.id, idMap);
    if (!ensureNodeExists(workflow, nodeId)) {
        return { success: false, error: `Node "${op.id}" was not found.` };
    }

    const currentIncoming = (workflow.edges || []).filter((e) => e.target === nodeId);
    let addedEdges: WorkflowEdge[] = [];
    let removedEdgeIds: string[] = [];

    if (op.replace_inputs) {
        const computed = buildInputEdges(nodeId, op.replace_inputs, idMap, workflow);
        if (!computed) {
            return {
                success: false,
                error: `Invalid update for "${op.id}": replace_inputs references unknown source node IDs.`
            };
        }
        addedEdges = computed;
        removedEdgeIds = currentIncoming.map((e) => e.id);
    }

    const patch: WorkflowPatch = {
        updatedNodes: [{
            id: nodeId,
            ...(op.data ? { data: op.data } : {}),
            ...(op.position ? { position: op.position } : {})
        }],
        addedEdges,
        removedEdgeIds
    };
    const updatedWorkflow = applyWorkflowPatch(workflow, patch);

    return {
        success: true,
        workflow: updatedWorkflow,
        patch
    };
}

export function applyRemoveNodeOp(workflow: Workflow, op: RemoveNodeOp, idMap: Map<string, string>): GraphOpResult {
    const nodeId = resolveNodeId(op.id, idMap);
    if (!ensureNodeExists(workflow, nodeId)) {
        return { success: false, error: `Node "${op.id}" was not found.` };
    }

    const removedEdgeIds = (workflow.edges || [])
        .filter((e) => e.source === nodeId || e.target === nodeId)
        .map((e) => e.id);

    const patch: WorkflowPatch = {
        removedNodeIds: [nodeId],
        removedEdgeIds
    };
    const updatedWorkflow = applyWorkflowPatch(workflow, patch);

    return {
        success: true,
        workflow: updatedWorkflow,
        patch
    };
}
