import type { RegistryContextInput } from './prompt/registry-context';

/**
 * Module-level TTL cache for the ai_models + node_types tables. The data
 * changes when an admin adds/edits a model — typically once a week — so a
 * 5-minute cache eliminates the per-turn Supabase round-trip without
 * letting stale data linger meaningfully. Each server instance has its
 * own cache; cold starts will refetch.
 */

const TTL_MS = 5 * 60 * 1000;

let cache: { data: RegistryContextInput; expiresAt: number } | null = null;
let inFlight: Promise<RegistryContextInput> | null = null;

export async function getRegistryContext(supabase: any): Promise<RegistryContextInput> {
  const now = Date.now();
  if (cache && cache.expiresAt > now) return cache.data;

  // Coalesce concurrent refetches so a burst of chat requests on cold
  // cache only triggers one DB round-trip.
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const [{ data: models }, { data: nodeTypes }] = await Promise.all([
        supabase
          .from('ai_models')
          .select('id, display_name, node_type_id, inputs_schema, providers(name)')
          .eq('is_active', true)
          .order('display_name'),
        supabase
          .from('node_types')
          .select('id, display_name')
          .order('display_name'),
      ]);

      const data: RegistryContextInput = {
        models: (models as any[]) || [],
        nodeTypes: (nodeTypes as any[]) || [],
      };
      cache = { data, expiresAt: Date.now() + TTL_MS };
      return data;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Invalidate the cache immediately. Call this from admin endpoints that
 * mutate ai_models or node_types so the chat picks up new models faster
 * than the 5-minute TTL.
 */
export function invalidateRegistryCache(): void {
  cache = null;
}
