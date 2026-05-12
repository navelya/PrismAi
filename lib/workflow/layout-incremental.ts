import ELK from 'elkjs/lib/elk.bundled.js';
import type { WorkflowNode, WorkflowEdge } from '@/lib/nodes/types';
import { getNodeDimensions } from './layout-utils';

const elk = new ELK();

// Layered ELK without INTERACTIVE strategies. INTERACTIVE only behaves well
// when there are enough already-positioned nodes to anchor the algorithm;
// for chat-tool patches (often a single new chain on an empty or sparse
// canvas) it degenerates and stacks everything in a single layer. We use
// default strategies and handle existing-canvas alignment with a separate
// docking pass below.
const ELK_OPTIONS = {
    'elk.algorithm': 'layered',
    'elk.direction': 'RIGHT',
    'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    'elk.spacing.nodeNode': '60',
    'elk.layered.spacing.nodeNodeBetweenLayers': '120',
    'elk.padding': '[top=50,left=50,bottom=50,right=50]',
    'elk.spacing.componentComponent': '80',
    'elk.separateConnectedComponents': 'true',
};

const GROUP_LAYOUT_OPTIONS = {
    'elk.nodeSize.constraints': 'NODE_LABELS PORTS MINIMUM_SIZE',
    // Top padding leaves room for the group's header/label; sides + bottom
    // get a smaller value so the group hugs its children.
    'elk.padding': '[top=56,left=24,bottom=24,right=24]',
    'elk.spacing.nodeNode': '60',
};

// Horizontal gap between the existing canvas's right edge and the new
// subgraph's left edge. Tuned to match elk.spacing.componentComponent.
const DOCK_GAP_X = 80;

export interface LayoutPatchInput {
    existingNodes: WorkflowNode[];
    existingEdges: WorkflowEdge[];
    newNodes: WorkflowNode[];
    newEdges: WorkflowEdge[];
}

/**
 * Compute positions for `newNodes` so they land near the existing canvas
 * with proper internal layout. Existing nodes are NEVER passed to ELK,
 * so their positions cannot be moved by the algorithm.
 *
 * The work splits into two paths:
 *   1. New nodes whose parentNode is an existing group → laid out inside
 *      that group by stacking below the group's existing children.
 *   2. Everything else (top-level new nodes + new groups + their new
 *      children) → laid out by ELK as a fresh subgraph, then translated
 *      ("docked") to land to the right of the existing canvas bbox.
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
    const { existingNodes, newNodes, newEdges } = input;
    if (newNodes.length === 0) return new Map();

    const existingIds = new Set(existingNodes.map((n) => n.id));
    const newIds = new Set(newNodes.map((n) => n.id));

    // Partition new nodes:
    //   - Going INTO an existing group: parentNode points to an existing node.
    //     We handle these separately because the existing parent isn't in
    //     ELK's input.
    //   - Subgraph: everything else (top-level new nodes + new groups +
    //     children of new groups).
    const intoExistingGroup = new Map<string, WorkflowNode[]>();
    const subgraphNodes: WorkflowNode[] = [];
    for (const n of newNodes) {
        if (n.parentNode && existingIds.has(n.parentNode)) {
            const arr = intoExistingGroup.get(n.parentNode) ?? [];
            arr.push(n);
            intoExistingGroup.set(n.parentNode, arr);
        } else {
            subgraphNodes.push(n);
        }
    }

    const result = new Map<string, { x: number; y: number }>();

    // ── Part 1: ELK over the new subgraph + dock ─────────────────────────
    if (subgraphNodes.length > 0) {
        const subgraphIds = new Set(subgraphNodes.map((n) => n.id));

        // Hierarchy index within the new subgraph.
        const childrenByParent = new Map<string, WorkflowNode[]>();
        const topLevel: WorkflowNode[] = [];
        for (const n of subgraphNodes) {
            if (n.parentNode && subgraphIds.has(n.parentNode)) {
                const arr = childrenByParent.get(n.parentNode) ?? [];
                arr.push(n);
                childrenByParent.set(n.parentNode, arr);
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
            const kids = childrenByParent.get(n.id);
            if (kids && kids.length > 0) {
                node.children = kids.map(toElkNode);
                node.layoutOptions = GROUP_LAYOUT_OPTIONS;
            }
            return node;
        };

        // Only edges where BOTH endpoints are in the new subgraph. Edges that
        // cross the new/existing boundary are dropped — the dock step handles
        // overall positioning relative to the existing canvas.
        const elkEdges = newEdges
            .filter((e) => subgraphIds.has(e.source) && subgraphIds.has(e.target))
            .filter((e) => e.source !== e.target)
            .map((e) => ({
                id: e.id,
                sources: [e.source],
                targets: [e.target],
            }));

        const graph: any = {
            id: 'root',
            layoutOptions: ELK_OPTIONS,
            children: topLevel.map(toElkNode),
            edges: elkEdges,
        };

        // Debug — remove once layout is confirmed working.
        console.log('[layoutPatchAsync] ELK input:', JSON.stringify({
            children: graph.children.map((c: any) => ({ id: c.id, w: c.width, h: c.height, childCount: c.children?.length ?? 0 })),
            edges: graph.edges,
            options: ELK_OPTIONS,
        }, null, 2));

        try {
            const laidOut = await elk.layout(graph);
            console.log('[layoutPatchAsync] ELK output:', JSON.stringify(
                (laidOut.children ?? []).map((c: any) => ({ id: c.id, x: c.x, y: c.y, w: c.width, h: c.height })),
                null, 2
            ));

            // Collect ELK positions for every node in the subgraph.
            const elkPositions = new Map<string, { x: number; y: number }>();
            const visit = (node: any) => {
                if (typeof node.x === 'number' && typeof node.y === 'number') {
                    elkPositions.set(node.id, { x: node.x, y: node.y });
                }
                if (Array.isArray(node.children)) {
                    for (const c of node.children) visit(c);
                }
            };
            for (const root of laidOut.children ?? []) visit(root);

            // Compute dock translation for TOP-LEVEL new nodes. Children's
            // positions are already relative to their parent (ELK output for
            // grouped children is parent-relative).
            const existingTopLevel = existingNodes.filter((n) => !n.parentNode);
            let dx = 0;
            let dy = 0;
            if (existingTopLevel.length > 0) {
                let maxRight = -Infinity;
                let minY = Infinity;
                for (const n of existingTopLevel) {
                    const { width } = getNodeDimensions(n.type);
                    const right = n.position.x + width;
                    if (right > maxRight) maxRight = right;
                    if (n.position.y < minY) minY = n.position.y;
                }
                if (!isFinite(maxRight)) maxRight = 0;
                if (!isFinite(minY)) minY = 0;
                const dockX = maxRight + DOCK_GAP_X;

                let subMinX = Infinity;
                let subMinY = Infinity;
                for (const n of topLevel) {
                    const p = elkPositions.get(n.id);
                    if (!p) continue;
                    if (p.x < subMinX) subMinX = p.x;
                    if (p.y < subMinY) subMinY = p.y;
                }
                if (!isFinite(subMinX)) subMinX = 0;
                if (!isFinite(subMinY)) subMinY = 0;

                dx = dockX - subMinX;
                dy = minY - subMinY;
            }

            // Apply: top-level get the dock translation; children stay
            // parent-relative.
            const topLevelIds = new Set(topLevel.map((n) => n.id));
            for (const [id, pos] of elkPositions) {
                if (!newIds.has(id)) continue;
                if (topLevelIds.has(id)) {
                    result.set(id, { x: pos.x + dx, y: pos.y + dy });
                } else {
                    result.set(id, { x: pos.x, y: pos.y });
                }
            }
        } catch (err) {
            console.error('[layoutPatchAsync] ELK layout failed, using fallback:', err);
            const fb = fallbackPlacement(existingNodes, subgraphNodes);
            for (const [k, v] of fb) result.set(k, v);
        }
    }

    // ── Part 2: New children of existing groups ──────────────────────────
    // The existing group isn't in ELK's input, so we compute relative
    // positions ourselves. Stack the new children below the group's
    // existing children with a 24px gap.
    for (const [parentId, kids] of intoExistingGroup) {
        const existingKids = existingNodes.filter((n) => n.parentNode === parentId);
        let maxBottom = 56; // Start below the group's header padding.
        for (const ek of existingKids) {
            const { height } = getNodeDimensions(ek.type);
            const bottom = (ek.position?.y ?? 0) + height;
            if (bottom > maxBottom) maxBottom = bottom;
        }
        let y = maxBottom + 24;
        for (const k of kids) {
            result.set(k.id, { x: 24, y });
            y += getNodeDimensions(k.type).height + 24;
        }
    }

    return result;
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
    const startX = maxX > 0 ? maxX + DOCK_GAP_X : 100;

    let y = minY;
    for (const n of newNodes) {
        if (n.parentNode) continue;
        positions.set(n.id, { x: startX, y });
        y += getNodeDimensions(n.type).height + 60;
    }
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
