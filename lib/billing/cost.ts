/**
 * Shared cost computation for the credits system.
 *
 * Pure functions — no I/O. The caller passes pre-fetched model data
 * (from the Zustand store on the client, or a DB query on the server).
 *
 * The same code runs on both sides so the modal estimate and the
 * authoritative server debit can never disagree by accident.
 */
import type { AiModel, Control } from '@/lib/nodes/types';

export interface CostNode {
    id: string;
    type: string;
    config?: {
        model_id?: number | string | null;
        control_values?: Record<string, any>;
        [key: string]: any;
    };
}

/**
 * Sanity ceiling on a single execution. If `computeExecutionCost` ever
 * returns a value above this, something is wrong (bad model row, bad
 * client config, malformed graph) — reject the run rather than silently
 * draining a user's balance.
 */
export const MAX_EXECUTION_COST = 10_000;

/**
 * 5% slack between client-shown cost and server-computed cost.
 * Within this band, server charges its own number. Above it, reject.
 */
export const COST_DRIFT_TOLERANCE = 0.05;

/**
 * Cost of a single ai_generator node:
 *   model.credit_cost
 *   + sum of cost_modifiers[selected_value]   (for select/checkbox controls)
 *   + sum of value × cost_per_unit            (for slider/number controls)
 */
export function computeAiNodeCost(
    controlValues: Record<string, any> | undefined,
    model: { credit_cost?: number | null; inputs_schema?: AiModel['inputs_schema'] | null }
): number {
    let total = Number(model.credit_cost ?? 0);
    if (!Number.isFinite(total)) total = 0;

    const controls: Control[] = model.inputs_schema?.controls ?? [];
    const values = controlValues ?? {};

    for (const ctrl of controls) {
        const val = values[ctrl.api_mapping_key] ?? ctrl.default_value;

        if (ctrl.cost_modifiers && val !== undefined && val !== null) {
            const key = typeof val === 'boolean' ? String(val) : String(val);
            const modifier = ctrl.cost_modifiers[key];
            if (typeof modifier === 'number' && Number.isFinite(modifier)) {
                total += modifier;
            }
        }

        if (typeof ctrl.cost_per_unit === 'number' && typeof val === 'number') {
            total += val * ctrl.cost_per_unit;
        }
    }

    return Math.max(0, total);
}

export interface ExecutionCostResult {
    cost: number;
    generativeCount: number;
    /** model_ids referenced by ai_generator nodes that we couldn't find. */
    missingModels: number[];
}

/**
 * Total cost of running a set of nodes. Only ai_generator nodes incur
 * cost today. Extend this function (don't add a parallel calc elsewhere)
 * if other paid node types are introduced.
 */
export function computeExecutionCost(
    nodes: CostNode[],
    modelsById: Map<number, AiModel>
): ExecutionCostResult {
    let cost = 0;
    let generativeCount = 0;
    const missingModels: number[] = [];

    for (const node of nodes) {
        if (node.type !== 'ai_generator') continue;

        const rawId = node.config?.model_id;
        const modelId = typeof rawId === 'string' ? Number(rawId) : rawId;
        if (!modelId || !Number.isFinite(modelId)) continue;

        const model = modelsById.get(modelId);
        if (!model) {
            missingModels.push(modelId);
            continue;
        }

        cost += computeAiNodeCost(node.config?.control_values, model);
        generativeCount++;
    }

    return {
        cost: Math.max(0, cost),
        generativeCount,
        missingModels,
    };
}

/**
 * Convenience: build the lookup map the cost functions expect.
 */
export function buildModelsMap(models: AiModel[]): Map<number, AiModel> {
    const map = new Map<number, AiModel>();
    for (const m of models) {
        if (m && typeof m.id === 'number') map.set(m.id, m);
    }
    return map;
}

/**
 * Display formatter for a NUMERIC(20,6) balance. Shows whole numbers
 * with no decimals; fractional values with up to 2 decimals trimmed.
 *   200.000000 → "200"
 *   199.500000 → "199.5"
 *   0.250000   → "0.25"
 */
export function formatCredits(amount: number | string | null | undefined): string {
    if (amount === null || amount === undefined) return '—';
    const n = typeof amount === 'string' ? Number(amount) : amount;
    if (!Number.isFinite(n)) return '—';
    if (Number.isInteger(n)) return n.toLocaleString();
    return Number(n.toFixed(2)).toLocaleString(undefined, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2,
    });
}
