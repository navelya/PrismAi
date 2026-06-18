import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';
import { bustPricingCache } from '@/lib/billing/pricing-source';
import { syncPackProduct } from '@/lib/billing/dodo-products';

export const runtime = 'nodejs';

const VALID_ACCENTS = new Set(['neutral', 'highlight', 'premium']);
const SLUG_RE = /^[a-z0-9-]+$/;

interface PackPostBody {
    id: string;
    display_name: string;
    tagline?: string;
    accent?: string;
    price_cents: number;
    credits: number;
    sort_order?: number;
}

export async function POST(req: Request) {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;
    const { supabase, user } = auth;

    const body = (await req.json()) as PackPostBody;

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
    if (body.accent != null && !VALID_ACCENTS.has(body.accent)) {
        return NextResponse.json({ error: 'accent must be one of: neutral, highlight, premium' }, { status: 400 });
    }
    for (const [key, val] of [
        ['price_cents', body.price_cents],
        ['credits', body.credits],
        ['sort_order', body.sort_order],
    ] as const) {
        if (val != null) {
            if (typeof val !== 'number' || !Number.isFinite(val) || !Number.isInteger(val)) {
                return NextResponse.json({ error: `${key} must be an integer` }, { status: 400 });
            }
            if (['price_cents', 'credits'].includes(key) && val < 0) {
                return NextResponse.json({ error: `${key} must be >= 0` }, { status: 400 });
            }
        }
    }
    if (typeof body.price_cents !== 'number') {
        return NextResponse.json({ error: 'price_cents is required' }, { status: 400 });
    }
    if (typeof body.credits !== 'number') {
        return NextResponse.json({ error: 'credits is required' }, { status: 400 });
    }

    // ── Duplicate id check ───────────────────────────────────────────────────
    const { data: existing } = await supabase
        .from('credit_packs')
        .select('id')
        .eq('id', body.id)
        .maybeSingle();
    if (existing) {
        return NextResponse.json({ error: `Pack with id '${body.id}' already exists` }, { status: 409 });
    }

    // ── Insert DB row first ──────────────────────────────────────────────────
    const insertRow = {
        id: body.id,
        display_name: body.display_name,
        tagline: body.tagline ?? null,
        accent: body.accent ?? 'neutral',
        price_cents: body.price_cents,
        credits: body.credits,
        sort_order: body.sort_order ?? 0,
        is_active: true,
    };

    const { data: newPack, error: insertErr } = await supabase
        .from('credit_packs')
        .insert(insertRow)
        .select('*')
        .single();
    if (insertErr || !newPack) {
        console.error('[admin/pricing] pack insert failed:', insertErr);
        return NextResponse.json(
            { error: 'DB insert failed', detail: insertErr?.message },
            { status: 500 },
        );
    }

    // ── Dodo sync — create product ───────────────────────────────────────────
    let dodoProductId: string | null = null;
    let dodoSyncError: string | null = null;

    try {
        const result = await syncPackProduct({
            id: newPack.id,
            display_name: newPack.display_name,
            tagline: newPack.tagline ?? null,
            price_cents: newPack.price_cents,
            dodo_product_id: null,
        });
        dodoProductId = result.product_id;

        const { error: idErr } = await supabase
            .from('credit_packs')
            .update({ dodo_product_id: dodoProductId })
            .eq('id', newPack.id);
        if (idErr) {
            console.error('[admin/pricing] failed to persist dodo product id after pack create:', idErr);
        }
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error('[admin/pricing] Dodo pack sync failed after DB insert (non-fatal):', msg);
        dodoSyncError = msg;
    }

    // ── Cache bust + audit ───────────────────────────────────────────────────
    bustPricingCache();

    const auditRows: Record<string, unknown>[] = [
        {
            changed_by: user.id,
            entity_type: 'pack',
            entity_id: newPack.id,
            field: 'created',
            old_value: '',
            new_value: JSON.stringify(insertRow),
        },
    ];
    if (dodoProductId) {
        auditRows.push({
            changed_by: user.id,
            entity_type: 'pack',
            entity_id: newPack.id,
            field: 'dodo_product_id',
            old_value: '',
            new_value: dodoProductId,
            dodo_product_id_synced: dodoProductId,
        });
    }

    const { error: auditErr } = await supabase.from('pricing_audit').insert(auditRows);
    if (auditErr) console.error('[admin/pricing] pack create audit insert failed (non-fatal):', auditErr);

    return NextResponse.json(
        {
            ok: true,
            id: newPack.id,
            ...(dodoProductId ? { dodo_product_id: dodoProductId } : {}),
            ...(dodoSyncError ? { dodo_sync_error: dodoSyncError } : {}),
        },
        { status: 201 },
    );
}
