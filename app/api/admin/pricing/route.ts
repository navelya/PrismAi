import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';

export const runtime = 'nodejs';

export async function GET() {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const [plansRes, packsRes, auditRes] = await Promise.all([
        auth.supabase.from('plans').select('*').order('sort_order'),
        auth.supabase.from('credit_packs').select('*').order('sort_order'),
        auth.supabase.from('pricing_audit').select('*').order('created_at', { ascending: false }).limit(50),
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

    return NextResponse.json({
        plans: plansRes.data,
        packs: packsRes.data,
        audit: auditRes.data,
    });
}
