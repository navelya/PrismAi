import ELK, { ElkNode, ElkEdge } from 'elkjs/lib/elk.bundled.js';
import { WorkflowNode, WorkflowEdge } from '../nodes/types';

const elk = new ELK();

/** * ELK Layout Configuration 
 * Optimized for Left-to-Right flow with dynamic node sizes.
 */
const ELK_OPTIONS = {
    'elk.algorithm': 'layered',
    'elk.direction': 'RIGHT',
    'elk.spacing.nodeNode': '60',
    'elk.layered.spacing.nodeNodeBetweenLayers': '120',
    'elk.padding': '[top=50,left=50,bottom=50,right=50]',
    'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
    'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
    'org.eclipse.elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED',
    // Without these, disconnected subgraphs (e.g. an orphan node from a duplicate)
    // all get placed near the origin and overlap on top of each other.
    'elk.separateConnectedComponents': 'true',
    'elk.spacing.componentComponent': '80',
};

/**
 * Main auto-layout function.
 * Uses 'measured' dimensions from the UI to prevent overlaps.
 *
 * Group handling: a group container is laid out as a single super-node.
 * Its children are EXCLUDED from the ELK input (their positions are
 * parent-relative and follow the group automatically), and edges that
 * touch a grouped child are remapped so their endpoint is the parent
 * group instead. Edges between siblings of the same group collapse to
 * self-loops and are dropped.
 */
export async function autoLayoutNodesAsync(
    nodes: any[],
    edges: WorkflowEdge[]
): Promise<Map<string, { x: number; y: number }>> {
    if (nodes.length === 0) return new Map();

    // Build a child → parent-group map (only when the parent actually exists).
    const groupIds = new Set(
        nodes.filter((n: any) => n.type === 'group_container').map((n: any) => n.id),
    );
    const parentByChild = new Map<string, string>();
    nodes.forEach((n: any) => {
        if (n.parentNode && groupIds.has(n.parentNode)) {
            parentByChild.set(n.id, n.parentNode);
        }
    });

    // ELK lays out groups + ungrouped nodes; grouped children are skipped.
    const layoutNodes = nodes.filter((n: any) => !parentByChild.has(n.id));

    const elkNodes: ElkNode[] = layoutNodes.map((node) => ({
        id: node.id,
        width: node.measured?.width ?? node.width ?? 250,
        height: node.measured?.height ?? node.height ?? 150,
        properties: { 'portConstraints': 'FREE' },
    }));

    const layoutNodeIds = new Set(layoutNodes.map((n: any) => n.id));

    // Remap edge endpoints: any endpoint that points at a grouped child
    // becomes its parent group, so ELK sees the topology at the group level.
    // Then drop dangling edges, self-loops (intra-group edges), and dedupe
    // by (source, target) so two edges from the same group to the same
    // outside target don't double-influence layout.
    const remappedSeen = new Set<string>();
    const elkEdges: ElkEdge[] = edges
        .map(edge => ({
            ...edge,
            source: parentByChild.get(edge.source) ?? edge.source,
            target: parentByChild.get(edge.target) ?? edge.target,
        }))
        .filter(edge => layoutNodeIds.has(edge.source) && layoutNodeIds.has(edge.target))
        .filter(edge => edge.source !== edge.target)
        .filter(edge => {
            const key = `${edge.source}->${edge.target}`;
            if (remappedSeen.has(key)) return false;
            remappedSeen.add(key);
            return true;
        })
        .map(edge => ({
            id: edge.id,
            sources: [edge.source],
            targets: [edge.target],
        }));

    const dropped = edges.length - elkEdges.length;
    if (dropped > 0) {
        // eslint-disable-next-line no-console
        console.warn(`[autoLayout] ${dropped} edge(s) dropped or merged (dangling, intra-group, or duplicate after group remap)`);
    }

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
