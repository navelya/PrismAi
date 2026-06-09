import { ProviderAdapter } from './types';
import { elevenlabsAdapter } from './elevenlabs';

/**
 * Maps providers.adapter_key → server adapter. Add new external providers here.
 * A model whose provider has no entry falls through to the Replicate path.
 */
const adapters: Record<string, ProviderAdapter> = {
  [elevenlabsAdapter.key]: elevenlabsAdapter,
};

export function getProviderAdapter(key: string | null | undefined): ProviderAdapter | undefined {
  if (!key) return undefined;
  return adapters[key];
}
