import ELK from 'elkjs/lib/elk.bundled.js';
import type { WorkflowNode, WorkflowEdge } from '@/lib/nodes/types';
import { getNodeDimensions } from './layout-utils';

const elk = new ELK();

// Layout pass options. We never use INCLUDE_CHILDREN because ELK's layered
// algorithm has long-standing bugs with parent-minimum-size handling when
// children are present in the same layout pass (see elkjs#311, elk#316).
// Instead we lay out each new group's interior first to derive its real
// size, then run a separate top-level pass with groups treated as opaque
// boxes carrying those computed sizes. Two ELK calls; one pass per scope.
const ELK_LAYERED_OPTIONS = {
    'elk.algorithm': 'layered',
    'elk.direction': 'RIGHT',
    'elk.spacing.nodeNode': '60',
    'elk.layered.spacing.nodeNodeBetweenLayers': '120',
    'elk.spacing.componentComponent': '80',
    'elk.separateConnectedComponents': 'true',
};

// Padding inside a group container: top has room for the group's header,
// sides and bottom hug the children.
const GROUP_PAD_TOP = 56;
const GROUP_PAD_SIDE = 24;
const GROUP_PAD_BOTTOM = 24;

// Gap between the existing canvas's right edge and the new subgraph's
// left edge when docking new top-level nodes.
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
 * Three-pass design:
 *   1. For each NEW group, run ELK over just its NEW children to compute
 *      child positions (parent-relative) and the group's effective size.
 *   2. Run a TOP-LEVEL ELK pass over the new groups (with their computed
 *      sizes) and any ungrouped new nodes. Translate the result to dock
 *      right of the existing canvas's bounding box.
 *   3. For new children of EXISTING groups (where the parent isn't in
 *      our ELK input), stack them below the group's existing children.
 *
 * Returns Map<nodeId, {x, y}> for NEW nodes only. Children inside groups
 * have positions RELATIVE to their parent (React Flow's `parentNode`
 * convention). Top-level nodes have absolute canvas positions.
 *
 * On any ELK failure, falls back to a simple right-of-bbox column
 * placement so the chat tool call doesn't fail because of a layout
 * glitch.
 */
export async function layoutPatchAsync(
    input: LayoutPatchInput,
): Promise<Map<string, { x: number; y: number }>> {
    const { existingNodes, newNodes, newEdges } = input;
    if (newNodes.length === 0) return new Map();

    const existingIds = new Set(existingNodes.map((n) => n.id));
    const newIds = new Set(newNodes.map((n) => n.id));

    // Partition new nodes into three buckets:
    //   intoExistingGroup: parentNode points to an EXISTING node on canvas.
    //   childOfNewGroup:   parentNode points to ANOTHER NEW node (= new group).
    //   topLevelNew:       no parentNode, or parent isn't in either set.
    const intoExistingGroup = new Map<string, WorkflowNode[]>();
    const childOfNewGroup = new Map<string, WorkflowNode[]>();
    const topLevelNew: WorkflowNode[] = [];
    for (const n of newNodes) {
        if (n.parentNode && existingIds.has(n.parentNode)) {
            const arr = intoExistingGroup.get(n.parentNode) ?? [];
            arr.push(n);
            intoExistingGroup.set(n.parentNode, arr);
        } else if (n.parentNode && newIds.has(n.parentNode)) {
            const arr = childOfNewGroup.get(n.parentNode) ?? [];
            arr.push(n);
            childOfNewGroup.set(n.parentNode, arr);
        } else {
            topLevelNew.push(n);
        }
    }

    const result = new Map<string, { x: number; y: number }>();

    // ── Pass 1: per-group interior layout ────────────────────────────────
    // For each new group, lay out its new children alone and derive the
    // group's effective size from the resulting bounding box. Records
    // child positions (parent-relative) into `result` and the group's
    // size into `computedGroupSizes`.
    const computedGroupSizes = new Map<string, { width: number; height: number }>();
    for (const [groupId, kids] of childOfNewGroup) {
        const { childPositions, groupSize } = await layoutGroupInterior(groupId, kids, newEdges);
        for (const [id, pos] of childPositions) result.set(id, pos);
        computedGroupSizes.set(groupId, groupSize);
    }

    // ── Pass 2: top-level layout + dock ──────────────────────────────────
    if (topLevelNew.length > 0) {
        const topLevelIds = new Set(topLevelNew.map((n) => n.id));
        const topLevelPositions = await layoutTopLevel(
            topLevelNew,
            computedGroupSizes,
            newEdges,
            newIds,
            topLevelIds,
        );

        const dock = computeDockTranslation(existingNodes, topLevelPositions);
        for (const [id, pos] of topLevelPositions) {
            result.set(id, { x: pos.x + dock.dx, y: pos.y + dock.dy });
        }
    }

    // ── Pass 3: new children of existing groups ──────────────────────────
    // Stack new children below the group's existing children.
    for (const [parentId, kids] of intoExistingGroup) {
        const existingKids = existingNodes.filter((n) => n.parentNode === parentId);
        let maxBottom = GROUP_PAD_TOP;
        for (const ek of existingKids) {
            const { height } = effectiveSize(ek);
            const bottom = (ek.position?.y ?? 0) + height;
            if (bottom > maxBottom) maxBottom = bottom;
        }
        let y = maxBottom + GROUP_PAD_BOTTOM;
        for (const k of kids) {
            result.set(k.id, { x: GROUP_PAD_SIDE, y });
            y += effectiveSize(k).height + GROUP_PAD_BOTTOM;
        }
    }

    return result;
}

/**
 * Pass 1 helper. Lay out a new group's children alone, return child
 * positions (parent-relative, normalized so the leftmost child sits at
 * x = GROUP_PAD_SIDE and the topmost at y = GROUP_PAD_TOP) plus the
 * group's effective size including padding.
 */
async function layoutGroupInterior(
    groupId: string,
    kids: WorkflowNode[],
    allNewEdges: WorkflowEdge[],
): Promise<{
    childPositions: Map<string, { x: number; y: number }>;
    groupSize: { width: number; height: number };
}> {
    const childPositions = new Map<string, { x: number; y: number }>();
    if (kids.length === 0) {
        return { childPositions, groupSize: { width: 200, height: 120 } };
    }

    const kidIds = new Set(kids.map((k) => k.id));
    const elkChildren = kids.map((k) => {
        const { width, height } = effectiveSize(k);
        return {
            id: k.id,
            width,
            height,
            properties: { portConstraints: 'FREE' },
        };
    });

    const elkEdges = allNewEdges
        .filter((e) => kidIds.has(e.source) && kidIds.has(e.target))
        .filter((e) => e.source !== e.target)
        .map((e, i) => ({
            id: e.id ?? `__elk_group_${groupId}_edge_${i}`,
            sources: [e.source],
            targets: [e.target],
        }));

    const graph: any = {
        id: groupId,
        layoutOptions: ELK_LAYERED_OPTIONS,
        children: elkChildren,
        edges: elkEdges,
    };

    try {
        const laidOut = await elk.layout(graph);

        // Find min x/y to normalize the layout to start at the padding origin.
        let minX = Infinity;
        let minY = Infinity;
        for (const c of laidOut.children ?? []) {
            if (typeof c.x === 'number') minX = Math.min(minX, c.x);
            if (typeof c.y === 'number') minY = Math.min(minY, c.y);
        }
        if (!isFinite(minX)) minX = 0;
        if (!isFinite(minY)) minY = 0;

        let maxRight = 0;
        let maxBottom = 0;
        for (const c of laidOut.children ?? []) {
            if (typeof c.x !== 'number' || typeof c.y !== 'number') continue;
            const adjX = (c.x - minX) + GROUP_PAD_SIDE;
            const adjY = (c.y - minY) + GROUP_PAD_TOP;
            childPositions.set(c.id, { x: adjX, y: adjY });
            const right = adjX + (c.width ?? 0);
            const bottom = adjY + (c.height ?? 0);
            if (right > maxRight) maxRight = right;
            if (bottom > maxBottom) maxBottom = bottom;
        }

        return {
            childPositions,
            groupSize: {
                width: maxRight + GROUP_PAD_SIDE,
                height: maxBottom + GROUP_PAD_BOTTOM,
            },
        };
    } catch (err) {
        // ELK failed on this group's interior — fall back to a vertical stack.
        console.error(`[layoutPatchAsync] group ${groupId} interior layout failed:`, err);
        let y = GROUP_PAD_TOP;
        let maxW = 0;
        for (const k of kids) {
            const { width, height } = effectiveSize(k);
            childPositions.set(k.id, { x: GROUP_PAD_SIDE, y });
            y += height + GROUP_PAD_BOTTOM;
            if (width > maxW) maxW = width;
        }
        return {
            childPositions,
            groupSize: {
                width: maxW + 2 * GROUP_PAD_SIDE,
                height: y + GROUP_PAD_BOTTOM,
            },
        };
    }
}

/**
 * Pass 2 helper. Lay out top-level new nodes as a flat graph, using the
 * computed size for any new group and the registry size for regular
 * nodes. Returns ELK-coordinate positions; the caller applies the dock
 * translation.
 *
 * Edges between top-level new nodes are honored. Edges whose endpoint
 * is a child of a new group are remapped to the parent so ELK still
 * sees the group-to-group topology (or group-to-node).
 */
async function layoutTopLevel(
    topLevelNew: WorkflowNode[],
    computedGroupSizes: Map<string, { width: number; height: number }>,
    allNewEdges: WorkflowEdge[],
    newIds: Set<string>,
    topLevelIds: Set<string>,
): Promise<Map<string, { x: number; y: number }>> {
    void newIds; // currently only needed if we ever do parent-remapping here

    const sizeOf = (n: WorkflowNode) => computedGroupSizes.get(n.id) ?? effectiveSize(n);

    const elkChildren = topLevelNew.map((n) => {
        const { width, height } = sizeOf(n);
        return {
            id: n.id,
            width,
            height,
            properties: { portConstraints: 'FREE' },
        };
    });

    // Only keep edges where BOTH endpoints are top-level new nodes. Edges
    // between grouped children already drove their group's interior layout
    // in Pass 1; edges crossing the group boundary don't constrain top-level
    // packing meaningfully (the connected-component packer separates groups
    // by default). Dedup after filtering.
    const seen = new Set<string>();
    const elkEdges: any[] = [];
    for (let i = 0; i < allNewEdges.length; i++) {
        const e = allNewEdges[i];
        if (!topLevelIds.has(e.source) || !topLevelIds.has(e.target)) continue;
        if (e.source === e.target) continue;
        const key = `${e.source}→${e.target}`;
        if (seen.has(key)) continue;
        seen.add(key);
        elkEdges.push({
            id: e.id ?? `__elk_top_edge_${i}_${e.source}_${e.target}`,
            sources: [e.source],
            targets: [e.target],
        });
    }

    const graph: any = {
        id: 'root',
        layoutOptions: ELK_LAYERED_OPTIONS,
        children: elkChildren,
        edges: elkEdges,
    };

    const positions = new Map<string, { x: number; y: number }>();
    try {
        const laidOut = await elk.layout(graph);
        for (const c of laidOut.children ?? []) {
            if (typeof c.x === 'number' && typeof c.y === 'number') {
                positions.set(c.id, { x: c.x, y: c.y });
            }
        }
    } catch (err) {
        console.error('[layoutPatchAsync] top-level layout failed:', err);
        // Fall back: column at origin. Dock translation will move it
        // beside the existing canvas.
        let y = 0;
        for (const n of topLevelNew) {
            positions.set(n.id, { x: 0, y });
            y += sizeOf(n).height + 60;
        }
    }
    return positions;
}

/**
 * Compute the (dx, dy) translation that "docks" the top-level layout
 * to the right of the existing canvas. The existing-bbox calculation
 * considers both top-level existing nodes AND the visible extent of
 * groups by including their children's positions — so docking accounts
 * for groups that have grown beyond their declared registry size.
 */
function computeDockTranslation(
    existingNodes: WorkflowNode[],
    topLevelPositions: Map<string, { x: number; y: number }>,
): { dx: number; dy: number } {
    if (existingNodes.length === 0 || topLevelPositions.size === 0) {
        return { dx: 0, dy: 0 };
    }

    // Existing canvas bbox. For top-level nodes, use position + effective
    // size. For grouped children, account for their parent's position plus
    // the child's relative position + size, so a group that has grown to
    // contain wide children gets a wider effective bbox.
    const parentPositions = new Map<string, { x: number; y: number }>();
    for (const n of existingNodes) {
        if (!n.parentNode) parentPositions.set(n.id, n.position);
    }

    let maxRight = -Infinity;
    let minY = Infinity;
    for (const n of existingNodes) {
        const { width, height } = effectiveSize(n);
        let absX: number;
        let absY: number;
        if (n.parentNode) {
            const pp = parentPositions.get(n.parentNode);
            if (!pp) continue; // orphaned child — skip
            absX = pp.x + (n.position?.x ?? 0);
            absY = pp.y + (n.position?.y ?? 0);
        } else {
            absX = n.position.x;
            absY = n.position.y;
        }
        const right = absX + width;
        if (right > maxRight) maxRight = right;
        // Only top-level nodes contribute to minY — children of groups
        // share the group's top edge already.
        if (!n.parentNode && absY < minY) minY = absY;
        // Also extend bottom check via children: a tall group can extend
        // its parent's effective bbox downward. We don't need that for
        // dock placement (we dock right, not below), so skip.
        void height;
    }
    if (!isFinite(maxRight)) maxRight = 0;
    if (!isFinite(minY)) minY = 0;

    // New subgraph's top-left.
    let subMinX = Infinity;
    let subMinY = Infinity;
    for (const [, p] of topLevelPositions) {
        if (p.x < subMinX) subMinX = p.x;
        if (p.y < subMinY) subMinY = p.y;
    }
    if (!isFinite(subMinX)) subMinX = 0;
    if (!isFinite(subMinY)) subMinY = 0;

    return {
        dx: (maxRight + DOCK_GAP_X) - subMinX,
        dy: minY - subMinY,
    };
}

/**
 * Effective rendered size of a node. Prefers React Flow's measured size
 * (set client-side after render) when available, then any explicit
 * width/height fields on the node, falling back to the NODE_DIMENSIONS
 * registry. Server-side, `measured` is usually undefined, but supporting
 * it lets the same function work in any context.
 */
function effectiveSize(n: WorkflowNode): { width: number; height: number } {
    const mw = n.measured?.width;
    const mh = n.measured?.height;
    if (typeof mw === 'number' && typeof mh === 'number') {
        return { width: mw, height: mh };
    }
    if (typeof n.width === 'number' && typeof n.height === 'number') {
        return { width: n.width, height: n.height };
    }
    return getNodeDimensions(n.type);
}
