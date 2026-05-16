import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';
import { loadAllUsers, applyFiltersAndSort, type StatusFilter } from '@/lib/admin/users';

export const dynamic = 'force-dynamic';

const MAX_PAGE_SIZE = 200;

export async function GET(req: NextRequest) {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const url = req.nextUrl;
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
    const status = (url.searchParams.get('status') ?? 'all') as StatusFilter;
    const planFilter = (url.searchParams.get('plan') ?? 'all').trim();
    const sort = (url.searchParams.get('sort') ?? 'created_at').trim();
    const dir = (url.searchParams.get('dir') ?? 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';
    const page = Math.max(0, parseInt(url.searchParams.get('page') ?? '0', 10) || 0);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(url.searchParams.get('pageSize') ?? '25', 10) || 25));

    try {
        const rows = await loadAllUsers();
        const enriched = applyFiltersAndSort(rows, { q, status, planFilter, sort, dir });
        const total = enriched.length;
        const start = page * pageSize;
        const slice = enriched.slice(start, start + pageSize);
        return NextResponse.json({ users: slice, total, page, pageSize });
    } catch (err: any) {
        console.error('[Admin Users API] list error:', err);
        return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
    }
}
