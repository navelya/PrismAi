import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';
import { createServiceClient } from '@/lib/supabase/service';
import { loadUserDirectory, type UserDirectoryEntry } from '@/lib/admin/users';
import type { AdminNodeResultItem, NodeResultType } from '@/lib/api/admin-node-results';

export const dynamic = 'force-dynamic';

const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 48;
const RESULT_TYPES: NodeResultType[] = ['image', 'video', 'audio', '3d'];

/**
 * Admin browser for every media result any user has generated. Paginates over
 * `node_results` rows (most-recent first), unpacks each row's `result_data`
 * JSONB into individual media items, and stitches in the owning user's
 * identity via the session → user_id link. `character` snapshots (republished
 * reference images) are excluded — same "deliverable assets" definition the
 * user-facing gallery uses.
 */
export async function GET(req: NextRequest) {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const url = req.nextUrl;
    const page = Math.max(0, parseInt(url.searchParams.get('page') ?? '0', 10) || 0);
    const pageSize = Math.min(
        MAX_PAGE_SIZE,
        Math.max(1, parseInt(url.searchParams.get('pageSize') ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE),
    );
    const typeFilter = (url.searchParams.get('type') ?? 'all').toLowerCase();
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();

    try {
        const service = createServiceClient();
        const directory = await loadUserDirectory();

        // Resolve a free-text query to the set of owning user ids it matches
        // (email / username / id). Filtering node_results by these ids keeps
        // search server-side and consistent across pages.
        let userIdFilter: string[] | null = null;
        if (q) {
            userIdFilter = [];
            for (const entry of directory.values()) {
                const email = (entry.email ?? '').toLowerCase();
                const name = (entry.username ?? '').toLowerCase();
                if (email.includes(q) || name.includes(q) || entry.id.toLowerCase().includes(q)) {
                    userIdFilter.push(entry.id);
                }
            }
            if (userIdFilter.length === 0) {
                return NextResponse.json({ rows: [], page, pageSize, hasMore: false });
            }
        }

        const start = page * pageSize;
        const end = start + pageSize - 1;

        let query = service
            .from('node_results')
            .select('id, node_id, node_type, result_type, result_data, created_at, execution_id, session_id, sessions!inner(user_id)')
            .eq('status', 'completed')
            .in('result_type', RESULT_TYPES as unknown as string[])
            .or('node_type.is.null,node_type.neq.character')
            .order('created_at', { ascending: false })
            .range(start, end);

        if ((RESULT_TYPES as string[]).includes(typeFilter)) {
            query = query.eq('result_type', typeFilter);
        }
        if (userIdFilter) {
            query = query.in('sessions.user_id', userIdFilter);
        }

        const { data, error } = await query;
        if (error) throw error;

        const rows = data ?? [];
        const items = unpack(rows, directory);

        // `hasMore` is based on whether the row page was full — item count per
        // page varies because a row can carry multiple media URLs.
        return NextResponse.json({ rows: items, page, pageSize, hasMore: rows.length === pageSize });
    } catch (err: any) {
        console.error('[Admin Node Results API] error:', err);
        return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
    }
}

function unpack(rows: any[], directory: Map<string, UserDirectoryEntry>): AdminNodeResultItem[] {
    const out: AdminNodeResultItem[] = [];
    const seenUrls = new Set<string>();

    for (const row of rows) {
        const type = row?.result_type as NodeResultType;
        if (!RESULT_TYPES.includes(type)) continue;

        // `sessions!inner(user_id)` arrives as an object for a to-one relation,
        // but tolerate an array shape just in case.
        const rel = row?.sessions;
        const userId: string | null = Array.isArray(rel) ? (rel[0]?.user_id ?? null) : (rel?.user_id ?? null);
        const dir = userId ? directory.get(userId) : undefined;

        const values = Array.isArray(row?.result_data) ? row.result_data : [];
        values.forEach((item: any, index: number) => {
            if (typeof item !== 'string') return;
            if (!(item.startsWith('http') || item.startsWith('data:'))) return;
            if (seenUrls.has(item)) return;
            seenUrls.add(item);
            out.push({
                id: `${row.id}:${index}`,
                source_result_id: row.id,
                node_id: row.node_id,
                node_type: row.node_type ?? null,
                result_type: type,
                result_url: item,
                created_at: row.created_at,
                execution_id: row.execution_id ?? null,
                session_id: row.session_id ?? null,
                user_id: userId,
                user_email: dir?.email ?? null,
                user_name: dir?.username ?? null,
                user_avatar_url: dir?.avatar_url ?? null,
            });
        });
    }
    return out;
}
