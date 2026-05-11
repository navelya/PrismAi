import type { WorkflowNode } from '@/lib/nodes/types';

/**
 * Gap between the existing canvas content and the new batch, in pixels.
 * Tune here, not in callers.
 */
const BATCH_GAP_X = 80;

/**
 * Translate a batch of new nodes so the batch lands in an empty region
 * of the existing canvas, preserving the AI's INTRA-batch layout.
 *
 * Rules:
 *  - Top-level nodes (no parentNode) get translated. Their `position` is
 *    in absolute canvas space and represents the batch's own coordinate
 *    space (typically starting near 0,0 as the AI emits it).
 *  - Children with `parentNode` set are NOT translated — their `position`
 *    is RELATIVE to their parent, and the parent's translation already
 *    carries them along.
 *  - When the canvas is empty, no translation is applied (the batch lands
 *    where the AI placed it, near origin).
 *  - Translation goes RIGHT of the existing canvas's bounding box by
 *    BATCH_GAP_X. We deliberately don't try to find packed gaps — the
 *    simple "always to the right" rule is predictable and easy to reason
 *    about. Top-aligned with the existing canvas's top edge so growth is
 *    linear left-to-right.
 *
 * Returns a NEW array; does not mutate inputs.
 */
export function placeBatchInFreeSpace(
    batch: any[],
    existingCanvasNodes: WorkflowNode[],
): any[] {
    if (!Array.isArray(batch) || batch.length === 0) return batch;

    // Existing canvas bbox — only count TOP-LEVEL nodes (children inside
    // groups are positioned relative to the group, so their `position`
    // isn't comparable to absolute canvas coords).
    const topLevelExisting = existingCanvasNodes.filter((n: any) => !n.parentNode);
    if (topLevelExisting.length === 0) {
        // Empty canvas — no translation needed.
        return batch;
    }

    let maxX = -Infinity;
    let minY = Infinity;
    for (const n of topLevelExisting) {
        const x = n.position?.x ?? 0;
        const y = n.position?.y ?? 0;
        const w = (n as any).measured?.width ?? (n as any).width ?? 200;
        if (x + w > maxX) maxX = x + w;
        if (y < minY) minY = y;
    }
    if (!isFinite(maxX)) return batch;
    if (!isFinite(minY)) minY = 0;

    // Batch bbox — only count TOP-LEVEL nodes in the new batch.
    const topLevelBatch = batch.filter((n: any) => !n.parentNode);
    if (topLevelBatch.length === 0) return batch;

    let batchMinX = Infinity;
    let batchMinY = Infinity;
    for (const n of topLevelBatch) {
        const x = n.position?.x ?? 0;
        const y = n.position?.y ?? 0;
        if (x < batchMinX) batchMinX = x;
        if (y < batchMinY) batchMinY = y;
    }
    if (!isFinite(batchMinX)) batchMinX = 0;
    if (!isFinite(batchMinY)) batchMinY = 0;

    // Offset = where we want the batch's top-left to land MINUS where it
    // currently is. We land at (maxX + GAP, minY of existing canvas — so
    // a new task sits beside, top-aligned with, the existing graph).
    const dx = (maxX + BATCH_GAP_X) - batchMinX;
    const dy = minY - batchMinY;

    return batch.map((n: any) => {
        if (n.parentNode) {
            // Child — keep relative position untouched. The parent's
            // position will shift, which moves the child too.
            return n;
        }
        return {
            ...n,
            position: {
                x: (n.position?.x ?? 0) + dx,
                y: (n.position?.y ?? 0) + dy,
            },
        };
    });
}
