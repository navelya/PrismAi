import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';
import { createServiceClient } from '@/lib/supabase/service';
import type { GraphJson, NodeConfig } from '@/lib/workflow/types-v2';

export const dynamic = 'force-dynamic';

// The orchestrator attributes the real error to the failed node (or its nearest
// non-ephemeral consumer) and stamps everything else downstream with this
// sentinel. Those are propagation noise, not root causes, so we drop them.
const BLOCKED_SENTINEL = 'Blocked by upstream failure';

// Most recent failures we enrich + scan per request. Keeps the join/enrich work
// bounded; the window filter usually keeps the real count well under this.
const FETCH_CAP = 500;
const DEFAULT_DAYS = 7;

interface FailureRequest {
    nodeType: string;
    label: string | null;
    model: string | null;       // resolved display name, or the raw model_id as text
    prompt: string | null;
    config: Record<string, any>; // full reconstructed node config (raw)
}

interface AdminFailure {
    id: string;
    executionId: string;
    sessionId: string | null;
    nodeId: string;
    resultType: string | null;
    error: string;
    failedAt: string;
    user: { id: string | null; email: string | null };
    sessionTitle: string | null;
    request: FailureRequest;
}

export async function GET(req: NextRequest) {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const url = req.nextUrl;
    const days = Math.max(1, parseInt(url.searchParams.get('days') ?? String(DEFAULT_DAYS), 10) || DEFAULT_DAYS);
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
    const page = Math.max(0, parseInt(url.searchParams.get('page') ?? '0', 10) || 0);
    const pageSize = Math.min(200, Math.max(1, parseInt(url.searchParams.get('pageSize') ?? '50', 10) || 50));

    const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    try {
        const sb = createServiceClient();

        // 1) Root-cause failures in the window. `error != sentinel` strips the
        //    "blocked by upstream" propagation rows; failed nodes always carry a
        //    non-null error, so an explicit NOT-equals is enough.
        const { data: rawRows, error: rowsErr } = await sb
            .from('node_results')
            .select('id, execution_id, node_id, session_id, status, result_type, error, updated_at')
            .eq('status', 'failed')
            .neq('error', BLOCKED_SENTINEL)
            .gte('updated_at', sinceIso)
            .order('updated_at', { ascending: false })
            .limit(FETCH_CAP);
        if (rowsErr) throw rowsErr;

        const rows = rawRows ?? [];
        if (rows.length === 0) {
            return NextResponse.json({
                failures: [],
                summary: emptySummary(),
                total: 0,
                page,
                pageSize,
                days,
                capped: false,
            });
        }

        // 2) Parent executions (for graph_json + session_id).
        const executionIds = Array.from(new Set(rows.map(r => r.execution_id).filter(Boolean)));
        const { data: execs } = await sb
            .from('executions')
            .select('id, graph_json, session_id')
            .in('id', executionIds);
        const execById = new Map((execs ?? []).map(e => [e.id, e]));

        // 3) Sessions (for user_id + title).
        const sessionIds = Array.from(new Set(
            [...rows.map(r => r.session_id), ...(execs ?? []).map(e => e.session_id)].filter(Boolean) as string[]
        ));
        const { data: sessions } = sessionIds.length
            ? await sb.from('sessions').select('id, user_id, title').in('id', sessionIds)
            : { data: [] as any[] };
        const sessionById = new Map((sessions ?? []).map(s => [s.id, s]));

        // 4) Emails — resolved via the auth admin API, same as the Users tab
        //    (there is no email column on profiles).
        const userIds = Array.from(new Set(
            (sessions ?? []).map(s => s.user_id).filter(Boolean) as string[]
        ));
        const emailById = new Map<string, string | null>();
        await Promise.all(userIds.map(async (uid) => {
            try {
                const { data } = await sb.auth.admin.getUserById(uid);
                emailById.set(uid, data?.user?.email ?? null);
            } catch {
                emailById.set(uid, null);
            }
        }));

        // 5) Model display names for any numeric model_id referenced.
        const modelIds = new Set<number>();
        for (const row of rows) {
            const node = findNode(execById.get(row.execution_id)?.graph_json, row.node_id);
            const mid = modelIdOf(node);
            if (typeof mid === 'number') modelIds.add(mid);
        }
        const modelNameById = new Map<number, string>();
        if (modelIds.size > 0) {
            const { data: models } = await sb
                .from('ai_models')
                .select('id, display_name')
                .in('id', Array.from(modelIds));
            for (const m of models ?? []) modelNameById.set(m.id, m.display_name);
        }

        // 6) Assemble enriched failures.
        const enriched: AdminFailure[] = rows.map((row) => {
            const exec = execById.get(row.execution_id);
            const sessionId = row.session_id ?? exec?.session_id ?? null;
            const session = sessionId ? sessionById.get(sessionId) : null;
            const userId = session?.user_id ?? null;
            const node = findNode(exec?.graph_json, row.node_id);
            const cfg: Record<string, any> = (node?.data?.config as any) ?? (node?.data as any) ?? {};
            const mid = modelIdOf(node);
            const modelName = typeof mid === 'number'
                ? (modelNameById.get(mid) ?? `#${mid}`)
                : (node?.data?.model ?? null);

            return {
                id: row.id,
                executionId: row.execution_id,
                sessionId,
                nodeId: row.node_id,
                resultType: row.result_type ?? null,
                error: row.error ?? 'Unknown error',
                failedAt: row.updated_at,
                user: { id: userId, email: userId ? (emailById.get(userId) ?? null) : null },
                sessionTitle: session?.title ?? null,
                request: {
                    nodeType: node?.type ?? 'unknown',
                    label: (node?.data?.label as string) ?? null,
                    model: modelName,
                    prompt: (cfg.prompt as string) ?? (node?.data?.prompt as string) ?? null,
                    config: cfg,
                },
            };
        });

        // 7) Free-text search across error / email / model / node type.
        const filtered = q
            ? enriched.filter(f =>
                f.error.toLowerCase().includes(q) ||
                (f.user.email ?? '').toLowerCase().includes(q) ||
                (f.request.model ?? '').toLowerCase().includes(q) ||
                f.request.nodeType.toLowerCase().includes(q))
            : enriched;

        // 8) Summary over the filtered window set (before pagination).
        const summary = buildSummary(filtered);

        // 9) Paginate.
        const total = filtered.length;
        const start = page * pageSize;
        const slice = filtered.slice(start, start + pageSize);

        return NextResponse.json({
            failures: slice,
            summary,
            total,
            page,
            pageSize,
            days,
            capped: rows.length >= FETCH_CAP,
        });
    } catch (err: any) {
        console.error('[Admin Failures] error:', err);
        return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
    }
}

function findNode(graph: GraphJson | undefined | null, nodeId: string): NodeConfig | undefined {
    if (!graph?.nodes) return undefined;
    return graph.nodes.find(n => n.id === nodeId);
}

function modelIdOf(node: NodeConfig | undefined): number | null {
    if (!node) return null;
    const fromConfig = (node.data?.config as any)?.model_id;
    const fromData = (node.data as any)?.model_id;
    const v = fromConfig ?? fromData;
    return typeof v === 'number' ? v : null;
}

function emptySummary() {
    return { totalFailures: 0, usersAffected: 0, topError: null as string | null, topModel: null as string | null };
}

function buildSummary(failures: AdminFailure[]) {
    const users = new Set<string>();
    const errorCounts = new Map<string, number>();
    const modelCounts = new Map<string, number>();
    for (const f of failures) {
        if (f.user.id) users.add(f.user.id);
        const errKey = f.error.slice(0, 120);
        errorCounts.set(errKey, (errorCounts.get(errKey) ?? 0) + 1);
        const modelKey = f.request.model ?? f.request.nodeType;
        if (modelKey) modelCounts.set(modelKey, (modelCounts.get(modelKey) ?? 0) + 1);
    }
    return {
        totalFailures: failures.length,
        usersAffected: users.size,
        topError: topKey(errorCounts),
        topModel: topKey(modelCounts),
    };
}

function topKey(counts: Map<string, number>): string | null {
    let best: string | null = null;
    let bestN = 0;
    for (const [k, n] of counts) {
        if (n > bestN) { best = k; bestN = n; }
    }
    return best;
}
