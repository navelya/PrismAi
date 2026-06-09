/**
 * Collect — client live-preview executor.
 *
 * Mirrors the server logic over the live `nodeOutputs` envelopes that
 * useNodeAutoCompute feeds in (one per incoming edge, keyed by edge id). The
 * result envelope is written into nodeOutputs[id] so the card renders the
 * collected items and downstream consumers see the array immediately.
 *
 * Note: an upstream ai_generator only publishes its ACTIVE item into the live
 * store, so in OFF (flatten) mode its non-active variations appear only after
 * an actual Run (the server reads the full result_data). That's a live-preview
 * limitation, not a Run-time one.
 */
import { ClientExecutor, NodeDataType } from '../../core/types';
import { CollectConfig } from './definition';
import { collectItems } from './shared';

export const collectClientExecutor: ClientExecutor<CollectConfig> = (config, inputs) => {
    if (typeof window === 'undefined') return null;
    const { items, type } = collectItems(config || ({} as CollectConfig), inputs || {});
    if (items.length === 0) return null;
    return { type: type as NodeDataType, data: items };
};
