import { WorkflowNode } from '@/lib/nodes/types';

// ─────────────────────────────────────────────────────────────────────────────
// Node dimension registry
// These mirror the sizes communicated to the AI and rendered on canvas.
// ─────────────────────────────────────────────────────────────────────────────
export const NODE_DIMENSIONS: Record<string, { width: number; height: number }> = {
    prompt: { width: 185, height: 90 },
    media_input: { width: 210, height: 160 },
    compositor: { width: 210, height: 260 },
    blur: { width: 210, height: 200 },
};

const DEFAULT_NODE_DIM = { width: 210, height: 200 };

/** Gap between columns (horizontal) */
const GAP_X = 80;
/** Gap between rows within the same column (vertical) */
const GAP_Y = 40;
/** Canvas origin when the canvas is empty */
const ORIGIN = { x: 100, y: 180 };

export function getNodeDimensions(type: string): { width: number; height: number } {
    return NODE_DIMENSIONS[type] ?? DEFAULT_NODE_DIM;
}

// ─────────────────────────────────────────────────────────────────────────────
// Collision helpers
// ─────────────────────────────────────────────────────────────────────────────

/** True if a candidate rect at (cx, cy, cw, ch) overlaps an existing node. */
function rectsOverlap(
    cx: number, cy: number, cw: number, ch: number,
    nx: number, ny: number, nw: number, nh: number
): boolean {
    return cx < nx + nw && cx + cw > nx && cy < ny + nh && cy + ch > ny;
}

/** Return the first Y (≥ startY) where the candidate doesn't collide with any existing node. */
function resolveY(
    startY: number,
    x: number,
    width: number,
    height: number,
    existingNodes: WorkflowNode[]
): number {
    let y = startY;
    let changed = true;

    while (changed) {
        changed = false;
        for (const n of existingNodes) {
            const { width: nw, height: nh } = getNodeDimensions(n.type);
            if (rectsOverlap(x, y, width, height, n.position.x, n.position.y, nw, nh)) {
                // Push down below this node
                y = n.position.y + nh + GAP_Y;
                changed = true;
            }
        }
    }

    return y;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate a non-overlapping canvas position for a new node.
 *
 * @param nodeType        The type string of the new node (e.g. "prompt", "ai_generator").
 * @param sourceNodeIds   Resolved UUIDs of parent nodes (from the patch's addedEdges).
 * @param existingNodes   All nodes currently on the canvas (before this node is added).
 */
export function calculateNodePosition(
    nodeType: string,
    sourceNodeIds: string[],
    existingNodes: WorkflowNode[]
): { x: number; y: number } {
    const { width, height } = getNodeDimensions(nodeType);

    const parents = existingNodes.filter((n) => sourceNodeIds.includes(n.id));

    // ── 1. Determine X ──────────────────────────────────────────────────────
    let x: number;

    if (parents.length > 0) {
        // Place this node one column to the right of its rightmost parent
        const rightmostParentEdge = Math.max(
            ...parents.map((p) => p.position.x + getNodeDimensions(p.type).width)
        );
        x = rightmostParentEdge + GAP_X;
    } else if (existingNodes.length > 0) {
        // No parents → place to the right of everything on the canvas
        const rightmostEdge = Math.max(
            ...existingNodes.map((n) => n.position.x + getNodeDimensions(n.type).width)
        );
        x = rightmostEdge + GAP_X;
    } else {
        // Empty canvas
        x = ORIGIN.x;
    }

    // ── 2. Determine ideal Y (centre on parents, or ORIGIN) ─────────────────
    let idealY: number;

    if (parents.length > 0) {
        const avgParentCenterY =
            parents.reduce((sum, p) => sum + p.position.y + getNodeDimensions(p.type).height / 2, 0) /
            parents.length;
        idealY = Math.round(avgParentCenterY - height / 2);
    } else if (existingNodes.length > 0) {
        // Centre vertically on the whole canvas
        const minY = Math.min(...existingNodes.map((n) => n.position.y));
        const maxY = Math.max(
            ...existingNodes.map((n) => n.position.y + getNodeDimensions(n.type).height)
        );
        idealY = Math.round((minY + maxY) / 2 - height / 2);
    } else {
        idealY = ORIGIN.y;
    }

    // ── 3. Collision avoidance — push Y down until clear ─────────────────────
    const y = resolveY(idealY, x, width, height, existingNodes);

    return { x, y };
}
