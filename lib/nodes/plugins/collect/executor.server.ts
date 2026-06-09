/**
 * Collect — server executor.
 *
 * Pure data-flow: it references whatever upstream values it was fed and emits
 * them as one array. No binary work, no upload — the items are already-hosted
 * URLs/strings from upstream node_results. The collect carve-out in the input
 * builders (lib/workflow/orchestrator.ts + ephemeral-executor.ts) delivers each
 * incoming edge's FULL result array under its edge id, so OFF-mode can flatten
 * every item; `collectItems` does the flatten/active selection.
 *
 * Returns an explicit `result_type` so executeEphemeralNode persists the right
 * type (its default inference would mis-label video/audio/3d as image/text).
 */
import type { ExecutionContext, NodeExecutionResult } from '@/lib/nodes/types';
import { CollectConfig } from './definition';
import { collectItems } from './shared';

export async function collectExecutor(
    config: CollectConfig,
    inputs: Record<string, any>,
    context: ExecutionContext,
): Promise<NodeExecutionResult> {
    const { items, type } = collectItems(config || ({} as CollectConfig), inputs || {});
    console.log(
        `[collect] node=${context.nodeId} takeOnlyActive=${!!config?.takeOnlyActive} ` +
            `inputKeys=[${Object.keys(inputs || {}).join(', ')}] -> type=${type} count=${items.length}`,
    );
    return { success: true, data: items, result_type: type };
}
