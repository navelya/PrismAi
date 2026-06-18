import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';
import { bustPricingCache } from '@/lib/billing/pricing-source';
import { syncPlanProducts, archiveProduct } from '@/lib/billing/dodo-products';

export const runtime = 'nodejs';

const VALID_ACCENTS = new Set(['neutral', 'highlight', 'premium']);

interface PlanPatchBody {
    display_name?: string;
    tagline?: string;
    features?: string[];
    accent?: string;
    price_cents?: number;
    price_yearly_cents?: number | null;
    monthly_floor?: number;
    signup_bonus?: number;
    is_active?: boolean;
    sort_order?: number;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;
    const { supabase, user } = auth;

    const { id: planId } = await params;
    const body = (await req.json()) as PlanPatchBody;

    // ── Validation ──────────────────────────────────────────────────────────
    if (body.display_name != null && (typeof body.display_name !== 'string' || !body.display_name.trim())) {
        return NextResponse.json({ error: 'display_name must be a non-empty string' }, { status: 400 });
    }
    if (body.tagline != null && typeof body.tagline !== 'string') {
        return NextResponse.json({ error: 'tagline must be a string' }, { status: 400 });
    }
    if (body.features != null) {
        if (!Array.isArray(body.features) || body.features.some((f) => typeof f !== 'string')) {
            return NextResponse.json({ error: 'features must be an array of strings' }, { status: 400 });
        }
    }
    if (body.accent != null && !VALID_ACCENTS.has(body.accent)) {
        return NextResponse.json({ error: 'accent must be one of: neutral, highlight, premium' }, { status: 400 });
    }
    for (const [key, val] of [
        ['price_cents', body.price_cents],
        ['price_yearly_cents', body.price_yearly_cents],
        ['monthly_floor', body.monthly_floor],
        ['signup_bonus', body.signup_bonus],
        ['sort_order', body.sort_order],
    ] as const) {
        if (val != null) {
            if (typeof val !== 'number' || !Number.isFinite(val) || !Number.isInteger(val)) {
                return NextResponse.json({ error: `${key} must be an integer` }, { status: 400 });
            }
            if (['price_cents', 'price_yearly_cents', 'monthly_floor', 'signup_bonus'].includes(key) && val < 0) {
                return NextResponse.json({ error: `${key} must be >= 0` }, { status: 400 });
            }
        }
    }
    if (body.is_active != null && typeof body.is_active !== 'boolean') {
        return NextResponse.json({ error: 'is_active must be a boolean' }, { status: 400 });
    }

    // The free plan has no price; block price changes on it.
    if (planId === 'free' && (body.price_cents != null || body.price_yearly_cents != null)) {
        return NextResponse.json({ error: 'The free plan has no editable price' }, { status: 400 });
    }

    // ── Load current row ─────────────────────────────────────────────────────
    const { data: plan, error: loadErr } = await supabase
        .from('plans')
        .select('*')
        .eq('id', planId)
        .single();
    if (loadErr || !plan) {
        return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
    }

    // ── Build updates object ─────────────────────────────────────────────────
    const updates: Record<string, unknown> = {};
    const auditRows: Record<string, unknown>[] = [];

    const trackChange = (field: string, oldVal: unknown, newVal: unknown) => {
        updates[field] = newVal;
        auditRows.push({
            changed_by: user.id,
            entity_type: 'plan',
            entity_id: planId,
            field,
            old_value: String(oldVal ?? ''),
            new_value: String(newVal ?? ''),
        });
    };

    if (body.display_name != null && body.display_name !== plan.display_name) {
        trackChange('display_name', plan.display_name, body.display_name);
    }
    if (body.tagline !== undefined && body.tagline !== plan.tagline) {
        trackChange('tagline', plan.tagline, body.tagline);
    }
    if (body.features != null) {
        const newFeatures = JSON.stringify(body.features);
        const oldFeatures = JSON.stringify(plan.features ?? []);
        if (newFeatures !== oldFeatures) {
            updates.features = body.features;
            auditRows.push({
                changed_by: user.id,
                entity_type: 'plan',
                entity_id: planId,
                field: 'features',
                old_value: oldFeatures,
                new_value: newFeatures,
            });
        }
    }
    if (body.accent != null && body.accent !== plan.accent) {
        trackChange('accent', plan.accent, body.accent);
    }
    if (body.price_cents != null && body.price_cents !== plan.price_cents) {
        trackChange('price_cents', plan.price_cents, body.price_cents);
    }
    // price_yearly_cents can be set to null to remove yearly pricing.
    if (body.price_yearly_cents !== undefined && body.price_yearly_cents !== plan.price_yearly_cents) {
        trackChange('price_yearly_cents', plan.price_yearly_cents, body.price_yearly_cents);
    }
    if (body.monthly_floor != null && body.monthly_floor !== plan.monthly_floor) {
        trackChange('monthly_floor', plan.monthly_floor, body.monthly_floor);
    }
    if (body.signup_bonus != null && body.signup_bonus !== plan.signup_bonus) {
        trackChange('signup_bonus', plan.signup_bonus, body.signup_bonus);
    }
    if (body.is_active != null && body.is_active !== plan.is_active) {
        trackChange('is_active', plan.is_active, body.is_active);
    }
    if (body.sort_order != null && body.sort_order !== plan.sort_order) {
        trackChange('sort_order', plan.sort_order, body.sort_order);
    }

    if (Object.keys(updates).length === 0) {
        return NextResponse.json({ ok: true, unchanged: true });
    }

    // ── DB write first ───────────────────────────────────────────────────────
    updates.updated_at = new Date().toISOString();
    const { data: updatedRow, error: updErr } = await supabase
        .from('plans')
        .update(updates)
        .eq('id', planId)
        .select('*')
        .single();
    if (updErr || !updatedRow) {
        console.error('[admin/pricing] plan DB update failed:', updErr);
        return NextResponse.json(
            { error: 'DB update failed', detail: updErr?.message },
            { status: 500 },
        );
    }

    // ── Dodo sync (if name/price changed or product ids are missing) ─────────
    const needsSync =
        'display_name' in updates ||
        'price_cents' in updates ||
        'price_yearly_cents' in updates ||
        !updatedRow.dodo_product_id_monthly;

    let dodoProductIds: { monthly: string; yearly: string | null } | null = null;
    let dodoSyncError: string | null = null;

    if (needsSync && planId !== 'free') {
        try {
            dodoProductIds = await syncPlanProducts({
                id: updatedRow.id,
                display_name: updatedRow.display_name,
                tagline: updatedRow.tagline ?? null,
                price_cents: updatedRow.price_cents ?? 0,
                price_yearly_cents: updatedRow.price_yearly_cents ?? null,
                dodo_product_id_monthly: updatedRow.dodo_product_id_monthly ?? null,
                dodo_product_id_yearly: updatedRow.dodo_product_id_yearly ?? null,
            });

            // Persist the returned ids back to the DB.
            const idUpdates: Record<string, string | null> = {
                dodo_product_id_monthly: dodoProductIds.monthly,
                dodo_product_id_yearly: dodoProductIds.yearly,
            };
            const { error: idErr } = await supabase
                .from('plans')
                .update(idUpdates)
                .eq('id', planId);
            if (idErr) {
                console.error('[admin/pricing] failed to persist dodo product ids:', idErr);
                // Non-fatal: the Dodo product was created; admin can retry via /sync.
            }
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error('[admin/pricing] Dodo sync failed (non-fatal after DB write):', msg);
            // The DB row is already updated. The admin can retry via /sync.
            dodoSyncError = msg;
        }
    }

    // ── Cache bust + audit ───────────────────────────────────────────────────
    bustPricingCache();

    // Append a dodo_product_id_synced audit row if we created/updated a product.
    if (dodoProductIds) {
        auditRows.push({
            changed_by: user.id,
            entity_type: 'plan',
            entity_id: planId,
            field: 'dodo_product_id_monthly',
            old_value: plan.dodo_product_id_monthly ?? '',
            new_value: dodoProductIds.monthly,
            dodo_product_id_synced: dodoProductIds.monthly,
        });
        if (dodoProductIds.yearly) {
            auditRows.push({
                changed_by: user.id,
                entity_type: 'plan',
                entity_id: planId,
                field: 'dodo_product_id_yearly',
                old_value: plan.dodo_product_id_yearly ?? '',
                new_value: dodoProductIds.yearly,
                dodo_product_id_synced: dodoProductIds.yearly,
            });
        }
    }

    if (auditRows.length) {
        const { error: auditErr } = await supabase.from('pricing_audit').insert(auditRows);
        if (auditErr) console.error('[admin/pricing] audit insert failed (non-fatal):', auditErr);
    }

    return NextResponse.json({
        ok: true,
        ...(dodoSyncError ? { dodo_sync_error: dodoSyncError } : {}),
    });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;
    const { supabase, user } = auth;

    const { id: planId } = await params;

    // ── Load the plan ────────────────────────────────────────────────────────
    const { data: plan, error: loadErr } = await supabase
        .from('plans')
        .select('*')
        .eq('id', planId)
        .single();
    if (loadErr || !plan) {
        return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
    }

    // ── Guard: active subscribers ────────────────────────────────────────────
    // Check for any subscription row that references this plan with an active
    // or trialing status (i.e. the plan still has paying customers).
    const { data: activeSubs, error: subErr } = await supabase
        .from('subscriptions')
        .select('id')
        .eq('plan_id', planId)
        .in('status', ['active', 'trialing'])
        .limit(1);

    if (subErr) {
        console.error('[admin/pricing] subscription check failed:', subErr);
        return NextResponse.json(
            { error: 'Could not verify active subscribers', detail: subErr.message },
            { status: 500 },
        );
    }
    if (activeSubs && activeSubs.length > 0) {
        return NextResponse.json(
            { error: 'Cannot delete a plan with active subscribers. Deactivate it instead.' },
            { status: 409 },
        );
    }

    // ── Archive Dodo products (best-effort, before soft-delete) ─────────────
    const archivedIds: string[] = [];
    for (const productId of [plan.dodo_product_id_monthly, plan.dodo_product_id_yearly].filter(Boolean)) {
        try {
            await archiveProduct(productId as string);
            archivedIds.push(productId as string);
        } catch (e) {
            console.error('[admin/pricing] archive Dodo product failed (non-fatal):', productId, e);
        }
    }

    // ── Soft-delete: set is_active=false ─────────────────────────────────────
    // Strategy: SOFT DELETE (is_active=false).
    // Rationale: preserves historical ledger/subscription references. A plan row
    // that is soft-deleted remains queryable by admin but is hidden from the
    // public pricing API (which only reads is_active=true rows). Hard-delete
    // would break FK references from subscriptions.token_ledger and make it
    // impossible to reason about past billing events.
    const { error: delErr } = await supabase
        .from('plans')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', planId);
    if (delErr) {
        console.error('[admin/pricing] plan soft-delete failed:', delErr);
        return NextResponse.json(
            { error: 'DB update failed', detail: delErr.message },
            { status: 500 },
        );
    }

    // ── Cache bust + audit ───────────────────────────────────────────────────
    bustPricingCache();

    const auditRows: Record<string, unknown>[] = [
        {
            changed_by: user.id,
            entity_type: 'plan',
            entity_id: planId,
            field: 'is_active',
            old_value: String(plan.is_active),
            new_value: 'false',
        },
    ];
    const { error: auditErr } = await supabase.from('pricing_audit').insert(auditRows);
    if (auditErr) console.error('[admin/pricing] delete audit insert failed (non-fatal):', auditErr);

    return NextResponse.json({ ok: true, soft_deleted: true, archived_dodo_products: archivedIds });
}
