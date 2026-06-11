import { AsyncProviderAdapter } from './types';
import { replicateAsyncAdapter } from './replicate';
import { falAsyncAdapter } from './fal';

/**
 * Maps a provider key to its async adapter. The default provider (no/`'replicate'`
 * adapter_key) resolves to the Replicate adapter. New async providers are added here.
 */
const asyncAdapters: Record<string, AsyncProviderAdapter> = {
  replicate: replicateAsyncAdapter,
  fal: falAsyncAdapter,
};

export function getAsyncAdapter(key: string | null | undefined): AsyncProviderAdapter {
  const resolved = key && asyncAdapters[key] ? asyncAdapters[key] : asyncAdapters.replicate;
  return resolved;
}
