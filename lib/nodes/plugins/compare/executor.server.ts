import { ExecutionContext, NodeExecutionResult } from '../../types';
import { CompareConfig } from './definition';
import { detectMediaTypeFromUrl } from '@/lib/workflow/result-format';

/**
 * Compare server executor — pure passthrough.
 *
 * Compare doesn't transform pixels; it's a visual inspector. On the server it
 * simply echoes its two input URLs into a FIXED 2-slot array so the per-handle
 * routing carve-out (orchestrator / ephemeral-executor) can deliver slot 0 to
 * downstream wires off `output_a` and slot 1 to wires off `output_b`.
 *
 * The slots are positional: index 0 = input A, index 1 = input B. A missing
 * input keeps its slot (as null) so the other slot's index stays stable.
 *
 * We set `result_type` explicitly so the ephemeral-executor maps each item to
 * its URL string cleanly even when a slot is null (its array-inference path
 * would otherwise choke on the null first element). The label is cosmetic —
 * downstream consumers re-detect image vs video from the URL, and the per-
 * handle carve-out reads the URL directly, never `result_type`.
 */
export const compareExecutor = async (
    config: CompareConfig,
    inputs: Record<string, any>,
    _context: ExecutionContext,
): Promise<NodeExecutionResult> => {
    const a = normalizeUrl(inputs?.input_a);
    const b = normalizeUrl(inputs?.input_b);

    console.log('[CompareExecutor] passthrough', { hasA: !!a, hasB: !!b });

    if (!a && !b) {
        return { success: false, data: null, error: 'Compare node requires at least one input (image or video URL)' };
    }

    // Cosmetic type label — prefer whichever side is present.
    const primaryUrl = a ?? b!;
    const kind = detectMediaTypeFromUrl(primaryUrl) === 'video' ? 'video' : 'image';

    return {
        success: true,
        result_type: kind,
        // Positional slots: [A, B]. Nulls preserve indices for the carve-out.
        data: [
            a ? { url: a } : null,
            b ? { url: b } : null,
        ],
    };
};

/**
 * Coerce an orchestrator-delivered input into a plain URL string. Inputs arrive
 * as a URL string (the common case via getPrimaryInputValue) or an object with
 * a `url` field; anything else yields null.
 */
function normalizeUrl(value: any): string | null {
    if (!value) return null;
    if (typeof value === 'string') return value.length > 0 ? value : null;
    if (typeof value === 'object') {
        if (typeof value.url === 'string' && value.url.length > 0) return value.url;
        if (Array.isArray(value) && value.length > 0) return normalizeUrl(value[0]);
    }
    return null;
}
