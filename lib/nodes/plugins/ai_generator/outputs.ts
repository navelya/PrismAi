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
