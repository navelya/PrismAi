import { Workflow, WorkflowEdge, WorkflowNode } from '@/lib/nodes/types';

export interface WorkflowNodeUpdate {
    id: string;
    data?: Record<string, any>;
    position?: { x: number; y: number };
    /** Set to a group id to attach this node to a group, or null to detach. Omit to leave unchanged. */
    parentNode?: string | null;
}

export interface WorkflowNodeInputRef {
    source: string;
    sourceHandle?: string;
    targetHandle?: string;
}

export type WorkflowEvent =
    | {
        type: 'workflow.node_added';
        node: WorkflowNode;
        addedEdges: WorkflowEdge[];
        clientNodeId?: string;
    }
    | {
        type: 'workflow.node_updated';
        nodeId: string;
        updates: WorkflowNodeUpdate;
        addedEdges: WorkflowEdge[];
        removedEdgeIds: string[];
    }
    | {
        type: 'workflow.node_removed';
        nodeId: string;
        removedEdgeIds: string[];
    }
    | {
        type: 'workflow.sync_complete';
    };

export interface WorkflowPatch {
    addedNodes?: WorkflowNode[];
    addedEdges?: WorkflowEdge[];
    updatedNodes?: WorkflowNodeUpdate[];
    removedNodeIds?: string[];
    removedEdgeIds?: string[];
}

export function createEmptyWorkflow(): Workflow {
    return {
        name: 'Untitled Workflow',
        nodes: [],
        edges: []
    };
}

function dedupeById<T extends { id: string }>(items: T[]): T[] {
    const map = new Map<string, T>();
    for (const item of items) map.set(item.id, item);
    return [...map.values()];
}

export function mergeWorkflowPatches(
    base: WorkflowPatch | null | undefined,
    next: WorkflowPatch | null | undefined
): WorkflowPatch | null {
    if (!base && !next) return null;
    if (!base) return next || null;
    if (!next) return base;

    const removedNodeIds = dedupeById(
        [...(base.removedNodeIds || []), ...(next.removedNodeIds || [])].map((id) => ({ id }))
    ).map((x) => x.id);
    const removedEdgeIds = dedupeById(
        [...(base.removedEdgeIds || []), ...(next.removedEdgeIds || [])].map((id) => ({ id }))
    ).map((x) => x.id);

    return {
        addedNodes: dedupeById([...(base.addedNodes || []), ...(next.addedNodes || [])]),
        addedEdges: dedupeById([...(base.addedEdges || []), ...(next.addedEdges || [])]),
        updatedNodes: dedupeById([...(base.updatedNodes || []), ...(next.updatedNodes || [])]),
        removedNodeIds,
        removedEdgeIds
    };
}

export function applyWorkflowPatch(
    currentWorkflow: Workflow | null | undefined,
    patch: WorkflowPatch | null | undefined
): Workflow {
    const base = currentWorkflow || createEmptyWorkflow();
    if (!patch) return base;

    const removedNodeSet = new Set(patch.removedNodeIds || []);
    const removedEdgeSet = new Set(patch.removedEdgeIds || []);

    let nodes = (base.nodes || []).filter((node) => !removedNodeSet.has(node.id));
    let edges = (base.edges || []).filter((edge) =>
        !removedEdgeSet.has(edge.id) &&
        !removedNodeSet.has(edge.source) &&
        !removedNodeSet.has(edge.target)
    );

    if (patch.updatedNodes?.length) {
        const updateMap = new Map(patch.updatedNodes.map((u) => [u.id, u]));
        nodes = nodes.map((node) => {
            const update = updateMap.get(node.id);
            if (!update) return node;

            const next: WorkflowNode = {
                ...node,
                ...(update.position ? { position: update.position } : {}),
                data: {
                    ...node.data,
                    ...(update.data || {}),
                    config: {
                        ...node.data?.config,
                        ...(update.data?.config || {})
                    }
                }
            };

            // parentNode: explicit string sets membership, explicit null clears it,
            // undefined leaves it unchanged. We must omit the key when clearing,
            // not set it to undefined, otherwise React Flow still treats the node
            // as having an undefined parent and child layout breaks.
            if (update.parentNode === null) {
                delete (next as any).parentNode;
            } else if (typeof update.parentNode === 'string') {
                next.parentNode = update.parentNode;
            }

            return next;
        });
    }

    if (patch.addedNodes?.length) {
        nodes = dedupeById([...nodes, ...patch.addedNodes]);
    }

    // Build the post-patch group id set so we can drop any edge that
    // touches a group. Groups are non-executable — edges to/from them
    // would either crash dispatch or silently do nothing.
    const groupIds = new Set(nodes.filter((n) => n.type === 'group').map((n) => n.id));

    if (patch.addedEdges?.length) {
        const safeEdges = patch.addedEdges.filter((e) => {
            if (groupIds.has(e.source) || groupIds.has(e.target)) {
                console.warn(`[applyWorkflowPatch] Dropping edge ${e.id}: connects to a group node (groups are non-executable).`);
                return false;
            }
            return true;
        });
        edges = dedupeById([...edges, ...safeEdges]);
    }

    return {
        ...base,
        nodes,
        edges
    };
}
