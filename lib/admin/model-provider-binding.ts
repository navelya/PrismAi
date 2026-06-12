import type { SupabaseClient } from '@supabase/supabase-js';

const MISSING_TABLE_RE = /does not exist|could not find|schema cache/i;

/** Pre-migration grace check: true when the error is the ai_model_providers
 * table simply not existing yet (migration 20260612 not applied). */
export function isMissingTableError(error: { message?: string | null } | null | undefined): boolean {
    return MISSING_TABLE_RE.test(error?.message || '');
}

function warnMissingTable(context: string): void {
    console.warn(
        `[AdminModels] ai_model_providers table missing — skipped ${context} (apply migration 20260612_ai_model_providers.sql).`
    );
}

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
        if (isMissingTableError(updateError)) {
            warnMissingTable('binding mirror');
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
        if (isMissingTableError(insertError)) {
            warnMissingTable('binding mirror');
            return;
        }
        throw new Error(`Failed to insert provider binding: ${insertError.message}`);
    }
}

export interface ProviderBindingInput {
    provider_id: string;        // adapter key: 'replicate' | 'fal' | 'elevenlabs' | ...
    provider_model_id: string;  // per-provider slug
    is_active?: boolean;        // default true
}

/** True when an (untrusted) body's optional `provider_bindings` field has at
 * least one complete entry — enough to satisfy the admin POST route's
 * "EITHER replicate_model_id OR provider" requirement. */
export function hasValidProviderBindings(bindings: unknown): bindings is ProviderBindingInput[] {
    return (
        Array.isArray(bindings) &&
        bindings.some(
            (b: any) =>
                typeof b?.provider_id === 'string' &&
                b.provider_id.trim() !== '' &&
                typeof b?.provider_model_id === 'string' &&
                b.provider_model_id.trim() !== ''
        )
    );
}

/**
 * Replace a model's provider bindings with the given ordered list (index 0 =
 * default/primary → priority 0; the rest are fallbacks in order). Deletes
 * bindings not in the list. Also syncs the legacy ai_models columns so old
 * readers stay consistent:
 *   - replicate_model_id := the replicate binding's slug (or null if none)
 *   - provider_model_id  := the default binding's slug when it is adapter-keyed
 *   - provider_id (FK to providers) is NOT touched here — the form still sets it.
 * Swallows ONLY the missing-table error (pre-migration grace), like
 * mirrorModelProviderBinding.
 *
 * Same two-step UPDATE-then-INSERT as the mirror (a blind upsert would clobber
 * `input_overrides` on existing rows). Uses the route's RLS-scoped session
 * client — the table has an `is_admin()` policy.
 */
export async function reconcileModelProviderBindings(
    supabase: SupabaseClient,
    modelId: number | string,
    bindings: ProviderBindingInput[],
): Promise<void> {
    // Drop incomplete entries and de-dupe by provider key (first occurrence
    // wins — the table has UNIQUE(model_id, provider_id)).
    const seen = new Set<string>();
    const cleaned: ProviderBindingInput[] = [];
    for (const binding of bindings) {
        const providerId = (binding?.provider_id || '').trim();
        const slug = (binding?.provider_model_id || '').trim();
        if (!providerId || !slug) continue;
        if (seen.has(providerId)) continue;
        seen.add(providerId);
        cleaned.push({
            provider_id: providerId,
            provider_model_id: slug,
            is_active: binding.is_active ?? true,
        });
    }

    const now = new Date().toISOString();

    for (let i = 0; i < cleaned.length; i++) {
        const binding = cleaned[i];

        const { data: updated, error: updateError } = await supabase
            .from('ai_model_providers')
            .update({
                provider_model_id: binding.provider_model_id,
                priority: i,
                is_active: binding.is_active,
                updated_at: now,
            })
            .eq('model_id', modelId)
            .eq('provider_id', binding.provider_id)
            .select('id');

        if (updateError) {
            if (isMissingTableError(updateError)) {
                warnMissingTable('binding reconcile');
                return;
            }
            throw new Error(`Failed to reconcile provider binding ${binding.provider_id}: ${updateError.message}`);
        }
        if (updated && updated.length > 0) continue;

        const { error: insertError } = await supabase
            .from('ai_model_providers')
            .insert({
                model_id: modelId,
                provider_id: binding.provider_id,
                provider_model_id: binding.provider_model_id,
                priority: i,
                is_active: binding.is_active,
            });
        if (insertError) {
            if (isMissingTableError(insertError)) {
                warnMissingTable('binding reconcile');
                return;
            }
            throw new Error(`Failed to insert provider binding ${binding.provider_id}: ${insertError.message}`);
        }
    }

    // Delete bindings not in the list.
    let deleteQuery = supabase
        .from('ai_model_providers')
        .delete()
        .eq('model_id', modelId);
    if (cleaned.length > 0) {
        const keyList = `(${cleaned.map((b) => `"${b.provider_id.replace(/"/g, '\\"')}"`).join(',')})`;
        deleteQuery = deleteQuery.not('provider_id', 'in', keyList);
    }
    const { error: deleteError } = await deleteQuery;
    if (deleteError) {
        if (isMissingTableError(deleteError)) {
            warnMissingTable('binding reconcile');
            return;
        }
        throw new Error(`Failed to delete stale provider bindings: ${deleteError.message}`);
    }

    // Legacy-column sync so old readers (pre-binding-table code paths) stay
    // consistent with the bindings just written.
    const replicateBinding = cleaned.find((b) => b.provider_id === 'replicate');
    const defaultBinding = cleaned[0];
    const legacyUpdate: Record<string, unknown> = {
        replicate_model_id: replicateBinding ? replicateBinding.provider_model_id : null,
        updated_at: now,
    };
    if (defaultBinding && defaultBinding.provider_id !== 'replicate') {
        legacyUpdate.provider_model_id = defaultBinding.provider_model_id;
    }
    const { error: legacyError } = await supabase
        .from('ai_models')
        .update(legacyUpdate)
        .eq('id', modelId);
    if (legacyError) {
        throw new Error(`Failed to sync legacy provider columns: ${legacyError.message}`);
    }
}
