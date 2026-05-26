/**
 * Run-plan computation for chat-triggered runs.
 *
 * Pure — no I/O. Given the current workflow and the set of node ids the AI
 * touched this turn, decide what would run, what the terminal (leaf) outputs
 * are, and what it costs.
 *
 * Cost is computed via computeExecutionCost (the same pure function the editor
 * and server use) so the chat estimate, the editor modal, and the server debit
 * cannot drift apart.
 */
import type { AiModel } from '@/lib/nodes/types';
import { computeExecutionCost, type CostNode } from './cost';

export interface RunPlanWorkflow {
    nodes: { id: string; type?: string | null; data?: any }[];
    edges: { source: string; target: string; targetHandle?: string | null }[];
}

export interface RunPlan {
    /** Node ids passed to the server as the selection run target set. */
    runTargetIds: string[];
    /** Leaves of the touched subgraph — their outputs are shown inline. */
    terminalIds: string[];
    /** Estimated credit cost of the run (only ai_generator nodes cost). */
    cost: number;
    /** Number of ai_generator nodes that will run. */
    generativeCount: number;
    /** model_ids on ai_generator targets that weren't found in the client map (treated as 0 cost). */
    missingModels: number[];
}

const EMPTY_PLAN: RunPlan = Object.freeze({ runTargetIds: [], terminalIds: [], cost: 0, generativeCount: 0, missingModels: [] });

/**
 * @param workflow      current full workflow (nodes + edges)
 * @param touchedNodeIds aiTurn.touchedNodeIds — union of nodes the AI added/updated this turn
 * @param modelsById     model lookup (from buildModelsMap)
 */
export function buildRunPlan(
    workflow: RunPlanWorkflow | null | undefined,
    touchedNodeIds: string[] | null | undefined,
    modelsById: Map<number, AiModel>
): RunPlan {
    if (!workflow || !touchedNodeIds || touchedNodeIds.length === 0) return EMPTY_PLAN;

    const nodeById = new Map(workflow.nodes.map((n) => [n.id, n]));
    // Only touched nodes that still exist in the graph are runnable targets.
    const runTargetIds = touchedNodeIds.filter((id) => nodeById.has(id));
    if (runTargetIds.length === 0) return EMPTY_PLAN;

    const targetSet = new Set(runTargetIds);

    // Terminal = a target node with no outgoing edge to ANOTHER target node.
    const hasDownstreamTarget = new Set<string>();
    for (const e of workflow.edges) {
        if (targetSet.has(e.source) && targetSet.has(e.target)) {
            hasDownstreamTarget.add(e.source);
        }
    }
    const terminalIds = runTargetIds.filter((id) => !hasDownstreamTarget.has(id));

    // Cost: mirror the editor's 'selection' path — charge ai_generator nodes in
    // the target set, with full-graph context for connected-media pricing.
    const costNodes: CostNode[] = [];
    for (const id of runTargetIds) {
        const n = nodeById.get(id);
        if (!n) continue;
        costNodes.push({ id, type: (n.type as string) ?? '', config: n.data?.config });
    }
    const graph = {
        allNodes: workflow.nodes.map((n) => ({
            id: n.id,
            type: (n.type as string) ?? '',
            config: n.data?.config,
        })),
        edges: workflow.edges.map((e) => ({
            source: e.source,
            target: e.target,
            targetHandle: e.targetHandle ?? null,
        })),
    };

    const { cost, generativeCount, missingModels } = computeExecutionCost(costNodes, modelsById, graph);
    return { runTargetIds, terminalIds, cost, generativeCount, missingModels };
}
