import ELK from 'elkjs/lib/elk.bundled.js';
import type { WorkflowNode, WorkflowEdge } from '@/lib/nodes/types';
import { getNodeDimensions } from './layout-utils';

const elk = new ELK();

const ELK_OPTIONS = {
    'elk.algorithm': 'layered',
    'elk.direction': 'RIGHT',
    'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    'elk.spacing.nodeNode': '60',
    'elk.layered.spacing.nodeNodeBetweenLayers': '120',
    'elk.padding': '[top=50,left=50,bottom=50,right=50]',
    'elk.spacing.componentComponent': '80',
    'elk.separateConnectedComponents': 'true',
    'elk.layered.layering.strategy': 'INTERACTIVE',
    'elk.layered.nodePlacement.strategy': 'INTERACTIVE',
    'elk.layered.crossingMinimization.strategy': 'INTERACTIVE',
    'elk.interactive': 'true',
};

const GROUP_LAYOUT_OPTIONS = {
    'elk.nodeSize.constraints': 'NODE_LABELS PORTS MINIMUM_SIZE',
    // Top padding is larger to leave room for the group's header/label.
    'elk.padding': '[top=56,left=24,bottom=24,right=24]',
    'elk.spacing.nodeNode': '60',
};

export interface LayoutPatchInput {
    existingNodes: WorkflowNode[];
    existingEdges: WorkflowEdge[];
    newNodes: WorkflowNode[];
    newEdges: WorkflowEdge[];
}

/**
 * Compute positions for `newNodes` that flow topologically around the
 * existing canvas. Existing node positions are guaranteed unchanged:
 * ELK runs with INTERACTIVE strategies (seeded with existing x/y), and
 * existing nodes are excluded from the returned Map, so the caller
 * never has positions to apply to them — their canvas positions remain
 * untouched even if ELK's INTERACTIVE strategies drift slightly.
 *
 * Returns Map<nodeId, {x, y}> for NEW nodes only. Children inside groups
 * have positions RELATIVE to their parent (React Flow's `parentNode`
 * convention). Top-level nodes have absolute canvas positions.
 *
 * On ELK failure, falls back to a simple "place new nodes to the right
 * of the existing canvas bounding box" rule so the chat tool call
 * doesn't fail because of a layout glitch.
 */
export async function layoutPatchAsync(
    input: LayoutPatchInput,
): Promise<Map<string, { x: number; y: number }>> {
    const { existingNodes, existingEdges, newNodes, newEdges } = input;
    if (newNodes.length === 0) return new Map();

    const allNodes = [...existingNodes, ...newNodes];
    const allEdges = [...existingEdges, ...newEdges];
    const existingIds = new Set(existingNodes.map((n) => n.id));

    // Build a parent → children index so we can attach children inside
    // their parent group's ELK node hierarchically.
    const childrenByParent = new Map<string, WorkflowNode[]>();
    const topLevel: WorkflowNode[] = [];
    for (const n of allNodes) {
        const parent = n.parentNode;
        if (parent) {
            const arr = childrenByParent.get(parent) ?? [];
            arr.push(n);
            childrenByParent.set(parent, arr);
        } else {
            topLevel.push(n);
        }
    }

    const toElkNode = (n: WorkflowNode): any => {
        const { width, height } = getNodeDimensions(n.type);
        const node: any = {
            id: n.id,
            width,
            height,
            properties: { portConstraints: 'FREE' },
        };
        // Seed real x/y for existing nodes so INTERACTIVE strategies
        // honor them as anchors. New nodes have no x/y — ELK computes them.
        if (existingIds.has(n.id)) {
            node.x = n.position?.x ?? 0;
            node.y = n.position?.y ?? 0;
        }
        const kids = childrenByParent.get(n.id);
        if (kids && kids.length > 0) {
            node.children = kids.map(toElkNode);
            node.layoutOptions = GROUP_LAYOUT_OPTIONS;
        }
        return node;
    };

    const elkChildren = topLevel.map(toElkNode);

    // ELK edges. Filter to nodes we're laying out (defensive — there
    // shouldn't be dangling edges by the time we get here). Drop
    // self-loops (a node connected to itself would crash layered).
    const allNodeIds = new Set(allNodes.map((n) => n.id));
    const elkEdges = allEdges
        .filter((e) => allNodeIds.has(e.source) && allNodeIds.has(e.target))
        .filter((e) => e.source !== e.target)
        .map((e) => ({
            id: e.id,
            sources: [e.source],
            targets: [e.target],
        }));

    const graph: any = {
        id: 'root',
        layoutOptions: ELK_OPTIONS,
        children: elkChildren,
        edges: elkEdges,
    };

    try {
        const laidOut = await elk.layout(graph);

        // Walk the output hierarchy. Collect positions for NEW nodes
        // only — existing nodes are anchors and don't get returned
        // (callers don't need to update them).
        const positions = new Map<string, { x: number; y: number }>();
        const visit = (node: any) => {
            if (
                !existingIds.has(node.id) &&
                typeof node.x === 'number' &&
                typeof node.y === 'number'
            ) {
                positions.set(node.id, { x: node.x, y: node.y });
            }
            if (Array.isArray(node.children)) {
                for (const c of node.children) visit(c);
            }
        };
        for (const root of laidOut.children ?? []) visit(root);

        return positions;
    } catch (err) {
        console.error('[layoutPatchAsync] ELK layout failed, using fallback:', err);
        return fallbackPlacement(existingNodes, newNodes);
    }
}

/**
 * Last-resort placement if ELK fails. Drops each new top-level node
 * in a column to the right of the existing canvas bbox. Children
 * inside groups get a simple staircase relative to their parent.
 * Never blocks the AI tool call on a layout glitch.
 */
function fallbackPlacement(
    existing: WorkflowNode[],
    newNodes: WorkflowNode[],
): Map<string, { x: number; y: number }> {
    const positions = new Map<string, { x: number; y: number }>();

    let maxX = 0;
    let minY = Infinity;
    for (const n of existing) {
        if (n.parentNode) continue;
        const { width } = getNodeDimensions(n.type);
        const right = (n.position?.x ?? 0) + width;
        if (right > maxX) maxX = right;
        if ((n.position?.y ?? 0) < minY) minY = n.position?.y ?? 0;
    }
    if (!isFinite(minY)) minY = 0;
    const startX = maxX > 0 ? maxX + 80 : 100;

    let y = minY;
    for (const n of newNodes) {
        if (n.parentNode) continue;
        positions.set(n.id, { x: startX, y });
        y += getNodeDimensions(n.type).height + 60;
    }
    // Children inside new groups: simple staircase relative to parent.
    const childrenByParent = new Map<string, WorkflowNode[]>();
    for (const n of newNodes) {
        if (!n.parentNode) continue;
        const arr = childrenByParent.get(n.parentNode) ?? [];
        arr.push(n);
        childrenByParent.set(n.parentNode, arr);
    }
    for (const [, kids] of childrenByParent) {
        let cy = 24;
        for (const k of kids) {
            positions.set(k.id, { x: 24, y: cy });
            cy += getNodeDimensions(k.type).height + 24;
        }
    }
    return positions;
}
