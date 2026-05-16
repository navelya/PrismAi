import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

const MAX_PAGE_SIZE = 100;

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const id = params.id;
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    const url = req.nextUrl;
    const page = Math.max(0, parseInt(url.searchParams.get('page') ?? '0', 10) || 0);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(url.searchParams.get('pageSize') ?? '25', 10) || 25));

    try {
        const service = createServiceClient();
        const from = page * pageSize;
        const to = from + pageSize - 1;

        const { data, error, count } = await service
            .from('token_ledger')
            .select('id, amount, reason, metadata, execution_id, created_at', { count: 'exact' })
            .eq('user_id', id)
            .order('created_at', { ascending: false })
            .range(from, to);

        if (error) throw error;

        return NextResponse.json({ rows: data ?? [], total: count ?? 0, page, pageSize });
    } catch (err: any) {
        console.error('[Admin Users API] ledger error:', err);
        return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
    }
}
