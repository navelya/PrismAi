import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

const MAX_PAGE_SIZE = 200;
const RESULT_TYPES = ['image', 'video', 'audio', '3d'] as const;

type AssetType = typeof RESULT_TYPES[number];

interface AssetItem {
    id: string;
    source_result_id: string;
    node_id: string;
    result_type: AssetType;
    result_url: string;
    session_id: string | null;
    execution_id: string | null;
    created_at: string;
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const id = params.id;
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const url = req.nextUrl;
    const page = Math.max(0, parseInt(url.searchParams.get('page') ?? '0', 10) || 0);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(url.searchParams.get('pageSize') ?? '36', 10) || 36));
    const typeFilter = (url.searchParams.get('type') ?? 'all').toLowerCase();

    try {
        const service = createServiceClient();

        let query = service
            .from('node_results')
            .select('id, node_id, result_type, result_data, created_at, execution_id, session_id, sessions!inner(user_id)')
            .eq('sessions.user_id', id)
            .eq('status', 'completed')
            .in('result_type', RESULT_TYPES as unknown as string[])
            .order('created_at', { ascending: false })
            .limit(1000);

        if (RESULT_TYPES.includes(typeFilter as AssetType)) {
            query = query.eq('result_type', typeFilter);
        }

        const { data, error } = await query;
        if (error) throw error;

        const unpacked = unpackAssets(data ?? []);
        const total = unpacked.length;
        const start = page * pageSize;
        const slice = unpacked.slice(start, start + pageSize);

        return NextResponse.json({ rows: slice, total, page, pageSize });
    } catch (err: any) {
        console.error('[Admin Users API] assets error:', err);
        return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
    }
}

function unpackAssets(rows: any[]): AssetItem[] {
    const out: AssetItem[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
        const type = row?.result_type as AssetType;
        if (!RESULT_TYPES.includes(type)) continue;
        const values = Array.isArray(row?.result_data) ? row.result_data : [];
        values.forEach((item: any, index: number) => {
            if (typeof item !== 'string') return;
            if (!(item.startsWith('http') || item.startsWith('data:'))) return;
            if (seen.has(item)) return;
            seen.add(item);
            out.push({
                id: `${row.id}:${index}`,
                source_result_id: row.id,
                node_id: row.node_id,
                result_type: type,
                result_url: item,
                session_id: row.session_id ?? null,
                execution_id: row.execution_id ?? null,
                created_at: row.created_at,
            });
        });
    }
    return out;
}
