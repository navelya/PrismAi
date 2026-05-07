'use client';

import { useEffect, useRef } from 'react';
import { useAppStore } from '@/lib/store/app-store';
import { useShallow } from 'zustand/react/shallow';
import { clientRegistry } from '@/lib/nodes/core/client-registry';
import { ClientExecutor } from '@/lib/nodes/core/types';

const COMPUTE_DEBOUNCE_MS = 150;

/**
 * useNodeAutoCompute
 *
 * Drives client-side computation for any node whose plugin defines a
 * `clientExecutor` (see `NodeClientDef.clientExecutor`). Mount it from inside
 * the node's React component:
 *
 *     useNodeAutoCompute(id);
 *
 * Behavior:
 *   1. Walks edges into this node, builds an `inputs` map keyed by
 *      `targetHandle` (or 'image' for the legacy unnamed input), with values
 *      taken from the upstream's resolved entry in `nodeOutputs`.
 *   2. When `(config, inputs)` changes, runs the plugin's clientExecutor
 *      after a short debounce (~150ms — coalesces slider drags).
 *   3. Writes the executor's envelope into `nodeOutputs[id]` so every
 *      downstream consumer (Compositor preview, the next ephemeral node, etc.)
 *      sees it via the same `useResolvedNodeValue` / `nodeOutputs[edge.source]`
 *      read path used for source nodes and server-executed nodes.
 *
 * No-op for nodes whose plugin doesn't declare a clientExecutor.
 */
export function useNodeAutoCompute(nodeId: string): void {
    // Subscribe narrowly: only this node's type/config and its upstream values.
    const node = useAppStore(
        useShallow((state) => {
            const n = state.currentWorkflow?.nodes.find((x) => x.id === nodeId);
            if (!n) return null;
            return { type: n.type as string, config: n.data?.config };
        })
    );

    const inputs = useAppStore(
        useShallow((state) => {
            const wf = state.currentWorkflow;
            if (!wf) return null as Record<string, any> | null;
            const incoming = wf.edges.filter((e) => e.target === nodeId);
            if (incoming.length === 0) return null;
            const out: Record<string, any> = {};
            incoming.forEach((edge) => {
                const handleKey = edge.targetHandle || 'image';
                const upstream = state.nodeOutputs[edge.source];
                if (upstream === undefined) return;
                // Key by both the target handle (single-input nodes like Blur
                // read inputs.image) AND the edge id (Compositor stores
                // `layer.sourceHandleId = edge.id` because every layer edge
                // shares the same 'layers' target handle, so the per-edge id
                // is the only way to disambiguate which layer received which
                // upstream value).
                out[handleKey] = upstream;
                out[edge.id] = upstream;
            });
            return out;
        })
    );

    const setNodeOutput = useAppStore((state) => state.setNodeOutput);

    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Track the latest run so a debounce that fires after the component
    // unmounts (or after another input changes) doesn't write stale output.
    const runIdRef = useRef(0);

    useEffect(() => {
        if (!node) return;
        const def = clientRegistry[node.type];
        const executor: ClientExecutor | undefined = def?.clientExecutor;
        if (!executor) return;

        if (!inputs) {
            // Upstream just disconnected (or never connected). Clear any
            // previously-cached output so downstream consumers don't keep
            // showing a stale result.
            const cached = useAppStore.getState().nodeOutputs[nodeId];
            if (cached !== undefined) {
                setNodeOutput(nodeId, undefined);
            }
            return;
        }

        if (debounceRef.current) clearTimeout(debounceRef.current);
        const myRun = ++runIdRef.current;

        debounceRef.current = setTimeout(async () => {
            try {
                const result = await executor(node.config, inputs);
                if (myRun !== runIdRef.current) return; // superseded
                if (result) {
                    setNodeOutput(nodeId, result);
                }
            } catch (err) {
                console.error(`[useNodeAutoCompute] ${node.type} executor failed for ${nodeId}:`, err);
            }
        }, COMPUTE_DEBOUNCE_MS);

        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [node, inputs, nodeId, setNodeOutput]);
}
