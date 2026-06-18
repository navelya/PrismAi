import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';

export const runtime = 'nodejs';

export async function GET() {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const [plansRes, packsRes, auditRes] = await Promise.all([
        auth.supabase
            .from('plans')
            .select(
                'id, display_name, tagline, features, accent, price_cents, price_yearly_cents, monthly_floor, signup_bonus, is_active, sort_order, dodo_product_id_monthly, dodo_product_id_yearly, created_at, updated_at',
            )
            .order('sort_order'),
        auth.supabase
            .from('credit_packs')
            .select(
                'id, display_name, tagline, accent, price_cents, credits, is_active, sort_order, dodo_product_id, created_at, updated_at',
            )
            .order('sort_order'),
        auth.supabase
            .from('pricing_audit')
            .select('*')
            .order('created_at', { ascending: false })
            .limit(50),
    ]);

    const failed = [
        ['plans', plansRes.error],
        ['credit_packs', packsRes.error],
        ['pricing_audit', auditRes.error],
    ].filter(([, e]) => e) as [string, { message: string }][];

    if (failed.length) {
        console.error('[admin/pricing] load failed:', failed.map(([t, e]) => `${t}: ${e.message}`).join('; '));
        return NextResponse.json(
            {
                error: 'Failed to load pricing',
                detail: failed.map(([t, e]) => `${t}: ${e.message}`).join('; '),
            },
            { status: 500 },
        );
    }

    // Derive synced status: a plan is synced when monthly dodo product id is
    // present (yearly is only required when price_yearly_cents is set).
    const plans = (plansRes.data ?? []).map((p) => ({
        ...p,
        synced:
            !!p.dodo_product_id_monthly &&
            (p.price_yearly_cents == null || !!p.dodo_product_id_yearly),
    }));

    // A pack is synced when its dodo_product_id is present.
    const packs = (packsRes.data ?? []).map((p) => ({
        ...p,
        synced: !!p.dodo_product_id,
    }));

    return NextResponse.json({
        plans,
        packs,
        audit: auditRes.data,
    });
}
