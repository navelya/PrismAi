import type { NodeResultType } from '@/lib/workflow/result-format';

/** One produced output, persisted in ai_generator config.outputs (newest-first). */
export interface GeneratedOutput {
    /** Result type of THIS item ('image' | 'video' | 'text' | 'audio' | '3d' | 'json'). */
    type: NodeResultType;
    /** URL for media, string for text, or raw value otherwise. */
    value: any;
    /** The execution that produced this item. Used to dedupe re-delivered events. */
    execution_id?: string;
    /** ISO timestamp the item was added (newest-first ordering aid). */
    created_at?: string;
}

/** Hard cap so a long-lived node can't bloat the persisted workflow JSON. */
export const MAX_OUTPUTS_PER_NODE = 60;

/** Wrap a run's raw values (urls or text strings) into GeneratedOutput items. */
export function buildOutputItems(
    type: NodeResultType,
    values: any[] | null | undefined,
    executionId?: string,
    createdAt: string = new Date().toISOString(),
): GeneratedOutput[] {
    return (values ?? [])
        .filter((v) => v !== undefined && v !== null && v !== '')
        .map((v) => ({ type, value: v, execution_id: executionId, created_at: createdAt }));
}

/**
 * Merge a new run's items into the existing collection, newest-first.
 * - Idempotent per execution: items whose execution_id matches `executionId`
 *   are dropped from `existing` first, so a re-delivered realtime event for the
 *   same run never double-appends.
 * - Capped at MAX_OUTPUTS_PER_NODE (oldest items fall off the tail).
 */
export function mergeRunIntoCollection(
    existing: GeneratedOutput[] | undefined,
    incoming: GeneratedOutput[],
    executionId?: string,
): GeneratedOutput[] {
    const prior = (existing ?? []).filter(
        (o) => !(executionId && o.execution_id === executionId),
    );
    return [...incoming, ...prior].slice(0, MAX_OUTPUTS_PER_NODE);
}

/** Clamp a (possibly stale) selected index into [0, length-1]; 0 when empty. */
export function clampSelectedIndex(index: number | undefined, length: number): number {
    if (length <= 0) return 0;
    const i = Number.isFinite(index as number) ? Math.trunc(index as number) : 0;
    return Math.max(0, Math.min(length - 1, i));
}

/** The currently-selected output value, or undefined for an empty collection. */
export function selectedValue(
    outputs: GeneratedOutput[] | undefined,
    index: number | undefined,
): any {
    const list = outputs ?? [];
    if (list.length === 0) return undefined;
    return list[clampSelectedIndex(index, list.length)]?.value;
}

/** The URL/string identity of one output item (envelope item, `{ url }`, or raw string). */
export function itemValueOf(item: any): any {
    return typeof item === 'string' ? item : item?.url ?? item?.value;
}

/** Flatten any live-output shape — `{ type, data:[…] }`, raw `[…]`, or a single item — to its item array. */
function outputItems(value: any): any[] {
    if (value == null) return [];
    if (value && typeof value === 'object' && !Array.isArray(value) && Array.isArray(value.data)) return value.data;
    if (Array.isArray(value)) return value;
    return [value];
}

/**
 * True when `value` already holds EXACTLY the single item identified by
 * `active`. Used as the convergence guard so the node's republish-active effect
 * stops re-writing once nodeOutputs has been narrowed.
 */
export function isActiveOnly(value: any, active: any): boolean {
    if (value == null || active == null) return false;
    const items = outputItems(value);
    return items.length === 1 && itemValueOf(items[0]) === active;
}

/**
 * Build the single-item output envelope a node publishes downstream: the one
 * item identified by `active` (its selected/front value). Reuses the rich item
 * (url + resolution + metadata) from the current live `value` when present;
 * else synthesizes `{ url: active }`.
 *
 * Matching is by VALUE (URL/string), not index: across multiple runs the live
 * envelope (latest run only) and `config.outputs` (accumulated, newest-first)
 * can fall out of index alignment, but the active value is always exact — and
 * when it isn't present in the live array at all (it came from an earlier run
 * no longer in the envelope) we still surface the front image, not a stale one.
 */
export function activeItemEnvelope(value: any, active: any, fallbackType: string = 'image'): { type: string; data: any[] } {
    const item = outputItems(value).find((d) => itemValueOf(d) === active) ?? { url: active };
    const type = (value && typeof value === 'object' && !Array.isArray(value) && typeof value.type === 'string')
        ? value.type
        : fallbackType;
    return { type, data: [item] };
}
