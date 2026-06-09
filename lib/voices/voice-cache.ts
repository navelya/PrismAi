'use client';

import type { VoiceRecord } from '@/components/editor/VoicePickerModal';

/**
 * A tiny client-side cache of resolved voice records, keyed by external_voice_id.
 *
 * Why: the properties panel stores only the external_voice_id, so the selected-voice
 * card would otherwise show the raw id, then pop in a second later once the record is
 * fetched. Caching the record (in memory + localStorage) lets the card render its full
 * content immediately — on reopen within the session AND across page reloads. The first
 * time a brand-new id is seen we still fetch once, then it's cached forever.
 *
 * Also reused by the picker modal to warm the cache for every voice it lists, so
 * selecting a voice and reopening its node is always instant.
 */

const LS_KEY = 'prismai:voiceCache:v1';
const MAX_ENTRIES = 500; // bound localStorage growth

const mem = new Map<string, VoiceRecord>();
let hydrated = false;

function hydrateOnce() {
  if (hydrated || typeof window === 'undefined') return;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw) as Record<string, VoiceRecord>;
    for (const [k, v] of Object.entries(obj)) mem.set(k, v);
  } catch {
    /* ignore corrupt cache */
  }
}

function persist() {
  if (typeof window === 'undefined') return;
  try {
    // Keep the most-recently-set entries if we're over the cap (Map preserves order).
    const entries = Array.from(mem.entries());
    const kept = entries.slice(Math.max(0, entries.length - MAX_ENTRIES));
    window.localStorage.setItem(LS_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    /* quota / serialization issues are non-fatal */
  }
}

/** Synchronously read a cached voice record (or null). Safe during render. */
export function getCachedVoice(externalId: string | null | undefined): VoiceRecord | null {
  if (!externalId) return null;
  hydrateOnce();
  return mem.get(String(externalId)) || null;
}

/** Store/refresh a voice record. Re-inserts to mark it most-recent for eviction. */
export function setCachedVoice(voice: VoiceRecord | null | undefined) {
  if (!voice?.external_voice_id) return;
  hydrateOnce();
  const key = String(voice.external_voice_id);
  mem.delete(key);
  mem.set(key, voice);
  persist();
}

/** Bulk-warm the cache (e.g. from a page of picker results). */
export function cacheVoices(voices: VoiceRecord[] | null | undefined) {
  if (!voices?.length) return;
  hydrateOnce();
  for (const v of voices) {
    if (!v?.external_voice_id) continue;
    const key = String(v.external_voice_id);
    mem.delete(key);
    mem.set(key, v);
  }
  persist();
}
