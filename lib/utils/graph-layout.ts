import ELK from 'elkjs/lib/elk.bundled.js';
import dagre from 'dagre';
import * as d3 from 'd3-hierarchy';
import { WorkflowNode, WorkflowEdge } from '../nodes/types';

// =============================================================================
// TYPES
// =============================================================================

/** Available layout engines */
export type LayoutEngine = 'elk' | 'dagre' | 'd3-hierarchy';

/** Position result type */
type PositionMap = Map<string, { x: number; y: number }>;

// =============================================================================
// CONSTANTS
// =============================================================================

/** Default node dimensions for layout calculation */
const NODE_WIDTH = 220;
const NODE_HEIGHT = 80;

/** Spacing between nodes */
const SPACING_HORIZONTAL = 150;
const SPACING_VERTICAL = 100;

// =============================================================================
// ELK LAYOUT ENGINE
// =============================================================================

const elk = new ELK();

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

async function layoutWithELK(
    nodes: WorkflowNode[],
    edges: WorkflowEdge[]
): Promise<PositionMap> {
    // Convert to ELK format with explicit Ports
    const elkNodes = nodes.map((node) => {
        const inputHandles = edges
            .filter(e => e.target === node.id && e.targetHandle)
            .map(e => e.targetHandle!)
            .filter((value, index, self) => self.indexOf(value) === index)
            .sort();

        const outputHandles = edges
            .filter(e => e.source === node.id && e.sourceHandle)
            .map(e => e.sourceHandle!)
            .filter((value, index, self) => self.indexOf(value) === index)
            .sort();

        const ports = [
            ...inputHandles.map((id) => ({
                id,
                properties: { side: 'WEST', index: inputHandles.indexOf(id) }
            })),
            ...outputHandles.map((id) => ({
                id,
                properties: { side: 'EAST', index: outputHandles.indexOf(id) }
            }))
        ];

        return {
            id: node.id,
            width: NODE_WIDTH,
            height: NODE_HEIGHT,
            ports: ports,
            properties: { 'portConstraints': 'FIXED_ORDER' }
        };
    });

    const elkEdges = edges.map((edge) => ({
        id: edge.id,
        sources: [edge.source],
        targets: [edge.target],
        sourcePort: edge.sourceHandle,
        targetPort: edge.targetHandle,
    }));

    const elkGraph = {
        id: 'root',
        layoutOptions: elkOptions,
        children: elkNodes,
        edges: elkEdges,
    };

    const layoutedGraph = await elk.layout(elkGraph);
    const positions: PositionMap = new Map();

    if (layoutedGraph.children) {
        layoutedGraph.children.forEach((child: any) => {
            positions.set(child.id, { x: child.x || 0, y: child.y || 0 });
        });
    }

    return positions;
}

// =============================================================================
// DAGRE LAYOUT ENGINE
// =============================================================================

function layoutWithDagre(
    nodes: WorkflowNode[],
    edges: WorkflowEdge[]
): PositionMap {
    const g = new dagre.graphlib.Graph();

    // Configure graph for left-to-right flow
    g.setGraph({
        rankdir: 'LR',                    // Left to Right
        nodesep: SPACING_VERTICAL,        // Vertical spacing
        ranksep: SPACING_HORIZONTAL,      // Horizontal spacing between layers
        marginx: 50,
        marginy: 50,
    });

    g.setDefaultEdgeLabel(() => ({}));

    // Add nodes
    nodes.forEach((node) => {
        g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    });

    // Add edges
    edges.forEach((edge) => {
        g.setEdge(edge.source, edge.target);
    });

    // Run layout
    dagre.layout(g);

    // Extract positions
    const positions: PositionMap = new Map();
    nodes.forEach((node) => {
        const nodeWithPosition = g.node(node.id);
        if (nodeWithPosition) {
            // Dagre returns center positions, so adjust to top-left
            positions.set(node.id, {
                x: nodeWithPosition.x - NODE_WIDTH / 2,
                y: nodeWithPosition.y - NODE_HEIGHT / 2,
            });
        }
    });

    return positions;
}

// =============================================================================
// D3-HIERARCHY LAYOUT ENGINE
// =============================================================================

interface TreeNode {
    id: string;
    children: TreeNode[];
}

function layoutWithD3Hierarchy(
    nodes: WorkflowNode[],
    edges: WorkflowEdge[]
): PositionMap {
    const positions: PositionMap = new Map();

    if (nodes.length === 0) return positions;

    // Build adjacency list
    const childrenMap = new Map<string, string[]>();
    const hasParent = new Set<string>();

    nodes.forEach(n => childrenMap.set(n.id, []));

    edges.forEach(edge => {
        childrenMap.get(edge.source)?.push(edge.target);
        hasParent.add(edge.target);
    });

    // Find root nodes (nodes with no parents)
    const roots = nodes.filter(n => !hasParent.has(n.id));

    // If no clear roots, use first node (DAG might have cycles or all connected)
    if (roots.length === 0 && nodes.length > 0) {
        roots.push(nodes[0]);
    }

    // Build tree structure (handles forests - multiple roots)
    function buildTree(nodeId: string, visited = new Set<string>()): TreeNode {
        if (visited.has(nodeId)) {
            return { id: nodeId, children: [] }; // Prevent cycles
        }
        visited.add(nodeId);

        const children = childrenMap.get(nodeId) || [];
        return {
            id: nodeId,
            children: children.map(childId => buildTree(childId, visited))
        };
    }

    // Create a virtual root to handle multiple roots (forest)
    const virtualRoot: TreeNode = {
        id: '__virtual_root__',
        children: roots.map(r => buildTree(r.id))
    };

    // Create d3 hierarchy
    const hierarchy = d3.hierarchy(virtualRoot);

    // Create tree layout (horizontal - swap x and y for left-to-right)
    const treeLayout = d3.tree<TreeNode>()
        .nodeSize([NODE_HEIGHT + SPACING_VERTICAL, NODE_WIDTH + SPACING_HORIZONTAL]);

    const treeData = treeLayout(hierarchy);

    // Extract positions (swap x/y for horizontal layout, skip virtual root)
    treeData.descendants().forEach((d) => {
        if (d.data.id !== '__virtual_root__') {
            // d.y is depth (horizontal), d.x is breadth (vertical)
            positions.set(d.data.id, {
                x: d.y + 50,  // Add margin
                y: d.x + 300, // Center vertically and add margin
            });
        }
    });

    // Handle nodes not in tree (disconnected nodes)
    let yOffset = 600;
    nodes.forEach(node => {
        if (!positions.has(node.id)) {
            positions.set(node.id, { x: 50, y: yOffset });
            yOffset += NODE_HEIGHT + SPACING_VERTICAL;
        }
    });

    return positions;
}

// =============================================================================
// MAIN AUTO LAYOUT FUNCTION
// =============================================================================

/**
 * Main auto-layout function supporting multiple layout engines.
 * All engines produce left-to-right flow layouts.
 * 
 * @param nodes - Workflow nodes to layout
 * @param edges - Workflow edges connecting nodes
 * @param engine - Layout engine to use ('elk' | 'dagre' | 'd3-hierarchy')
 * @returns Map of node IDs to their new positions
 */
export async function autoLayoutNodesAsync(
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
    engine: LayoutEngine = 'elk'
): Promise<PositionMap> {
    if (nodes.length === 0) {
        return new Map();
    }

    try {
        switch (engine) {
            case 'elk':
                return await layoutWithELK(nodes, edges);
            case 'dagre':
                return layoutWithDagre(nodes, edges);
            case 'd3-hierarchy':
                return layoutWithD3Hierarchy(nodes, edges);
            default:
                console.warn(`Unknown layout engine: ${engine}, falling back to ELK`);
                return await layoutWithELK(nodes, edges);
        }
    } catch (error) {
        console.error(`Layout error with ${engine}:`, error);
        return fallbackLayout(nodes);
    }
}

/**
 * Synchronous wrapper for auto-layout (legacy compatibility)
 */
export function autoLayoutNodes(
    nodes: WorkflowNode[],
    edges: WorkflowEdge[],
): PositionMap {
    console.warn('autoLayoutNodes is now async. Use autoLayoutNodesAsync for better layouts.');
    return fallbackLayout(nodes);
}

/**
 * Simple fallback layout for error cases
 */
function fallbackLayout(nodes: WorkflowNode[]): PositionMap {
    const positions: PositionMap = new Map();
    const spacing = 250;

    nodes.forEach((node, index) => {
        positions.set(node.id, {
            x: 100 + (index % 4) * spacing,
            y: 100 + Math.floor(index / 4) * 150,
        });
    });

    return positions;
}