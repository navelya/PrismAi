'use client';

import { useMemo } from 'react';
import { useAppStore } from '@/lib/store/app-store';
import { useShallow } from 'zustand/react/shallow';
import { toOutputEnvelope, NodeResultType } from '@/lib/workflow/result-format';

export type ResolvedValueEnvelope = { type: NodeResultType; data: any[] };

/**
 * Derive an envelope for a "source-of-truth" node directly from its config.
 * Source nodes hold their displayable value in config, so they don't need
 * to be executed to produce a preview-ready output.
 *
 * Returns null for node types whose value can only be produced by execution
 * (e.g. ai_generator, blur without a wired client executor).
 */
export function deriveEnvelopeFromConfig(
    nodeType: string | undefined,
    config: any
): ResolvedValueEnvelope | null {
    if (!nodeType || !config) return null;

    if (nodeType === 'prompt') {
        const text = typeof config.text === 'string' ? config.text : '';
        return toOutputEnvelope('text', text ? [text] : []);
    }

    if (nodeType === 'media_input') {
        const raw: any[] = Array.isArray(config.images) ? config.images : [];
        const items = raw
            .map((img) => (typeof img === 'string' ? { url: img } : img))
            .filter((img) => img && typeof img.url === 'string' && img.url.length > 0);
        return toOutputEnvelope('image', items);
    }

    return null;
}

/**
 * useResolvedNodeValue
 *
 * Returns the *current* output envelope for a node, regardless of how it was
 * produced. Read order:
 *   1. nodeOutputs[nodeId]                  (set by client compute, server execution, or source-node push)
 *   2. config-derived value for source nodes (Prompt text, MediaInput images)
 *   3. null
 *
 * This is the single read path consumers should use to display upstream data
 * without caring about the production pipeline.
 */
export function useResolvedNodeValue(nodeId: string | null | undefined): ResolvedValueEnvelope | any | null {
    const cached = useAppStore((state) => (nodeId ? state.nodeOutputs[nodeId] : undefined));

    const fallbackInputs = useAppStore(
        useShallow((state) => {
            if (!nodeId || cached !== undefined) return null;
            const node = state.currentWorkflow?.nodes.find((n) => n.id === nodeId);
            if (!node) return null;
            return { type: node.type as string, config: node.data?.config };
        })
    );

    return useMemo(() => {
        if (!nodeId) return null;
        if (cached !== undefined) return cached;
        if (!fallbackInputs) return null;
        return deriveEnvelopeFromConfig(fallbackInputs.type, fallbackInputs.config);
    }, [nodeId, cached, fallbackInputs]);
}
