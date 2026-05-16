import { NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';
import { loadAllUsers, applyFiltersAndSort, isBanned, type StatusFilter } from '@/lib/admin/users';

export const dynamic = 'force-dynamic';

function csvEscape(v: unknown): string {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}

export async function GET(req: NextRequest) {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const url = req.nextUrl;
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
    const status = (url.searchParams.get('status') ?? 'all') as StatusFilter;
    const planFilter = (url.searchParams.get('plan') ?? 'all').trim();
    const sort = (url.searchParams.get('sort') ?? 'created_at').trim();
    const dir = (url.searchParams.get('dir') ?? 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

    try {
        const rows = await loadAllUsers();
        const enriched = applyFiltersAndSort(rows, { q, status, planFilter, sort, dir });

        const header = ['id', 'email', 'plan', 'token_balance', 'is_admin', 'banned', 'banned_until', 'created_at', 'last_sign_in_at'];
        const lines = [header.join(',')];
        for (const u of enriched) {
            lines.push([
                csvEscape(u.id),
                csvEscape(u.email),
                csvEscape(u.plan_id),
                csvEscape(u.token_balance),
                csvEscape(u.is_admin),
                csvEscape(isBanned(u.banned_until)),
                csvEscape(u.banned_until),
                csvEscape(u.created_at),
                csvEscape(u.last_sign_in_at),
            ].join(','));
        }
        const csv = lines.join('\n');

        return new Response(csv, {
            status: 200,
            headers: {
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': `attachment; filename="prismai-users-${new Date().toISOString().slice(0, 10)}.csv"`,
            },
        });
    } catch (err: any) {
        console.error('[Admin Users API] export error:', err);
        return new Response(JSON.stringify({ error: err.message || 'Internal Server Error' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }
}
