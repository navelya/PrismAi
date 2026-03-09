import ELK, { ElkNode, ElkEdge } from 'elkjs/lib/elk.bundled.js';
import { WorkflowNode, WorkflowEdge } from '../nodes/types';

const elk = new ELK();

/** * ELK Layout Configuration 
 * Optimized for Left-to-Right flow with dynamic node sizes.
 */
const ELK_OPTIONS = {
    'elk.algorithm': 'layered',
    'elk.direction': 'RIGHT',
    'elk.spacing.nodeNode': '40', // Vertical gap between nodes
    'elk.layered.spacing.nodeNodeBetweenLayers': '100', // Horizontal gap between columns
    'elk.padding': '[top=50,left=50,bottom=50,right=50]',
    'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
    'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
    'org.eclipse.elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
};

/**
 * Main auto-layout function.
 * Uses 'measured' dimensions from the UI to prevent overlaps.
 */
export async function autoLayoutNodesAsync(
    nodes: any[],
    edges: WorkflowEdge[]
): Promise<Map<string, { x: number; y: number }>> {
    if (nodes.length === 0) return new Map();

    // Convert nodes to ELK format using actual measured dimensions
    const elkNodes: ElkNode[] = nodes.map((node) => ({
        id: node.id,
        // CRITICAL: Use measured dimensions to prevent overlaps
        width: node.measured?.width ?? node.width ?? 250,
        height: node.measured?.height ?? node.height ?? 150,
        properties: { 'portConstraints': 'FREE' }
    }));

    const elkEdges: ElkEdge[] = edges.map((edge) => ({
        id: edge.id,
        sources: [edge.source],
        targets: [edge.target],
    }));

    const graph: any = {
        id: 'root',
        layoutOptions: ELK_OPTIONS,
        children: elkNodes,
        edges: elkEdges,
    };

    try {
        const layoutedGraph = await elk.layout(graph);
        const positions = new Map<string, { x: number; y: number }>();

        layoutedGraph.children?.forEach((node: any) => {
            if (node.x !== undefined && node.y !== undefined) {
                positions.set(node.id, { x: node.x, y: node.y });
            }
        });

        return positions;
    } catch (error) {
        console.error('ELK Layout failed, using fallback:', error);
        return fallbackLayout(nodes);
    }
}

/** Simple grid fallback if the engine fails */
function fallbackLayout(nodes: WorkflowNode[]): Map<string, { x: number; y: number }> {
    const positions = new Map<string, { x: number; y: number }>();
    nodes.forEach((node, i) => {
        positions.set(node.id, { x: (i % 3) * 300, y: Math.floor(i / 3) * 200 });
    });
    return positions;
}
