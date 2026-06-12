import { AsyncProviderAdapter } from './types';
import { replicateAsyncAdapter } from './replicate';
import { falAsyncAdapter } from './fal';

/**
 * Maps a provider key to its async adapter. New async providers are added here.
 * Unknown keys resolve to `undefined` — NEVER silently to Replicate: polling a
 * foreign job id against Replicate's API would misreport status (e.g. fail and
 * refund a job that actually succeeded). Callers must handle `undefined` loudly.
 */
const asyncAdapters: Record<string, AsyncProviderAdapter> = {
  replicate: replicateAsyncAdapter,
  fal: falAsyncAdapter,
};

export function getAsyncAdapter(key: string | null | undefined): AsyncProviderAdapter | undefined {
  return key ? asyncAdapters[key] : undefined;
}
