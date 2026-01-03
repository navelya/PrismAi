import { WorkflowNode, WorkflowEdge } from '../nodes/types';

/**
 * Graph layout configuration
 */
interface LayoutConfig {
    horizontalSpacing: number; // Horizontal spacing between layers (left-to-right)
    verticalSpacing: number;   // Vertical spacing between nodes in same layer
    startX: number;            // Starting X position
    startY: number;            // Starting Y position
}

const DEFAULT_CONFIG: LayoutConfig = {
    horizontalSpacing: 400,    // Space between layers (left-to-right progression)
    verticalSpacing: 150,      // Space between nodes in same layer (vertical distribution)
    startX: 100,
    startY: 100,
};

/**
 * Build adjacency list for graph traversal
 */
function buildDependencyGraph(edges: WorkflowEdge[]): {
    incoming: Map<string, string[]>;
    outgoing: Map<string, string[]>;
    inDegree: Map<string, number>;
} {
    const incoming = new Map<string, string[]>();
    const outgoing = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    edges.forEach(edge => {
        // Add to outgoing edges
        if (!outgoing.has(edge.source)) {
            outgoing.set(edge.source, []);
        }
        outgoing.get(edge.source)!.push(edge.target);

        // Add to incoming edges
        if (!incoming.has(edge.target)) {
            incoming.set(edge.target, []);
        }
        incoming.get(edge.target)!.push(edge.source);

        // Update in-degree
        inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
    });

    return { incoming, outgoing, inDegree };
}

/**
 * Assign nodes to hierarchical layers using breadth-first traversal
 */
function assignLayers(
    nodes: WorkflowNode[],
    edges: WorkflowEdge[]
): Map<string, number> {
    const { incoming, outgoing, inDegree } = buildDependencyGraph(edges);
    const layers = new Map<string, number>();

    // Initialize all nodes with in-degree
    const nodeIds = new Set(nodes.map(n => n.id));
    nodeIds.forEach(id => {
        if (!inDegree.has(id)) {
            inDegree.set(id, 0);
        }
    });

    // Find root nodes (no incoming edges)
    const roots = nodes.filter(node => (inDegree.get(node.id) || 0) === 0);

    // BFS to assign layers
    const queue: Array<{ id: string; layer: number }> = roots.map(node => ({
        id: node.id,
        layer: 0
    }));

    const visited = new Set<string>();

    while (queue.length > 0) {
        const { id, layer } = queue.shift()!;

        if (visited.has(id)) continue;
        visited.add(id);

        layers.set(id, layer);

        // Add children to queue
        const children = outgoing.get(id) || [];
        children.forEach(childId => {
            if (!visited.has(childId)) {
                // Calculate the maximum layer among all parents
                const parents = incoming.get(childId) || [];
                const parentLayers = parents
                    .filter(p => layers.has(p))
                    .map(p => layers.get(p)!);

                // Only add to queue if all parents have been processed
                if (parentLayers.length === parents.length) {
                    const maxParentLayer = Math.max(...parentLayers, -1);
                    queue.push({ id: childId, layer: maxParentLayer + 1 });
                }
            }
        });
    }

    // Handle disconnected nodes (nodes not reached by BFS)
    nodes.forEach(node => {
        if (!layers.has(node.id)) {
            // Find the maximum layer and place disconnected nodes there
            const maxLayer = Math.max(...Array.from(layers.values()), -1);
            layers.set(node.id, maxLayer + 1);
        }
    });

    return layers;
}

/**
 * Calculate final node positions based on layer assignment
 */
function calculateNodePositions(
    nodes: WorkflowNode[],
    layers: Map<string, number>,
    edges: WorkflowEdge[],
    config: LayoutConfig = DEFAULT_CONFIG
): Map<string, { x: number; y: number }> {
    const positions = new Map<string, { x: number; y: number }>();

    // Group nodes by layer
    const layerGroups = new Map<number, WorkflowNode[]>();
    nodes.forEach(node => {
        const layer = layers.get(node.id) || 0;
        if (!layerGroups.has(layer)) {
            layerGroups.set(layer, []);
        }
        layerGroups.get(layer)!.push(node);
    });

    // Sort layers
    const sortedLayers = Array.from(layerGroups.keys()).sort((a, b) => a - b);

    // Build incoming/outgoing for ordering within layers
    const { incoming } = buildDependencyGraph(edges);

    // Position nodes layer by layer
    sortedLayers.forEach(layer => {
        const nodesInLayer = layerGroups.get(layer)!;

        // Sort nodes within layer to minimize edge crossings
        // Nodes with common parents should be grouped together
        const sortedNodes = [...nodesInLayer].sort((a, b) => {
            const aParents = incoming.get(a.id) || [];
            const bParents = incoming.get(b.id) || [];

            // If they share parents, keep them together
            const sharedParents = aParents.filter(p => bParents.includes(p));
            if (sharedParents.length > 0) {
                return 0;
            }

            // Otherwise sort by first parent ID
            const aFirstParent = aParents[0] || '';
            const bFirstParent = bParents[0] || '';
            return aFirstParent.localeCompare(bFirstParent);
        });

        // Calculate positions for this layer (LEFT-TO-RIGHT orientation)
        // Layers progress horizontally (x-axis), nodes distributed vertically (y-axis)
        const layerHeight = (nodesInLayer.length - 1) * config.verticalSpacing;
        const startY = config.startY - layerHeight / 2;
        const x = config.startX + layer * config.horizontalSpacing;

        sortedNodes.forEach((node, index) => {
            const y = startY + index * config.verticalSpacing;
            positions.set(node.id, { x, y });
        });
    });

    return positions;
}

/**
 * Main auto-layout function
 * Takes workflow nodes and edges, returns updated positions for all nodes
 */
export function autoLayoutNodes(
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
    config?: Partial<LayoutConfig>
): Map<string, { x: number; y: number }> {
    if (nodes.length === 0) {
        return new Map();
    }

    const layoutConfig = { ...DEFAULT_CONFIG, ...config };

    // Step 1: Assign nodes to layers
    const layers = assignLayers(nodes, edges);

    // Step 2: Calculate positions
    const positions = calculateNodePositions(nodes, layers, edges, layoutConfig);

    return positions;
}
