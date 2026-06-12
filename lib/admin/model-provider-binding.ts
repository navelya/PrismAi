import type { SupabaseClient } from '@supabase/supabase-js';

const MISSING_TABLE_RE = /does not exist|could not find|schema cache/i;

/**
 * Mirror an admin slug edit on `ai_models` into the `ai_model_providers`
 * binding table — the table `resolvePrimaryProvider` prefers over the legacy
 * columns. Without this, an admin changing `replicate_model_id` /
 * `provider_model_id` only touches the legacy columns and dispatch keeps
 * running the stale binding slug.
 *
 * Provider key is determined the same way the 20260612 migration backfill
 * does: a non-empty `replicate_model_id` binds `'replicate'`; otherwise the
 * model's provider's `adapter_key` (joined via `ai_models.provider_id`).
 *
 * Two-step write, NOT a blind upsert: supabase `upsert` replaces the whole
 * row, which would clobber an existing binding's `priority` / `is_active`.
 * So first UPDATE only `provider_model_id` on the existing
 * (model_id, provider_id) row; if 0 rows matched, INSERT a fresh binding
 * (priority 0, is_active true).
 *
 * Pre-migration grace: ONLY the missing-table error is swallowed (warn +
 * return). Any other error propagates to the route's error handling. Uses the
 * route's RLS-scoped session client — the table has an `is_admin()` policy.
 */
export async function mirrorModelProviderBinding(
    supabase: SupabaseClient,
    model: {
        id: number | string;
        replicate_model_id?: string | null;
        provider_id?: string | number | null;
        provider_model_id?: string | null;
    }
): Promise<void> {
    let providerKey: string | null = null;
    let slug = '';

    if (model.replicate_model_id && model.replicate_model_id.trim() !== '') {
        providerKey = 'replicate';
        slug = model.replicate_model_id;
    } else if (model.provider_id !== null && model.provider_id !== undefined) {
        const { data: provider, error: providerError } = await supabase
            .from('providers')
            .select('adapter_key')
            .eq('id', model.provider_id)
            .maybeSingle();
        if (providerError) {
            throw new Error(`Failed to read provider ${model.provider_id}: ${providerError.message}`);
        }
        const adapterKey = (provider as any)?.adapter_key as string | null | undefined;
        if (adapterKey && adapterKey.trim() !== '') {
            providerKey = adapterKey;
            slug = model.provider_model_id || '';
        }
    }

    // No replicate slug and no adapter-keyed provider — nothing to mirror.
    if (!providerKey) return;

    const { data: updated, error: updateError } = await supabase
        .from('ai_model_providers')
        .update({ provider_model_id: slug, updated_at: new Date().toISOString() })
        .eq('model_id', model.id)
        .eq('provider_id', providerKey)
        .select('id');

    if (updateError) {
        if (MISSING_TABLE_RE.test(updateError.message || '')) {
            console.warn(
                '[AdminModels] ai_model_providers table missing — skipped binding mirror (apply migration 20260612_ai_model_providers.sql).'
            );
            return;
        }
        throw new Error(`Failed to mirror provider binding: ${updateError.message}`);
    }
    if (updated && updated.length > 0) return;

    const { error: insertError } = await supabase
        .from('ai_model_providers')
        .insert({
            model_id: model.id,
            provider_id: providerKey,
            provider_model_id: slug,
            priority: 0,
            is_active: true,
        });
    if (insertError) {
        if (MISSING_TABLE_RE.test(insertError.message || '')) {
            console.warn(
                '[AdminModels] ai_model_providers table missing — skipped binding mirror (apply migration 20260612_ai_model_providers.sql).'
            );
            return;
        }
        throw new Error(`Failed to insert provider binding: ${insertError.message}`);
    }
}
