import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';
import { bustPricingCache } from '@/lib/billing/pricing-source';
import { syncPlanProducts } from '@/lib/billing/dodo-products';

export const runtime = 'nodejs';

const VALID_ACCENTS = new Set(['neutral', 'highlight', 'premium']);
const SLUG_RE = /^[a-z0-9-]+$/;

interface PlanPostBody {
    id: string;
    display_name: string;
    tagline?: string;
    features?: string[];
    accent?: string;
    price_cents: number;
    price_yearly_cents?: number | null;
    monthly_floor?: number;
    signup_bonus?: number;
    sort_order?: number;
}

export async function POST(req: Request) {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;
    const { supabase, user } = auth;

    const body = (await req.json()) as PlanPostBody;

    // ── Validation ──────────────────────────────────────────────────────────
    if (!body.id || typeof body.id !== 'string' || !SLUG_RE.test(body.id)) {
        return NextResponse.json(
            { error: 'id must be a lowercase alphanumeric slug (^[a-z0-9-]+$)' },
            { status: 400 },
        );
    }
    if (!body.display_name || typeof body.display_name !== 'string' || !body.display_name.trim()) {
        return NextResponse.json({ error: 'display_name is required' }, { status: 400 });
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
    if (typeof body.price_cents !== 'number') {
        return NextResponse.json({ error: 'price_cents is required' }, { status: 400 });
    }

    // ── Duplicate id check ───────────────────────────────────────────────────
    const { data: existing } = await supabase
        .from('plans')
        .select('id')
        .eq('id', body.id)
        .maybeSingle();
    if (existing) {
        return NextResponse.json({ error: `Plan with id '${body.id}' already exists` }, { status: 409 });
    }

    // ── Insert DB row first ──────────────────────────────────────────────────
    const insertRow = {
        id: body.id,
        display_name: body.display_name,
        tagline: body.tagline ?? null,
        features: body.features ?? [],
        accent: body.accent ?? 'neutral',
        price_cents: body.price_cents,
        price_yearly_cents: body.price_yearly_cents ?? null,
        monthly_floor: body.monthly_floor ?? 0,
        signup_bonus: body.signup_bonus ?? 0,
        sort_order: body.sort_order ?? 0,
        is_active: true,
    };

    const { data: newPlan, error: insertErr } = await supabase
        .from('plans')
        .insert(insertRow)
        .select('*')
        .single();
    if (insertErr || !newPlan) {
        console.error('[admin/pricing] plan insert failed:', insertErr);
        return NextResponse.json(
            { error: 'DB insert failed', detail: insertErr?.message },
            { status: 500 },
        );
    }

    // ── Dodo sync — create products ──────────────────────────────────────────
    let dodoProductIds: { monthly: string; yearly: string | null } | null = null;
    let dodoSyncError: string | null = null;

    try {
        dodoProductIds = await syncPlanProducts({
            id: newPlan.id,
            display_name: newPlan.display_name,
            tagline: newPlan.tagline ?? null,
            price_cents: newPlan.price_cents,
            price_yearly_cents: newPlan.price_yearly_cents ?? null,
            dodo_product_id_monthly: null,
            dodo_product_id_yearly: null,
        });

        const { error: idErr } = await supabase
            .from('plans')
            .update({
                dodo_product_id_monthly: dodoProductIds.monthly,
                dodo_product_id_yearly: dodoProductIds.yearly,
            })
            .eq('id', newPlan.id);
        if (idErr) {
            console.error('[admin/pricing] failed to persist dodo product ids after create:', idErr);
        }
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[admin/pricing] Dodo sync failed after DB insert (non-fatal):', msg);
        dodoSyncError = msg;
    }

    // ── Cache bust + audit ───────────────────────────────────────────────────
    bustPricingCache();

    const auditRows: Record<string, unknown>[] = [
        {
            changed_by: user.id,
            entity_type: 'plan',
            entity_id: newPlan.id,
            field: 'created',
            old_value: '',
            new_value: JSON.stringify(insertRow),
        },
    ];
    if (dodoProductIds) {
        auditRows.push({
            changed_by: user.id,
            entity_type: 'plan',
            entity_id: newPlan.id,
            field: 'dodo_product_id_monthly',
            old_value: '',
            new_value: dodoProductIds.monthly,
            dodo_product_id_synced: dodoProductIds.monthly,
        });
        if (dodoProductIds.yearly) {
            auditRows.push({
                changed_by: user.id,
                entity_type: 'plan',
                entity_id: newPlan.id,
                field: 'dodo_product_id_yearly',
                old_value: '',
                new_value: dodoProductIds.yearly,
                dodo_product_id_synced: dodoProductIds.yearly,
            });
        }
    }

    const { error: auditErr } = await supabase.from('pricing_audit').insert(auditRows);
    if (auditErr) console.error('[admin/pricing] plan create audit insert failed (non-fatal):', auditErr);

    return NextResponse.json(
        {
            ok: true,
            id: newPlan.id,
            ...(dodoProductIds
                ? {
                      dodo_product_id_monthly: dodoProductIds.monthly,
                      dodo_product_id_yearly: dodoProductIds.yearly,
                  }
                : {}),
            ...(dodoSyncError ? { dodo_sync_error: dodoSyncError } : {}),
        },
        { status: 201 },
    );
}
