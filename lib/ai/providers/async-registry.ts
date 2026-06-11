import { AsyncProviderAdapter } from './types';
import { replicateAsyncAdapter } from './replicate';

/**
 * Maps a provider key to its async adapter. The default provider (no/`'replicate'`
 * adapter_key) resolves to the Replicate adapter. New async providers (FAL,
 * WaveSpeed, KIE, Kinovi) are added here in Phase B/C.
 */
const asyncAdapters: Record<string, AsyncProviderAdapter> = {
  replicate: replicateAsyncAdapter,
};

export function getAsyncAdapter(key: string | null | undefined): AsyncProviderAdapter {
  const resolved = key && asyncAdapters[key] ? asyncAdapters[key] : asyncAdapters.replicate;
  return resolved;
}
