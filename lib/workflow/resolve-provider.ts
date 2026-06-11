import { createServiceClient } from '@/lib/supabase/service';

export interface ResolvedProvider {
  providerKey: string;
  providerModelId: string;
  inputOverrides: Record<string, any> | null;
}

/**
 * Resolve a model's PRIMARY active provider binding (lowest priority). Falls back
 * to the legacy single-provider columns on ai_models if no binding rows exist yet
 * (pre-backfill safety). Phase B uses only the primary; failover over the rest is
 * Phase C.
 */
export async function resolvePrimaryProvider(modelId: number | string): Promise<ResolvedProvider> {
  const supabase = createServiceClient();

  const { data: bindings } = await supabase
    .from('ai_model_providers')
    .select('provider_id, provider_model_id, input_overrides, priority, is_active')
    .eq('model_id', modelId)
    .eq('is_active', true)
    .order('priority', { ascending: true })
    .limit(1);

  if (bindings && bindings.length > 0) {
    const b = bindings[0];
    return {
      providerKey: b.provider_id,
      providerModelId: b.provider_model_id,
      inputOverrides: (b.input_overrides as any) ?? null,
    };
  }

  const { data: model } = await supabase
    .from('ai_models')
    .select('replicate_model_id, provider_model_id, providers(adapter_key)')
    .eq('id', modelId)
    .single();

  const adapterKey = (model as any)?.providers?.adapter_key as string | undefined;
  if (adapterKey) {
    return { providerKey: adapterKey, providerModelId: (model as any)?.provider_model_id || '', inputOverrides: null };
  }
  return { providerKey: 'replicate', providerModelId: (model as any)?.replicate_model_id || '', inputOverrides: null };
}

/**
 * Apply a binding's input_overrides to the api_mapping_key-keyed payload. Shape:
 *   { rename: { fromKey: toKey }, defaults: { key: value } }
 * rename moves a value to the provider's key; defaults fill a key only if absent.
 * No-op when overrides is null. Curated v1 models pass null.
 */
export function applyInputOverrides(inputs: Record<string, any>, overrides: Record<string, any> | null): Record<string, any> {
  if (!overrides) return inputs;
  const out = { ...inputs };
  const rename = overrides.rename as Record<string, string> | undefined;
  if (rename) {
    for (const [from, to] of Object.entries(rename)) {
      if (from in out) { out[to] = out[from]; delete out[from]; }
    }
  }
  const defaults = overrides.defaults as Record<string, any> | undefined;
  if (defaults) {
    for (const [k, v] of Object.entries(defaults)) {
      if (out[k] === undefined || out[k] === null || out[k] === '') out[k] = v;
    }
  }
  return out;
}
