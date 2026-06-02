import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';
import { bustPricingCache } from '@/lib/billing/pricing-source';
import { getProductIdForPrice, createPaddlePrice, archivePaddlePrice } from '@/lib/billing/paddle-pricing';

export const runtime = 'nodejs';

interface PlanPatchBody {
    price_monthly_dollars?: number;
    price_yearly_dollars?: number;
    monthly_floor?: number;   // granted monthly credits
    is_active?: boolean;
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;
    const { supabase, user } = auth;

    const planId = params.id;
    if (planId === 'free') {
        return NextResponse.json({ error: 'The free plan has no editable price' }, { status: 400 });
    }

    const body = (await req.json()) as PlanPatchBody;

    // Validate input types before touching Paddle or the DB.
    for (const [key, val] of [
        ['price_monthly_dollars', body.price_monthly_dollars],
        ['price_yearly_dollars', body.price_yearly_dollars],
        ['monthly_floor', body.monthly_floor],
    ] as const) {
        if (val != null && (typeof val !== 'number' || !Number.isFinite(val))) {
            return NextResponse.json({ error: `${key} must be a number` }, { status: 400 });
        }
    }
    if (body.is_active != null && typeof body.is_active !== 'boolean') {
        return NextResponse.json({ error: 'is_active must be a boolean' }, { status: 400 });
    }

    const { data: plan, error: loadErr } = await supabase
        .from('plans').select('*').eq('id', planId).single();
    if (loadErr || !plan) {
        return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
    }

    const updates: Record<string, any> = {};
    const auditRows: any[] = [];
    const historyRows: { paddle_price_id: string; entity_type: 'plan'; entity_id: string; cycle: 'monthly' | 'yearly' }[] = [];
    const toArchive: string[] = [];

    // Phase 1: create new Paddle prices only. No archiving, no DB writes yet, so
    // a failure here leaves the system fully intact (old prices still live; any
    // new price created is a harmless orphan) and the request is safe to retry.
    async function handleCycle(
        dollars: number | undefined,
        currentCents: number | null,
        currentPriceId: string | null,
        interval: 'month' | 'year',
        priceCol: string,
        idCol: string,
        cycleName: 'monthly' | 'yearly',
    ) {
        if (dollars == null) return;
        const newCents = Math.round(dollars * 100);
        if (newCents === (currentCents ?? -1)) return; // no change
        if (newCents < 0) throw new Error('Price must be >= 0');
        if (!currentPriceId) throw new Error(`Plan ${planId} has no existing ${interval} price to clone the product from`);

        // Reuse a product id resolved earlier in this same request if present.
        const productId = (updates.paddle_product_id ?? plan.paddle_product_id) ?? (await getProductIdForPrice(currentPriceId));
        if (!plan.paddle_product_id) updates.paddle_product_id = productId;

        const newPriceId = await createPaddlePrice({
            productId,
            amountDollars: dollars,
            interval,
            description: `${plan.display_name} ${interval === 'month' ? 'Monthly' : 'Yearly'}`,
        });

        updates[priceCol] = newCents;
        updates[idCol] = newPriceId;
        historyRows.push({ paddle_price_id: currentPriceId, entity_type: 'plan', entity_id: planId, cycle: cycleName });
        toArchive.push(currentPriceId);
        auditRows.push({
            changed_by: user.id, entity_type: 'plan', entity_id: planId,
            field: priceCol, old_value: String(currentCents ?? ''), new_value: String(newCents),
            paddle_price_id_created: newPriceId,
        });
    }

    try {
        await handleCycle(body.price_monthly_dollars, plan.price_cents, plan.paddle_price_id_monthly,
            'month', 'price_cents', 'paddle_price_id_monthly', 'monthly');
        await handleCycle(body.price_yearly_dollars, plan.price_yearly_cents, plan.paddle_price_id_yearly,
            'year', 'price_yearly_cents', 'paddle_price_id_yearly', 'yearly');
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Paddle price update failed' }, { status: 502 });
    }

    // DB-only changes (no Paddle).
    if (body.monthly_floor != null && Number(body.monthly_floor) !== Number(plan.monthly_floor)) {
        if (body.monthly_floor < 0) return NextResponse.json({ error: 'Credits must be >= 0' }, { status: 400 });
        updates.monthly_floor = body.monthly_floor;
        auditRows.push({ changed_by: user.id, entity_type: 'plan', entity_id: planId,
            field: 'monthly_floor', old_value: String(plan.monthly_floor), new_value: String(body.monthly_floor) });
    }
    if (body.is_active != null && body.is_active !== plan.is_active) {
        updates.is_active = body.is_active;
        auditRows.push({ changed_by: user.id, entity_type: 'plan', entity_id: planId,
            field: 'is_active', old_value: String(plan.is_active), new_value: String(body.is_active) });
    }

    if (Object.keys(updates).length === 0) {
        return NextResponse.json({ ok: true, unchanged: true });
    }

    // Phase 2: single DB update. Until this succeeds nothing is archived, so the
    // live plan keeps resolving to its current (still-active) Paddle prices.
    updates.updated_at = new Date().toISOString();
    const { error: updErr } = await supabase.from('plans').update(updates).eq('id', planId);
    if (updErr) {
        console.error('[admin/pricing] DB update failed after Paddle price creation:', updErr, updates);
        return NextResponse.json({ error: 'Saved price in Paddle but DB write failed — check logs', detail: updErr.message }, { status: 500 });
    }

    // Phase 3: record history + archive old prices (best-effort, after DB is consistent).
    if (historyRows.length) {
        const { error: histErr } = await supabase
            .from('pricing_price_history')
            .upsert(historyRows, { onConflict: 'paddle_price_id', ignoreDuplicates: true });
        if (histErr) console.error('[admin/pricing] price history insert failed (non-fatal):', histErr);
    }
    for (const oldId of toArchive) {
        try { await archivePaddlePrice(oldId); }
        catch (e) { console.error('[admin/pricing] archive old price failed (non-fatal):', oldId, e); }
    }
    if (auditRows.length) {
        const { error: auditErr } = await supabase.from('pricing_audit').insert(auditRows);
        if (auditErr) console.error('[admin/pricing] audit insert failed (non-fatal):', auditErr);
    }

    bustPricingCache();
    return NextResponse.json({ ok: true });
}
