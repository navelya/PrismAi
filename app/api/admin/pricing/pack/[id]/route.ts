import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';
import { bustPricingCache } from '@/lib/billing/pricing-source';
import { syncPackProduct, archiveProduct } from '@/lib/billing/dodo-products';

export const runtime = 'nodejs';

const VALID_ACCENTS = new Set(['neutral', 'highlight', 'premium']);

interface PackPatchBody {
    display_name?: string;
    tagline?: string;
    accent?: string;
    price_cents?: number;
    credits?: number;
    is_active?: boolean;
    sort_order?: number;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;
    const { supabase, user } = auth;

    const { id: packId } = await params;
    const body = (await req.json()) as PackPatchBody;

    // ── Validation ──────────────────────────────────────────────────────────
    if (body.display_name != null && (typeof body.display_name !== 'string' || !body.display_name.trim())) {
        return NextResponse.json({ error: 'display_name must be a non-empty string' }, { status: 400 });
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
    if (body.is_active != null && typeof body.is_active !== 'boolean') {
        return NextResponse.json({ error: 'is_active must be a boolean' }, { status: 400 });
    }

    // ── Load current row ─────────────────────────────────────────────────────
    const { data: pack, error: loadErr } = await supabase
        .from('credit_packs')
        .select('*')
        .eq('id', packId)
        .single();
    if (loadErr || !pack) {
        return NextResponse.json({ error: 'Pack not found' }, { status: 404 });
    }

    // ── Build updates object ─────────────────────────────────────────────────
    const updates: Record<string, unknown> = {};
    const auditRows: Record<string, unknown>[] = [];

    const trackChange = (field: string, oldVal: unknown, newVal: unknown) => {
        updates[field] = newVal;
        auditRows.push({
            changed_by: user.id,
            entity_type: 'pack',
            entity_id: packId,
            field,
            old_value: String(oldVal ?? ''),
            new_value: String(newVal ?? ''),
        });
    };

    if (body.display_name != null && body.display_name !== pack.display_name) {
        trackChange('display_name', pack.display_name, body.display_name);
    }
    if (body.tagline !== undefined && body.tagline !== pack.tagline) {
        trackChange('tagline', pack.tagline, body.tagline);
    }
    if (body.accent != null && body.accent !== pack.accent) {
        trackChange('accent', pack.accent, body.accent);
    }
    if (body.price_cents != null && body.price_cents !== pack.price_cents) {
        trackChange('price_cents', pack.price_cents, body.price_cents);
    }
    if (body.credits != null && body.credits !== Number(pack.credits)) {
        trackChange('credits', pack.credits, body.credits);
    }
    if (body.is_active != null && body.is_active !== pack.is_active) {
        trackChange('is_active', pack.is_active, body.is_active);
    }
    if (body.sort_order != null && body.sort_order !== pack.sort_order) {
        trackChange('sort_order', pack.sort_order, body.sort_order);
    }

    if (Object.keys(updates).length === 0) {
        return NextResponse.json({ ok: true, unchanged: true });
    }

    // ── DB write first ───────────────────────────────────────────────────────
    updates.updated_at = new Date().toISOString();
    const { data: updatedRow, error: updErr } = await supabase
        .from('credit_packs')
        .update(updates)
        .eq('id', packId)
        .select('*')
        .single();
    if (updErr || !updatedRow) {
        console.error('[admin/pricing] pack DB update failed:', updErr);
        return NextResponse.json(
            { error: 'DB update failed', detail: updErr?.message },
            { status: 500 },
        );
    }

    // ── Dodo sync (if name/price changed or product id is missing) ───────────
    const needsSync =
        'display_name' in updates ||
        'price_cents' in updates ||
        !updatedRow.dodo_product_id;

    let dodoProductId: string | null = null;
    let dodoSyncError: string | null = null;

    if (needsSync) {
        try {
            const result = await syncPackProduct({
                id: updatedRow.id,
                display_name: updatedRow.display_name,
                tagline: updatedRow.tagline ?? null,
                price_cents: updatedRow.price_cents,
                dodo_product_id: updatedRow.dodo_product_id ?? null,
            });
            dodoProductId = result.product_id;

            // Persist the returned id back to the DB.
            const { error: idErr } = await supabase
                .from('credit_packs')
                .update({ dodo_product_id: dodoProductId })
                .eq('id', packId);
            if (idErr) {
                console.error('[admin/pricing] failed to persist dodo product id:', idErr);
                // Non-fatal: admin can retry via /sync.
            }
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error('[admin/pricing] Dodo sync failed (non-fatal after DB write):', msg);
            dodoSyncError = msg;
        }
    }

    // ── Cache bust + audit ───────────────────────────────────────────────────
    bustPricingCache();

    if (dodoProductId) {
        auditRows.push({
            changed_by: user.id,
            entity_type: 'pack',
            entity_id: packId,
            field: 'dodo_product_id',
            old_value: pack.dodo_product_id ?? '',
            new_value: dodoProductId,
            dodo_product_id_synced: dodoProductId,
        });
    }

    if (auditRows.length) {
        const { error: auditErr } = await supabase.from('pricing_audit').insert(auditRows);
        if (auditErr) console.error('[admin/pricing] pack audit insert failed (non-fatal):', auditErr);
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

    const { id: packId } = await params;

    // ── Load the pack ────────────────────────────────────────────────────────
    const { data: pack, error: loadErr } = await supabase
        .from('credit_packs')
        .select('*')
        .eq('id', packId)
        .single();
    if (loadErr || !pack) {
        return NextResponse.json({ error: 'Pack not found' }, { status: 404 });
    }

    // ── Archive Dodo product (best-effort) ───────────────────────────────────
    let archivedId: string | null = null;
    if (pack.dodo_product_id) {
        try {
            await archiveProduct(pack.dodo_product_id);
            archivedId = pack.dodo_product_id;
        } catch (e) {
            console.error('[admin/pricing] archive Dodo pack product failed (non-fatal):', pack.dodo_product_id, e);
        }
    }

    // ── Soft-delete: set is_active=false ─────────────────────────────────────
    // Strategy: SOFT DELETE (is_active=false).
    // Packs have no subscriber FK, but soft-delete is still preferred to keep
    // audit trail complete and allow re-activation if needed.
    const { error: delErr } = await supabase
        .from('credit_packs')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', packId);
    if (delErr) {
        console.error('[admin/pricing] pack soft-delete failed:', delErr);
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
            entity_type: 'pack',
            entity_id: packId,
            field: 'is_active',
            old_value: String(pack.is_active),
            new_value: 'false',
            ...(archivedId ? { dodo_product_id_synced: archivedId } : {}),
        },
    ];
    const { error: auditErr } = await supabase.from('pricing_audit').insert(auditRows);
    if (auditErr) console.error('[admin/pricing] pack delete audit insert failed (non-fatal):', auditErr);

    return NextResponse.json({ ok: true, soft_deleted: true, archived_dodo_product: archivedId });
}
