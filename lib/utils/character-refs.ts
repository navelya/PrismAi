/** What the client sends: just the ids the user @-mentioned this turn. */
export interface CharacterRef {
  id: string;
}

/** Server-resolved snapshot used to hydrate character node configs.
 *  Built from the DB (never fabricated by the LLM). */
export interface CharacterSnapshot {
  characterId: string;
  name: string;
  description: string | null;
  referenceImages: string[]; // URLs, 1-6; index 0 = primary (full body)
  faceImage?: string;        // URL of the close-up face reference, if one exists
  weight: number;
}

/** Hard cap on @-mentions per message — guards the prompt + node count. */
export const MAX_CHARACTER_REFS = 8;

/** Sanitize a raw client payload into a capped list of unique id strings. */
export function sanitizeMentionedCharacterIds(raw: any): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const id = typeof item === 'string' ? item : typeof item?.id === 'string' ? item.id : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id.slice(0, 128));
    if (out.length >= MAX_CHARACTER_REFS) break;
  }
  return out;
}
