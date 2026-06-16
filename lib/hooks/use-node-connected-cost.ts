import { useMemo } from 'react';
import { useAppStore } from '@/lib/store/app-store';
import { computeConnectedInputCost, type CostNode, type CostGraphContext } from '@/lib/billing/cost';
import type { AiModel } from '@/lib/nodes/types';

/**
 * Live credit cost contributed by the media (image/video) items wired INTO one
 * ai_generator node's priced input handles — the same `computeConnectedInputCost`
 * the run-modal total (`computeExecutionCost`) uses, scoped to a single node so the
 * node card + properties panel can show a cost that reacts to connecting an image.
 *
 * Reads `currentWorkflow` like `useNodeRunValidation`: only a handful of generative
 * nodes ever render a cost badge, so this per-node graph read is bounded — not the
 * O(n²) per-node case the shared providers were built to avoid.
 */
export function useNodeConnectedInputCost(
    nodeId: string | undefined,
    model: { inputs_schema?: AiModel['inputs_schema'] | null } | null | undefined,
): number {
    const workflow = useAppStore((s) => s.currentWorkflow);

    return useMemo(() => {
        if (!nodeId || !workflow || !model) return 0;
        const node = workflow.nodes.find(n => n.id === nodeId);
        if (!node) return 0;

        const costNode: CostNode = { id: node.id, type: node.type as string, config: node.data?.config };
        const graph: CostGraphContext = {
            allNodes: workflow.nodes.map(n => ({ id: n.id, type: n.type as string, config: n.data?.config })),
            edges: workflow.edges.map(e => ({ source: e.source, target: e.target, targetHandle: e.targetHandle ?? null })),
        };
        return computeConnectedInputCost(costNode, model, graph);
    }, [nodeId, workflow, model]);
}
