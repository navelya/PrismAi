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

/** Iterations are clamped to [1, 10]; non-numeric/empty → 1. Multiplies a node's cost. */
export function clampIterations(value: any): number {
    const n = Math.trunc(Number(value));
    if (!Number.isFinite(n)) return 1;
    return Math.max(1, Math.min(10, n));
}

/**
 * Optional graph context for connected-media pricing. When supplied to
 * computeExecutionCost, each ai_generator node is additionally charged for the
 * image/video items wired into its media input handles. Counted from the FULL
 * graph (not the trimmed execution set) so the client estimate and the server
 * debit produce the same number and never trip COST_DRIFT_TOLERANCE.
 */
export interface CostGraphContext {
    /** Every node in the workflow — used to resolve each edge's source node. */
    allNodes: CostNode[];
    /** Every edge in the workflow. */
    edges: { source: string; target: string; targetHandle?: string | null }[];
}

/**
 * Cost of the items wired into a single ai_generator node's input handles.
 * Each input handle may declare `cost_per_item`. By default this is charged
 * per connected item; if the handle sets `cost_is_one_time`, it is charged
 * once when ≥1 item is connected (and not at all when 0 are). A media_input
 * source contributes config.images.length items; any other source contributes
 * 1 per edge. Returns the summed cost across all priced handles on this node.
 */
export function computeConnectedInputCost(
    node: CostNode,
    model: { inputs_schema?: AiModel['inputs_schema'] | null },
    graph: CostGraphContext
): number {
    // handle id (api_mapping_key) -> { cost, oneTime }, for priced handles only.
    const handleCost = new Map<string, { cost: number; oneTime: boolean }>();
    for (const h of model.inputs_schema?.handles ?? []) {
        const c = Number((h as any).cost_per_item ?? 0);
        const key = (h as any).api_mapping_key;
        if (key && Number.isFinite(c) && c > 0) {
            handleCost.set(key, { cost: c, oneTime: !!(h as any).cost_is_one_time });
        }
    }
    if (handleCost.size === 0) return 0;

    const nodeById = new Map(graph.allNodes.map(n => [n.id, n]));
    // Tally connected units per priced handle, then price each handle once —
    // one-time handles must charge a flat fee regardless of edge/item count.
    const unitsByHandle = new Map<string, number>();
    for (const edge of graph.edges) {
        if (edge.target !== node.id) continue;
        const key = edge.targetHandle ?? undefined;
        if (!key || !handleCost.has(key)) continue;
        const source = nodeById.get(edge.source);
        let units = 1;
        if (source?.type === 'media_input') {
            const imgs = (source.config as any)?.images;
            units = Array.isArray(imgs) ? imgs.length : 0;
        }
        unitsByHandle.set(key, (unitsByHandle.get(key) ?? 0) + units);
    }

    let total = 0;
    for (const [key, { cost, oneTime }] of handleCost) {
        const units = unitsByHandle.get(key) ?? 0;
        if (units <= 0) continue;
        total += oneTime ? cost : units * cost;
    }
    return total;
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
 *   1. additive total = model.credit_cost
 *                     + sum of cost_modifiers[selected_value]   (select/checkbox controls)
 *                     + sum of value × cost_per_unit            (slider/number controls)
 *   2. multiplier     = product of every numeric control with is_cost_multiplier === true,
 *                       coercing each value to Number. Values that are NaN or < 1 contribute 1
 *                       (so an empty/zero/non-numeric input cannot zero out a charge).
 *   3. result         = additive total × multiplier
 *
 * Same code runs on client and server, so the modal estimate and the
 * authoritative server debit cannot drift apart.
 */
export function computeAiNodeCost(
    controlValues: Record<string, any> | undefined,
    model: { credit_cost?: number | null; inputs_schema?: AiModel['inputs_schema'] | null }
): number {
    let total = Number(model.credit_cost ?? 0);
    if (!Number.isFinite(total)) total = 0;

    const controls: Control[] = model.inputs_schema?.controls ?? [];
    const values = controlValues ?? {};

    // Pass 1: additive (existing behavior, preserved verbatim).
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

    // Pass 2: multiplier. Every is_cost_multiplier control multiplies the running total.
    let multiplier = 1;
    for (const ctrl of controls) {
        if (!ctrl.is_cost_multiplier) continue;
        const val = values[ctrl.api_mapping_key] ?? ctrl.default_value;
        const n = Number(val);
        if (!Number.isFinite(n) || n < 1) continue; // clamp guards against zeroing the charge
        multiplier *= n;
    }

    return Math.max(0, total * multiplier);
}

/** api_mapping_keys that denote a video DURATION in seconds (for the per-second
 *  menu estimate). Mirrors the multiplier auto-detect set, minus frame counts. */
const DURATION_SECONDS_KEY_REGEX = /(^|_)(duration|length|seconds|num_seconds|video_length)(_|$)/i;

/**
 * The default credit cost to show next to a model in the picker menus (add-node
 * panel + canvas context menu).
 *
 * - Image / non-temporal models → the plain default node cost (no suffix).
 * - Video models → a PER-SECOND rate (shown with a `/s` suffix), so the duration's
 *   default selection never inflates the headline number:
 *     • a numeric `is_cost_multiplier` control (the app's standard duration/frames
 *       knob): the cost with every multiplier forced to 1 — i.e. total ÷ seconds.
 *     • a duration-in-seconds control rendered as a dropdown (e.g. 5 / 10): the
 *       default total ÷ the default-selected seconds (30 / 5 = 6).
 *     • an `is_per_second` model with no duration control: credit_cost is already
 *       per-second, used as-is.
 */
export function computeModelMenuCost(
    model: { credit_cost?: number | null; is_per_second?: boolean | null; inputs_schema?: AiModel['inputs_schema'] | null }
): { credits: number; perSecond: boolean } {
    const controls: Control[] = model.inputs_schema?.controls ?? [];
    const fullCost = computeAiNodeCost(undefined, model);

    // Case 1: explicit cost-multiplier control(s) — force each to 1 second/frame.
    const multiplierControls = controls.filter(c => c.is_cost_multiplier === true);
    if (multiplierControls.length > 0) {
        const overrides: Record<string, any> = {};
        for (const c of multiplierControls) overrides[c.api_mapping_key] = 1;
        return { credits: computeAiNodeCost(overrides, model), perSecond: true };
    }

    // Case 2: a duration-in-seconds control (e.g. a 5 / 10 dropdown). Divide the
    // default total by the default-selected number of seconds.
    const durationCtrl = controls.find(c => DURATION_SECONDS_KEY_REGEX.test(c.api_mapping_key));
    const durationSeconds = durationCtrl ? Number(durationCtrl.default_value) : NaN;
    if (durationCtrl && Number.isFinite(durationSeconds) && durationSeconds >= 1) {
        return { credits: fullCost / durationSeconds, perSecond: true };
    }

    // Case 3: per-second billing flag, no duration control — already per-second.
    if (model.is_per_second) {
        return { credits: fullCost, perSecond: true };
    }

    // Otherwise: image / non-temporal model.
    return { credits: fullCost, perSecond: false };
}

export interface ExecutionCostResult {
    cost: number;
    generativeCount: number;
    /** model_ids referenced by ai_generator nodes that we couldn't find. */
    missingModels: number[];
    /**
     * Per-node credit cost, keyed by node id. Only ai_generator nodes that
     * incurred a cost appear here. Captured so a later partial refund (e.g. a
     * user cancelling mid-run) can credit back the EXACT amount charged for the
     * nodes that never dispatched — no recomputation, no drift, no over-refund.
     */
    costByNode: Record<string, number>;
}

/**
 * Total cost of running a set of nodes. Only ai_generator nodes incur
 * cost today. Extend this function (don't add a parallel calc elsewhere)
 * if other paid node types are introduced.
 */
export function computeExecutionCost(
    nodes: CostNode[],
    modelsById: Map<number, AiModel>,
    graph?: CostGraphContext
): ExecutionCostResult {
    let cost = 0;
    let generativeCount = 0;
    const missingModels: number[] = [];
    const costByNode: Record<string, number> = {};

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

        let nodeCost = computeAiNodeCost(node.config?.control_values, model);

        if (graph) {
            nodeCost += computeConnectedInputCost(node, model, graph);
        }

        nodeCost *= clampIterations(node.config?.iterations);

        const finalNodeCost = Math.max(0, nodeCost);
        cost += finalNodeCost;
        costByNode[node.id] = finalNodeCost;
        generativeCount++;
    }

    return {
        cost: Math.max(0, cost),
        generativeCount,
        missingModels,
        costByNode,
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
