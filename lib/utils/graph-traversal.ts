import { WorkflowEdge, WorkflowNode } from "@/lib/nodes/types";

/**
 * Get all downstream descendants of a given node (including the node itself).
 * Using Breadth-First Search (BFS) to traverse the graph.
 */
export function getDescendants(nodeId: string, edges: WorkflowEdge[]): Set<string> {
    const descendants = new Set<string>();
    const queue = [nodeId];

    // Map of parent -> children for faster lookup
    const childrenMap = new Map<string, string[]>();
    edges.forEach(edge => {
        if (!childrenMap.has(edge.source)) {
            childrenMap.set(edge.source, []);
        }
        childrenMap.get(edge.source)?.push(edge.target);
    });

    while (queue.length > 0) {
        const current = queue.shift()!;
        if (descendants.has(current)) continue;

        descendants.add(current);

        const children = childrenMap.get(current) || [];
        children.forEach(child => queue.push(child));
    }

    return descendants;
}

/**
 * Get the execution order for a partial run.
 * Returns only the invalidated nodes in topological order.
 * Ensures upstream dependencies are satisfied (or assumed cached).
 */
export function getPartialExecutionOrder(
    workflow: { nodes: WorkflowNode[], edges: WorkflowEdge[] },
    startNodeId: string
): WorkflowNode[] {
    const descendants = getDescendants(startNodeId, workflow.edges);

    // Sort all nodes topologically
    // But filter to keep only descendants

    // Build adjacency list and in-degree for the SUBGRAPH of descendants?
    // Or just filter a full topological sort?
    // Filtering a full topological sort is safer to respect overall order.

    // 1. Build full dependency graph
    const inDegree = new Map<string, number>();
    const children = new Map<string, string[]>();

    workflow.nodes.forEach(node => {
        inDegree.set(node.id, 0);
        children.set(node.id, []);
    });

    workflow.edges.forEach(edge => {
        // Only count edges where both source and target exist (sanity check)
        if (inDegree.has(edge.target)) {
            inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
            children.get(edge.source)?.push(edge.target);
        }
    });

    // 2. Kahn's Algorithm for Topological Sort
    const queue: string[] = [];
    const sortedOrder: string[] = [];

    // Initialize queue with nodes having 0 in-degree
    workflow.nodes.forEach(node => {
        if ((inDegree.get(node.id) || 0) === 0) {
            queue.push(node.id);
        }
    });

    while (queue.length > 0) {
        const nodeId = queue.shift()!;
        sortedOrder.push(nodeId);

        const childIds = children.get(nodeId) || [];
        childIds.forEach(childId => {
            const currentDegree = (inDegree.get(childId) || 0) - 1;
            inDegree.set(childId, currentDegree);
            if (currentDegree === 0) {
                queue.push(childId);
            }
        });
    }

    // 3. Filter for descendants
    const executionList = sortedOrder
        .filter(id => descendants.has(id))
        .map(id => workflow.nodes.find(n => n.id === id)!)
        .filter(Boolean); // Safety filter

    return executionList;
}
