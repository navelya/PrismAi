import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';
import { createServiceClient } from '@/lib/supabase/service';
import { loadAllUsers, isBanned } from '@/lib/admin/users';

export const dynamic = 'force-dynamic';

export async function GET() {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    try {
        const users = await loadAllUsers();
        const now = Date.now();
        const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

        let active7d = 0;
        let banned = 0;
        let admins = 0;
        for (const u of users) {
            if (u.last_sign_in_at && Date.parse(u.last_sign_in_at) >= sevenDaysAgo) active7d += 1;
            if (isBanned(u.banned_until)) banned += 1;
            if (u.is_admin) admins += 1;
        }

        const service = createServiceClient();
        const { data: granted, error: grantedErr } = await service
            .from('token_ledger')
            .select('amount')
            .gt('amount', 0);
        if (grantedErr) throw grantedErr;
        const totalTokensIssued = (granted ?? []).reduce((sum: number, r: any) => sum + Number(r.amount ?? 0), 0);

        return NextResponse.json({
            total: users.length,
            active7d,
            banned,
            admins,
            totalTokensIssued,
        });
    } catch (err: any) {
        console.error('[Admin Users API] stats error:', err);
        return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
    }
}
