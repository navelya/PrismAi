import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';
import { bustPricingCache } from '@/lib/billing/pricing-source';
import { getProductIdForPrice, createPaddlePrice, archivePaddlePrice } from '@/lib/billing/paddle-pricing';

export const runtime = 'nodejs';

interface PackPatchBody {
    price_dollars?: number;
    credits?: number;
    is_active?: boolean;
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const { supabase, user } = auth;
    const packId = params.id;
    const body = (await req.json()) as PackPatchBody;

    const { data: pack, error: loadErr } = await supabase
        .from('credit_packs').select('*').eq('id', packId).single();
    if (loadErr || !pack) {
        return NextResponse.json({ error: 'Pack not found' }, { status: 404 });
    }

    const updates: Record<string, any> = {};
    const auditRows: any[] = [];

    if (body.price_dollars != null) {
        const newCents = Math.round(body.price_dollars * 100);
        if (newCents !== pack.price_cents) {
            if (newCents < 0) return NextResponse.json({ error: 'Price must be >= 0' }, { status: 400 });
            if (!pack.paddle_price_id) {
                return NextResponse.json({ error: 'Pack has no existing Paddle price to clone the product from' }, { status: 400 });
            }
            try {
                const productId = pack.paddle_product_id ?? (await getProductIdForPrice(pack.paddle_price_id));
                if (!pack.paddle_product_id) updates.paddle_product_id = productId;
                const newPriceId = await createPaddlePrice({
                    productId, amountDollars: body.price_dollars,
                    description: `${pack.display_name} credit pack`,
                });
                updates.price_cents = newCents;
                updates.paddle_price_id = newPriceId;
                await supabase.from('pricing_price_history').insert({
                    paddle_price_id: pack.paddle_price_id, entity_type: 'pack', entity_id: packId, cycle: null,
                });
                try { await archivePaddlePrice(pack.paddle_price_id); }
                catch (e) { console.error('[admin/pricing] archive old pack price failed (non-fatal):', e); }
                auditRows.push({ changed_by: user.id, entity_type: 'pack', entity_id: packId,
                    field: 'price_cents', old_value: String(pack.price_cents), new_value: String(newCents),
                    paddle_price_id_created: newPriceId });
            } catch (e: any) {
                return NextResponse.json({ error: e.message || 'Paddle price update failed' }, { status: 502 });
            }
        }
    }

    if (body.credits != null && Number(body.credits) !== Number(pack.credits)) {
        if (body.credits < 0) return NextResponse.json({ error: 'Credits must be >= 0' }, { status: 400 });
        updates.credits = body.credits;
        auditRows.push({ changed_by: user.id, entity_type: 'pack', entity_id: packId,
            field: 'credits', old_value: String(pack.credits), new_value: String(body.credits) });
    }
    if (body.is_active != null && body.is_active !== pack.is_active) {
        updates.is_active = body.is_active;
        auditRows.push({ changed_by: user.id, entity_type: 'pack', entity_id: packId,
            field: 'is_active', old_value: String(pack.is_active), new_value: String(body.is_active) });
    }

    if (Object.keys(updates).length === 0) return NextResponse.json({ ok: true, unchanged: true });

    updates.updated_at = new Date().toISOString();
    const { error: updErr } = await supabase.from('credit_packs').update(updates).eq('id', packId);
    if (updErr) {
        console.error('[admin/pricing] pack DB update failed after Paddle changes:', updErr, updates);
        return NextResponse.json({ error: 'Saved price in Paddle but DB write failed — check logs', detail: updErr.message }, { status: 500 });
    }
    if (auditRows.length) await supabase.from('pricing_audit').insert(auditRows);

    bustPricingCache();
    return NextResponse.json({ ok: true });
}
