/**
 * Run details for the invoice / usage views.
 *
 * Resolves, for a set of execution ids, WHICH ai model(s) ran in each run and
 * the media each produced — so a usage/invoice row ("Workflow run · −12") can
 * show the model (with its provider logo) next to a result thumbnail.
 *
 * Why this is reliable: `executions.graph_json` is an immutable snapshot taken
 * at dispatch time (see app/api/executions/start/route.ts). The node→model_id
 * mapping it encodes never changes, even if the user later edits the workflow,
 * so a historical run always reports the model that actually ran.
 *
 * Pass any Supabase client: the user-scoped client in user-facing routes (RLS
 * keeps it to the caller's own runs) or the service client in admin routes.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

export interface RunResultItem {
    /** Node id within this execution's graph snapshot. */
    nodeId: string;
    modelId: number | null;
    modelName: string;
    providerName: string | null;
    providerLogo: string | null;
    /** data_types id: image | video | audio | 3d | text | json (or null). */
    resultType: string | null;
    /** First media url — the thumbnail. */
    thumbnailUrl: string | null;
    /** Every media url this node produced (for click-to-expand / multi-output). */
    urls: string[];
    /** node_results.status — completed | failed | running | pending. */
    status: string;
}

export interface RunDetail {
    executionId: string;
    status: string;
    items: RunResultItem[];
}

const MEDIA_TYPES = new Set(['image', 'video', 'audio', '3d']);

/**
 * Pull the model_id out of a graph_json node. V2 node configs store user data
 * under `data` (either `data.config.model_id` or the flattened `data.model_id`);
 * older snapshots may use `config.model_id`. Mirrors the reads in cost.ts /
 * dispatch-v2 / the start route.
 */
function extractModelId(node: any): number | null {
    const data = node?.data ?? {};
    const inner = data.config ?? {};
    const raw = inner.model_id ?? data.model_id ?? node?.config?.model_id;
    const n = typeof raw === 'string' ? Number(raw) : raw;
    return Number.isFinite(n) ? Number(n) : null;
}

/** Keep only the http(s)/data-uri strings out of a node_results.result_data array. */
function mediaUrls(resultData: any): string[] {
    if (!Array.isArray(resultData)) return [];
    return resultData.filter(
        (v: any): v is string => typeof v === 'string' && (v.startsWith('http') || v.startsWith('data:'))
    );
}

/** PostgREST returns a to-one embed as an object, but normalize an array just in case. */
function normalizeProvider(raw: any): { name: string | null; logo_url: string | null } | null {
    const p = Array.isArray(raw) ? raw[0] : raw;
    if (!p) return null;
    return { name: p.name ?? null, logo_url: p.logo_url ?? null };
}

export async function getRunDetails(
    supabase: SupabaseClient,
    executionIds: string[]
): Promise<Map<string, RunDetail>> {
    const ids = Array.from(new Set(executionIds.filter((id): id is string => !!id)));
    const byExec = new Map<string, RunDetail>();
    if (ids.length === 0) return byExec;

    // 1. Execution snapshots → per-execution node_id → model_id (ai_generator only).
    const { data: execs } = await supabase
        .from('executions')
        .select('id, status, graph_json')
        .in('id', ids);

    const modelByNode = new Map<string, Map<string, number | null>>();
    const modelIds = new Set<number>();
    for (const ex of execs ?? []) {
        const nodeMap = new Map<string, number | null>();
        const nodes = Array.isArray((ex as any).graph_json?.nodes) ? (ex as any).graph_json.nodes : [];
        for (const node of nodes) {
            if (node?.type !== 'ai_generator') continue;
            const mid = extractModelId(node);
            nodeMap.set(node.id, mid);
            if (mid != null) modelIds.add(mid);
        }
        modelByNode.set((ex as any).id, nodeMap);
        byExec.set((ex as any).id, { executionId: (ex as any).id, status: (ex as any).status ?? 'unknown', items: [] });
    }

    // 2. Model catalog — display name + provider logo, one batched query.
    const modelInfo = new Map<number, { display_name: string; provider: { name: string | null; logo_url: string | null } | null }>();
    if (modelIds.size > 0) {
        const { data: models } = await supabase
            .from('ai_models')
            .select('id, display_name, providers(name, logo_url)')
            .in('id', Array.from(modelIds));
        for (const m of models ?? []) {
            modelInfo.set((m as any).id, {
                display_name: (m as any).display_name,
                provider: normalizeProvider((m as any).providers),
            });
        }
    }

    // 3. Node results → attach media + model to each ai_generator node's run.
    const { data: results } = await supabase
        .from('node_results')
        .select('execution_id, node_id, result_type, result_data, status')
        .in('execution_id', ids);

    for (const r of results ?? []) {
        const detail = byExec.get((r as any).execution_id);
        if (!detail) continue;
        const nodeMap = modelByNode.get((r as any).execution_id);
        if (!nodeMap || !nodeMap.has((r as any).node_id)) continue; // ai_generator nodes only
        const modelId = nodeMap.get((r as any).node_id) ?? null;
        const info = modelId != null ? modelInfo.get(modelId) : undefined;
        const resultType = (r as any).result_type ?? null;
        const urls = resultType && MEDIA_TYPES.has(resultType) ? mediaUrls((r as any).result_data) : [];
        detail.items.push({
            nodeId: (r as any).node_id,
            modelId,
            modelName: info?.display_name ?? 'AI model',
            providerName: info?.provider?.name ?? null,
            providerLogo: info?.provider?.logo_url ?? null,
            resultType,
            thumbnailUrl: urls[0] ?? null,
            urls,
            status: (r as any).status,
        });
    }

    // Stable ordering: nodes with a visible result first.
    for (const detail of byExec.values()) {
        detail.items.sort((a, b) => Number(!!b.thumbnailUrl) - Number(!!a.thumbnailUrl));
    }

    return byExec;
}
