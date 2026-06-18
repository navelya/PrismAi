import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';
import { bustPricingCache } from '@/lib/billing/pricing-source';
import { syncPlanProducts, syncPackProduct } from '@/lib/billing/dodo-products';

export const runtime = 'nodejs';

interface SyncBody {
    scope: 'all' | 'plan' | 'pack';
    id?: string;
}

interface SyncResult {
    id: string;
    type: 'plan' | 'pack';
    ok: boolean;
    error?: string;
    dodo_product_id_monthly?: string;
    dodo_product_id_yearly?: string | null;
    dodo_product_id?: string;
}

export async function POST(req: Request) {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;
    const { supabase, user } = auth;

    const body = (await req.json()) as SyncBody;

    if (!['all', 'plan', 'pack'].includes(body.scope)) {
        return NextResponse.json(
            { error: "scope must be 'all', 'plan', or 'pack'" },
            { status: 400 },
        );
    }
    if ((body.scope === 'plan' || body.scope === 'pack') && !body.id) {
        return NextResponse.json(
            { error: "id is required when scope is 'plan' or 'pack'" },
            { status: 400 },
        );
    }

    const results: SyncResult[] = [];

    // ── Collect plan rows to sync ────────────────────────────────────────────
    if (body.scope === 'all' || body.scope === 'plan') {
        let plansQuery = supabase.from('plans').select('*');
        if (body.scope === 'plan' && body.id) {
            plansQuery = plansQuery.eq('id', body.id) as typeof plansQuery;
        }
        // Skip the free plan (no Dodo product needed).
        plansQuery = plansQuery.neq('id', 'free') as typeof plansQuery;

        const { data: plans, error: plansErr } = await plansQuery;
        if (plansErr) {
            return NextResponse.json(
                { error: 'Failed to load plans', detail: plansErr.message },
                { status: 500 },
            );
        }

        for (const plan of plans ?? []) {
            try {
                const dodoIds = await syncPlanProducts({
                    id: plan.id,
                    display_name: plan.display_name,
                    tagline: plan.tagline ?? null,
                    price_cents: plan.price_cents ?? 0,
                    price_yearly_cents: plan.price_yearly_cents ?? null,
                    dodo_product_id_monthly: plan.dodo_product_id_monthly ?? null,
                    dodo_product_id_yearly: plan.dodo_product_id_yearly ?? null,
                });

                // Persist ids back to DB.
                const { error: idErr } = await supabase
                    .from('plans')
                    .update({
                        dodo_product_id_monthly: dodoIds.monthly,
                        dodo_product_id_yearly: dodoIds.yearly,
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', plan.id);
                if (idErr) {
                    console.error('[admin/pricing/sync] failed to persist plan dodo ids:', plan.id, idErr);
                }

                // Audit row.
                await supabase.from('pricing_audit').insert([
                    {
                        changed_by: user.id,
                        entity_type: 'plan',
                        entity_id: plan.id,
                        field: 'dodo_sync',
                        old_value: plan.dodo_product_id_monthly ?? '',
                        new_value: dodoIds.monthly,
                        dodo_product_id_synced: dodoIds.monthly,
                    },
                ]);

                results.push({
                    id: plan.id,
                    type: 'plan',
                    ok: true,
                    dodo_product_id_monthly: dodoIds.monthly,
                    dodo_product_id_yearly: dodoIds.yearly,
                });
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                console.error('[admin/pricing/sync] plan sync failed:', plan.id, msg);
                results.push({ id: plan.id, type: 'plan', ok: false, error: msg });
            }
        }
    }

    // ── Collect pack rows to sync ────────────────────────────────────────────
    if (body.scope === 'all' || body.scope === 'pack') {
        let packsQuery = supabase.from('credit_packs').select('*');
        if (body.scope === 'pack' && body.id) {
            packsQuery = packsQuery.eq('id', body.id) as typeof packsQuery;
        }

        const { data: packs, error: packsErr } = await packsQuery;
        if (packsErr) {
            return NextResponse.json(
                { error: 'Failed to load packs', detail: packsErr.message },
                { status: 500 },
            );
        }

        for (const pack of packs ?? []) {
            try {
                const result = await syncPackProduct({
                    id: pack.id,
                    display_name: pack.display_name,
                    tagline: pack.tagline ?? null,
                    price_cents: pack.price_cents,
                    dodo_product_id: pack.dodo_product_id ?? null,
                });

                // Persist id back to DB.
                const { error: idErr } = await supabase
                    .from('credit_packs')
                    .update({
                        dodo_product_id: result.product_id,
                        updated_at: new Date().toISOString(),
                    })
                    .eq('id', pack.id);
                if (idErr) {
                    console.error('[admin/pricing/sync] failed to persist pack dodo id:', pack.id, idErr);
                }

                // Audit row.
                await supabase.from('pricing_audit').insert([
                    {
                        changed_by: user.id,
                        entity_type: 'pack',
                        entity_id: pack.id,
                        field: 'dodo_sync',
                        old_value: pack.dodo_product_id ?? '',
                        new_value: result.product_id,
                        dodo_product_id_synced: result.product_id,
                    },
                ]);

                results.push({ id: pack.id, type: 'pack', ok: true, dodo_product_id: result.product_id });
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                console.error('[admin/pricing/sync] pack sync failed:', pack.id, msg);
                results.push({ id: pack.id, type: 'pack', ok: false, error: msg });
            }
        }
    }

    // ── Cache bust ───────────────────────────────────────────────────────────
    bustPricingCache();

    const allOk = results.every((r) => r.ok);
    return NextResponse.json(
        { ok: allOk, results },
        { status: allOk ? 200 : 207 },
    );
}
