// ─────────────────────────────────────────────────────────────────────────────
// Node dimension registry
// Used server-side (where React Flow's `measured` props aren't available) to
// give ELK realistic sizes. Unknown types fall back to DEFAULT_NODE_DIM.
// Tune values here when a node type's rendered size changes.
// ─────────────────────────────────────────────────────────────────────────────
export const NODE_DIMENSIONS: Record<string, { width: number; height: number }> = {
    prompt:       { width: 185, height: 100 },
    media_input:  { width: 210, height: 180 },
    compositor:   { width: 210, height: 280 },
    blur:         { width: 210, height: 220 },
    ai_generator: { width: 210, height: 380 },
    // group_container size is normally computed dynamically by
    // layout-incremental's per-group interior pass; this entry is only a
    // fallback for empty groups or for existing groups whose stored
    // dimensions aren't available server-side.
    group_container: { width: 320, height: 220 },
};

const DEFAULT_NODE_DIM = { width: 220, height: 380 };

export function getNodeDimensions(type: string): { width: number; height: number } {
    return NODE_DIMENSIONS[type] ?? DEFAULT_NODE_DIM;
}
