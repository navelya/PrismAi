import { WorkflowNode } from '@/lib/nodes/types';

// ─────────────────────────────────────────────────────────────────────────────
// Node dimension registry
// Use generous heights so collision math accounts for real rendered size.
// Unknown types fall back to DEFAULT_NODE_DIM.
// ─────────────────────────────────────────────────────────────────────────────
export const NODE_DIMENSIONS: Record<string, { width: number; height: number }> = {
    prompt:       { width: 185, height: 100 },
    media_input:  { width: 210, height: 180 },
    compositor:   { width: 210, height: 280 },
    blur:         { width: 210, height: 220 },
    ai_generator: { width: 210, height: 380 },
};

// Generous default — better to over-estimate than under-estimate
const DEFAULT_NODE_DIM = { width: 220, height: 380 };

const GAP_X = 100;   // horizontal space between columns
const GAP_Y = 80;    // vertical space between nodes in the same column
const ORIGIN = { x: 100, y: 180 };

export function getNodeDimensions(type: string): { width: number; height: number } {
    return NODE_DIMENSIONS[type] ?? DEFAULT_NODE_DIM;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Returns true when two axis-aligned rects overlap (with padding). */
function rectsOverlap(
    ax: number, ay: number, aw: number, ah: number,
    bx: number, by: number, bw: number, bh: number,
    pad = 0
): boolean {
    return ax < bx + bw + pad
        && ax + aw + pad > bx
        && ay < by + bh + pad
        && ay + ah + pad > by;
}

/**
 * Push Y down until the candidate rect clears all existing nodes.
 * Adds GAP_Y between the bottom of every blocking node and the new node top.
 */
function resolveY(
    startY: number,
    x: number, width: number, height: number,
    existingNodes: WorkflowNode[]
): number {
    let y = startY;
    let changed = true;
    while (changed) {
        changed = false;
        for (const n of existingNodes) {
            const { width: nw, height: nh } = getNodeDimensions(n.type);
            if (rectsOverlap(x, y, width, height, n.position.x, n.position.y, nw, nh, GAP_Y / 2)) {
                y = n.position.y + nh + GAP_Y;
                changed = true;
            }
        }
    }
    return y;
}

/**
 * Push X rightward until the candidate rect no longer overlaps any existing
 * node that is in approximately the same Y band.
 *
 * We do NOT add extra padding here — the GAP_X is already baked into the
 * starting x (parent.right + GAP_X). Adding it again here would push
 * children past their correct column.
 */
function resolveX(
    startX: number,
    idealY: number, width: number, height: number,
    existingNodes: WorkflowNode[]
): number {
    let x = startX;
    let changed = true;
    while (changed) {
        changed = false;
        for (const n of existingNodes) {
            const { width: nw, height: nh } = getNodeDimensions(n.type);
            // True geometric X overlap (no extra padding — GAP is already in startX)
            const xOverlap = x < n.position.x + nw && x + width > n.position.x;
            // Y-band: are they in roughly the same vertical strip?
            // Use sum of heights as a generous band so nearby nodes are caught.
            const band = height + nh;
            const yNear = idealY - band < n.position.y + nh
                       && idealY + height + band > n.position.y;
            if (xOverlap && yNear) {
                x = n.position.x + nw + GAP_X;
                changed = true;
            }
        }
    }
    return x;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate a non-overlapping canvas position for a new node.
 *
 * @param nodeType       The type string of the new node.
 * @param sourceNodeIds  IDs of parent nodes (source of edges pointing TO this node).
 * @param existingNodes  All nodes already on canvas (including earlier nodes in the same batch).
 */
export function calculateNodePosition(
    nodeType: string,
    sourceNodeIds: string[],
    existingNodes: WorkflowNode[]
): { x: number; y: number } {
    const { width, height } = getNodeDimensions(nodeType);

    if (existingNodes.length === 0 && sourceNodeIds.length === 0) {
        return { x: ORIGIN.x, y: ORIGIN.y };
    }

    const parents = existingNodes.filter((n) => sourceNodeIds.includes(n.id));

    // ── 1. Determine ideal X ────────────────────────────────────────────────
    let idealX: number;
    let idealY: number;

    if (parents.length > 0) {
        // Prefer: one column to the right of the rightmost parent edge
        const rightmostParentEdge = Math.max(
            ...parents.map((p) => p.position.x + getNodeDimensions(p.type).width)
        );
        idealX = rightmostParentEdge + GAP_X;

        // Center vertically on parents
        const avgParentCenterY =
            parents.reduce((sum, p) => sum + p.position.y + getNodeDimensions(p.type).height / 2, 0) /
            parents.length;
        idealY = Math.round(avgParentCenterY - height / 2);

        // Push X right if this column would conflict with an existing node
        idealX = resolveX(idealX, idealY, width, height, existingNodes);
    } else {
        // Chain root (e.g. a standalone prompt): start at ORIGIN.x and
        // place below all existing content so new chains don't overlap old ones.
        idealX = ORIGIN.x;
        const maxBottomY = existingNodes.length > 0
            ? Math.max(...existingNodes.map((n) => n.position.y + getNodeDimensions(n.type).height))
            : ORIGIN.y - GAP_Y;
        idealY = maxBottomY + GAP_Y;
    }

    // ── 2. Resolve remaining Y conflicts ────────────────────────────────────
    const finalY = resolveY(idealY, idealX, width, height, existingNodes);

    return { x: idealX, y: finalY };
}
