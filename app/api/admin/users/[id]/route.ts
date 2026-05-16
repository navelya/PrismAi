import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, { params }: { params: { id: string } }) {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const id = params.id;
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    try {
        const service = createServiceClient();

        const { data: authData, error: authErr } = await service.auth.admin.getUserById(id);
        if (authErr) throw authErr;
        const authUser = authData?.user;
        if (!authUser) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        const [profileRes, subRes] = await Promise.all([
            service.from('profiles').select('id, is_admin, token_balance, avatar_url, preferences').eq('id', id).maybeSingle(),
            service.from('subscriptions').select('plan_id, status, next_topup_at, current_period_end, cancel_at_period_end').eq('user_id', id).maybeSingle(),
        ]);

        if (profileRes.error) throw profileRes.error;
        if (subRes.error) throw subRes.error;

        return NextResponse.json({
            user: {
                id: authUser.id,
                email: authUser.email ?? null,
                created_at: authUser.created_at ?? null,
                last_sign_in_at: authUser.last_sign_in_at ?? null,
                banned_until: (authUser as any).banned_until ?? null,
                email_confirmed_at: (authUser as any).email_confirmed_at ?? null,
                phone: authUser.phone ?? null,
                is_admin: !!profileRes.data?.is_admin,
                token_balance: Number(profileRes.data?.token_balance ?? 0),
                avatar_url: profileRes.data?.avatar_url ?? null,
                subscription: subRes.data
                    ? {
                        plan_id: subRes.data.plan_id,
                        status: subRes.data.status,
                        next_topup_at: subRes.data.next_topup_at,
                        current_period_end: subRes.data.current_period_end,
                        cancel_at_period_end: subRes.data.cancel_at_period_end,
                    }
                    : null,
            },
        });
    } catch (err: any) {
        console.error('[Admin Users API] detail error:', err);
        return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
    }
}
