/**
 * Pure helpers shared by the Collect node's server + client executors and its
 * canvas component. No `sharp`, no `window` — safe in both bundles.
 */
import { NodeDataType } from '../../core/types';
import {
    RESULT_TYPES,
    NodeResultType,
    detectMediaTypeFromUrl,
    coerceResultDataArray,
} from '@/lib/workflow/result-format';
import { CollectConfig } from './definition';

/** The single static input handle id. Every other key in `inputs` is an edge id. */
export const COLLECT_HANDLE_ID = 'values';

/**
 * Group the node's inputs by incoming edge.
 *
 * Both input-builders key every edge's value under its edge id (in addition to
 * the shared handle key). The handle key `values` only ever holds the LAST
 * edge's value, so we exclude it and read each edge id key — giving us one
 * group per input wire:
 *   - server: inputs[edgeId] = the upstream's FULL result_data array
 *     (delivered by the collect carve-out in orchestrator/ephemeral builders).
 *   - client: inputs[edgeId] = the upstream's nodeOutputs envelope.
 * `coerceResultDataArray` normalizes both into a flat item array per edge.
 */
export function collectGroups(inputs: Record<string, any>): any[][] {
    return Object.keys(inputs)
        .filter((k) => k !== COLLECT_HANDLE_ID)
        .map((k) => coerceResultDataArray(inputs[k]))
        .filter((arr) => arr.length > 0);
}

/**
 * Build the collected item array from inputs, honoring the "take only active"
 * switch. OFF → flatten all items of all inputs; ON → first (active) item of
 * each input. Returns the items plus the resolved result type.
 */
export function collectItems(
    config: CollectConfig,
    inputs: Record<string, any>,
): { items: any[]; type: NodeResultType } {
    const groups = collectGroups(inputs);
    const items = (
        config?.takeOnlyActive
            ? groups.map((g) => g[0])
            : groups.flat()
    ).filter((v) => v !== undefined && v !== null);
    return { items, type: resolveCollectedType(config?.lockedType, items) };
}

/**
 * Resolve the node_results result_type for the collected items. Prefers the
 * locked input type (mapped onto the RESULT_TYPES domain); falls back to
 * detecting from the first item's URL/shape.
 */
export function resolveCollectedType(
    lockedType: NodeDataType | NodeDataType[] | undefined,
    items: any[],
): NodeResultType {
    const lt = Array.isArray(lockedType) ? lockedType[0] : lockedType;
    if (lt) {
        if (lt === 'image_array') return 'image';
        if (lt === 'prompt') return 'text';
        if (lt !== 'any' && (RESULT_TYPES as readonly string[]).includes(lt)) {
            return lt as NodeResultType;
        }
    }

    const first = items[0];
    const url =
        typeof first === 'string'
            ? first
            : first && typeof first === 'object'
              ? (first.url as string | undefined)
              : undefined;
    if (typeof url === 'string') {
        const detected = detectMediaTypeFromUrl(url);
        if (detected) return detected;
        if (url.startsWith('http') || url.startsWith('data:')) return 'image';
        return 'text';
    }
    if (typeof first === 'string') return 'text';
    return 'json';
}
