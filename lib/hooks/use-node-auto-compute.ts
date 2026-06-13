'use client';

import { useEffect, useRef } from 'react';
import { useAppStore } from '@/lib/store/app-store';
import { useShallow } from 'zustand/react/shallow';
import { clientRegistry } from '@/lib/nodes/core/client-registry';
import { ClientExecutor } from '@/lib/nodes/core/types';

const COMPUTE_DEBOUNCE_MS = 150;

/**
 * Envelope-level content equality. Compares two executor results shallowly
 * down to one level inside `data[]`. Used to skip `setNodeOutput` calls where
 * the executor produced an identical-by-content (but newly-allocated) result.
 *
 * Why this matters: every executor synthesizes a fresh envelope object per
 * run. If the run was triggered by an unrelated upstream churn (a sibling
 * republishing its own graph), our setNodeOutput writes a new envelope ref
 * with identical content. Downstream readers see "the value changed" and
 * re-execute, republishing back the same way. The propagation never
 * converges; React's commit phase ends up reattaching refs through Radix's
 * composed-refs setRef chain on every cycle, eventually tripping React #185
 * (Maximum update depth) inside that recursion.
 *
 * Comparison rules:
 *   - top-level: type + data array length
 *   - per data-item: shallow key compare
 *   - resolution {width,height}: compared by value (it's commonly a fresh
 *     object literal but trivially shallow-comparable)
 *   - graph (the sole live-signal shape): ref equality. Publishers
 *     stabilize the graph reference via content-equality at their publish
 *     site, so identical content produces identical reference. If a writer
 *     doesn't follow that contract, we pessimistically treat the envelope
 *     as changed — correct fallback.
 */
function envelopeContentEqual(a: any, b: any): boolean {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    if (a.type !== b.type) return false;
    const aData = Array.isArray(a.data) ? a.data : null;
    const bData = Array.isArray(b.data) ? b.data : null;
    if (aData === bData) return true;
    if (!aData || !bData) return false;
    if (aData.length !== bData.length) return false;
    for (let i = 0; i < aData.length; i++) {
        const ai = aData[i];
        const bi = bData[i];
        if (ai === bi) continue;
        if (!ai || !bi || typeof ai !== 'object' || typeof bi !== 'object') return false;
        const aKeys = Object.keys(ai);
        const bKeys = Object.keys(bi);
        if (aKeys.length !== bKeys.length) return false;
        for (const k of aKeys) {
            const av = ai[k];
            const bv = bi[k];
            if (av === bv) continue;
            if (
                k === 'resolution' &&
                av && bv &&
                typeof av === 'object' && typeof bv === 'object' &&
                av.width === bv.width && av.height === bv.height
            ) {
                continue;
            }
            return false;
        }
    }
    return true;
}

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
                let upstream = state.nodeOutputs[edge.source];
                if (upstream === undefined) return;
                // Per-handle routing for `compare`: it publishes a per-output
                // envelope map under `__handleOutputs` so each of its two
                // passthrough outputs delivers its own side's media (output_a /
                // output_b). Without this slice, both outputs would deliver the
                // whole-node envelope (input A) — the engine otherwise reads one
                // result per node, ignoring the source handle.
                const srcType = wf.nodes.find((n) => n.id === edge.source)?.type;
                if (srcType === 'compare') {
                    const sliced = (upstream as any)?.__handleOutputs?.[edge.sourceHandle ?? ''];
                    if (sliced !== undefined) upstream = sliced;
                }
                // Key by both the target handle (single-input nodes like Blur
                // read inputs.image) AND the edge id (Compositor stores
                // `layer.sourceHandleId = edge.id` because every layer edge
                // shares the same 'layers' target handle, so the per-edge id
                // is the only way to disambiguate which layer received which
                // upstream value). Upstream ai_generator nodes already publish
                // ONLY their active output into nodeOutputs, so no per-consumer
                // narrowing is needed here.
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
                if (!result) return;
                // Skip republish if content-equal to what's already there.
                // Otherwise every upstream churn would write a freshly-allocated
                // envelope, downstream would see "value changed" and re-execute,
                // and the propagation would never converge.
                const currentOutput = useAppStore.getState().nodeOutputs[nodeId];
                if (envelopeContentEqual(currentOutput, result)) return;
                setNodeOutput(nodeId, result);
            } catch (err) {
                console.error(`[useNodeAutoCompute] ${node.type} executor failed for ${nodeId}:`, err);
            }
        }, COMPUTE_DEBOUNCE_MS);

        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [node, inputs, nodeId, setNodeOutput]);
}
