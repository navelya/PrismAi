import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';
import { getRunDetails } from '@/lib/billing/run-details';

export const dynamic = 'force-dynamic';

const MAX_PAGE_SIZE = 50;

/**
 * The signed-in user's usage history (token_ledger) enriched with run details:
 * for each "Workflow run" entry, which model(s) ran and the media they produced.
 * Reads through the user-scoped client — RLS keeps it to the caller's own runs.
 */
export async function GET(req: NextRequest) {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;

    const url = req.nextUrl;
    const page = Math.max(0, parseInt(url.searchParams.get('page') ?? '0', 10) || 0);
    const pageSize = Math.min(
        MAX_PAGE_SIZE,
        Math.max(1, parseInt(url.searchParams.get('pageSize') ?? '10', 10) || 10)
    );

    try {
        const from = page * pageSize;
        // Fetch one extra row to detect a next page (mirrors the prior client logic).
        const to = from + pageSize;

        const { data, error } = await supabase
            .from('token_ledger')
            .select('id, amount, reason, metadata, execution_id, created_at')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false })
            .range(from, to);

        if (error) throw error;

        const rows = data ?? [];
        const hasMore = rows.length > pageSize;
        const pageRows = rows.slice(0, pageSize);

        const execIds = pageRows.map((r: any) => r.execution_id).filter(Boolean);
        const runDetails = await getRunDetails(supabase, execIds);

        return NextResponse.json({
            rows: pageRows,
            hasMore,
            runDetails: Object.fromEntries(runDetails),
        });
    } catch (err: any) {
        console.error('[Billing] runs error:', err);
        return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
    }
}
