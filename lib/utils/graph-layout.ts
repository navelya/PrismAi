import ELK from 'elkjs/lib/elk.bundled.js';
import { WorkflowNode, WorkflowEdge } from '../nodes/types';

// ELK.js instance
const elk = new ELK();

/**
 * ELK.js layout configuration for DAG-style left-to-right layout
 * Updated with port constraints to prevent crossing lines
 */
const elkOptions = {
    'elk.algorithm': 'layered',
    'elk.direction': 'RIGHT',
    'elk.spacing.nodeNode': '100',
    'elk.layered.spacing.nodeNodeBetweenLayers': '150',
    'elk.layered.spacing.edgeNodeBetweenLayers': '50',
    'elk.spacing.componentComponent': '100',
    'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
    'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
    'org.eclipse.elk.portConstraints': 'FIXED_ORDER',
    'org.eclipse.elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
};

/**
 * Default node dimensions for ELK layout calculation
 */
const NODE_WIDTH = 220;
const NODE_HEIGHT = 80;

/**
 * Main auto-layout function using ELK.js
 * Takes workflow nodes and edges, returns updated positions for all nodes
 */
export async function autoLayoutNodesAsync(
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
): Promise<Map<string, { x: number; y: number }>> {
    if (nodes.length === 0) {
        return new Map();
    }

    // 1. Convert to ELK format with explicit Ports
    const elkNodes = nodes.map((node) => {
        // Collect all input handles (targets) connected to this node
        const inputHandles = edges
            .filter(e => e.target === node.id && e.targetHandle)
            .map(e => e.targetHandle!)
            // Unique inputs only
            .filter((value, index, self) => self.indexOf(value) === index)
            // Sort alphabetically (BASE comes before OVER) to ensure top-to-bottom order
            .sort();

        // Collect all output handles (sources) connected to this node
        const outputHandles = edges
            .filter(e => e.source === node.id && e.sourceHandle)
            .map(e => e.sourceHandle!)
            .filter((value, index, self) => self.indexOf(value) === index)
            .sort();

        // Create Port objects for ELK
        const ports = [
            // Inputs on the Left (WEST)
            ...inputHandles.map((id) => ({
                id,
                properties: {
                    side: 'WEST',
                    index: inputHandles.indexOf(id) // Force vertical order
                }
            })),
            // Outputs on the Right (EAST)
            ...outputHandles.map((id) => ({
                id,
                properties: {
                    side: 'EAST',
                    index: outputHandles.indexOf(id)
                }
            }))
        ];

        return {
            id: node.id,
            width: NODE_WIDTH,
            height: NODE_HEIGHT,
            ports: ports,
            properties: {
                'portConstraints': 'FIXED_ORDER'
            }
        };
    });

    // 2. Prepare Edges with Port References
    const elkEdges = edges.map((edge) => ({
        id: edge.id,
        sources: [edge.source],
        targets: [edge.target],
        // Link specific handles if they exist
        sourcePort: edge.sourceHandle,
        targetPort: edge.targetHandle,
    }));

    const elkGraph = {
        id: 'root',
        layoutOptions: elkOptions,
        children: elkNodes,
        edges: elkEdges,
    };

    try {
        // Run ELK layout
        const layoutedGraph = await elk.layout(elkGraph);

        // Extract positions from layouted graph
        const positions = new Map<string, { x: number; y: number }>();

        if (layoutedGraph.children) {
            layoutedGraph.children.forEach((child: any) => {
                positions.set(child.id, {
                    x: child.x || 0,
                    y: child.y || 0,
                });
            });
        }

        return positions;
    } catch (error) {
        console.error('ELK layout error:', error);
        // Fallback to simple layout
        return fallbackLayout(nodes);
    }
}

/**
 * Synchronous wrapper for auto-layout (legacy compatibility)
 * Note: This returns a promise, callers should await it
 */
export function autoLayoutNodes(
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
): Map<string, { x: number; y: number }> {
    // For synchronous contexts, provide a simple fallback
    // The calling code should be updated to use the async version
    console.warn('autoLayoutNodes is now async. Use autoLayoutNodesAsync for better layouts.');
    return fallbackLayout(nodes);
}

/**
 * Simple fallback layout for error cases or synchronous usage
 */
function fallbackLayout(nodes: WorkflowNode[]): Map<string, { x: number; y: number }> {
    const positions = new Map<string, { x: number; y: number }>();
    const spacing = 250;

    nodes.forEach((node, index) => {
        positions.set(node.id, {
            x: 100 + (index % 4) * spacing,
            y: 100 + Math.floor(index / 4) * 150,
        });
    });

    return positions;
}