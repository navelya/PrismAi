import { ClientExecutor, ClientExecutorResult } from '../../core/types';
import { toLegacyRenderableOutput, detectMediaTypeFromUrl } from '@/lib/workflow/result-format';
import { GraphDescription } from '../compositor/shared';
import { CompareConfig } from './definition';

/**
 * Per-handle envelope map attached to compare's published output. The three
 * input-building choke points read `__handleOutputs[edge.sourceHandle]` when an
 * edge's source is a compare node, so each output delivers its own side's data.
 */
export interface CompareHandleOutputs {
    output_a?: { type: 'image' | 'video'; data: any[] };
    output_b?: { type: 'image' | 'video'; data: any[] };
}

type CompareClientResult = (ClientExecutorResult & { __handleOutputs?: CompareHandleOutputs }) | null;

/**
 * Normalize one raw upstream value (string URL, ImageObject, or full envelope —
 * possibly carrying a live `graph`) into a clean output envelope, preserving the
 * graph/url/resolution so the passthrough is lossless. Mirrors blur's upstream
 * extraction. Returns null when the side carries no usable media.
 */
function buildSideEnvelope(raw: any): { type: 'image' | 'video'; data: any[] } | null {
    if (raw === undefined || raw === null) return null;

    const normalized = toLegacyRenderableOutput(raw);
    const first = Array.isArray(normalized) ? normalized[0] : normalized;
    if (first === undefined || first === null) return null;

    let url: string | null = null;
    let graph: GraphDescription | undefined;
    let resolution: { width: number; height: number } | undefined;

    if (typeof first === 'string') {
        url = first;
    } else if (typeof first === 'object') {
        if (typeof (first as any).url === 'string') url = (first as any).url;
        if ((first as any).graph) graph = (first as any).graph as GraphDescription;
        if ((first as any).resolution) resolution = (first as any).resolution;
    }

    const hasGraph = !!graph;
    if (!url && !hasGraph) return null;

    const kind: 'image' | 'video' = hasGraph
        ? 'video'
        : detectMediaTypeFromUrl(url!) === 'video'
            ? 'video'
            : 'image';

    if (kind === 'video') {
        return {
            type: 'video',
            data: [{
                url: url ?? '',
                ...(graph ? { graph } : {}),
                ...(resolution ? { resolution } : {}),
            }],
        };
    }

    return { type: 'image', data: [{ url: url! }] };
}

/**
 * Compare client executor — pure passthrough that publishes BOTH sides.
 *
 * Publishes:
 *   - a top-level envelope mirroring the PRIMARY side (A if wired, else B) so a
 *     naive downstream consumer that reads the whole node output degrades to
 *     showing input A. The secondary side is appended to `data` (never read by
 *     position-0 consumers) purely so `useNodeAutoCompute`'s content-equality
 *     gate detects changes on EITHER side and republishes — otherwise an update
 *     to input B alone would be skipped and never reach `output_b`'s consumers.
 *   - `__handleOutputs` carrying each side's own envelope for the per-handle
 *     routing carve-out.
 */
export const compareClientExecutor: ClientExecutor<CompareConfig> = (_config, inputs) => {
    const envA = buildSideEnvelope(inputs.input_a);
    const envB = buildSideEnvelope(inputs.input_b);

    if (!envA && !envB) return null;

    const handleOutputs: CompareHandleOutputs = {};
    if (envA) handleOutputs.output_a = envA;
    if (envB) handleOutputs.output_b = envB;

    const primary = envA ?? envB!;
    const secondary = envA ? envB : null;

    const result: CompareClientResult = {
        type: primary.type,
        // [primaryItem, secondaryItem?] — see header for the equality rationale.
        data: secondary ? [...primary.data, ...secondary.data] : [...primary.data],
        __handleOutputs: handleOutputs,
    };

    return result as unknown as ClientExecutorResult;
};
