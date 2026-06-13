/**
 * Canonical list of API providers — where a model RUNS. This is DISTINCT from the
 * `providers` table, which is the model BRAND catalog (e.g. "Black Forest Labs")
 * shown/grouped in the node library via ai_models.provider_id. The bindings UI
 * ("Add provider") sources from THIS list, never from `providers`, so registering
 * an API provider never pollutes the brand catalog.
 *
 * The binding table stores these by adapter-key TEXT (ai_model_providers.provider_id),
 * not an FK, so this code list is the single source of truth for the picker.
 * Keep in sync with lib/ai/providers/async-registry.ts (+ the ElevenLabs sync
 * adapter). ElevenLabs is intentionally BOTH a brand row AND an API provider.
 *
 * Client-safe: a pure constant, no adapter imports (so it can be used in the
 * admin form without pulling server code into the browser bundle).
 */
export interface ApiProviderInfo {
  key: string;   // adapter key stored in ai_model_providers.provider_id
  name: string;  // display label for the picker
}

export const API_PROVIDERS: ApiProviderInfo[] = [
  { key: 'replicate', name: 'Replicate' },
  { key: 'fal', name: 'FAL' },
  { key: 'wavespeed', name: 'WaveSpeed' },
  { key: 'kie', name: 'KIE' },
  { key: 'elevenlabs', name: 'ElevenLabs' },
  // Kinovi is intentionally NOT offered: it has no webhook, so it can only
  // complete via the polling sweep (which requires scheduling pg_cron / an
  // external cron). Re-add `{ key: 'kinovi', name: 'Kinovi' }` once that backstop
  // is enabled — the adapter (lib/ai/providers/kinovi.ts) is still registered.
];

export function apiProviderName(key: string): string {
  const k = (key || '').trim().toLowerCase();
  return API_PROVIDERS.find((p) => p.key === k)?.name || k;
}
