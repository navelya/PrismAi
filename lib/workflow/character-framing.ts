/**
 * Hidden prompt framing for character references.
 *
 * A `character` node outputs a photographic *character sheet* — one image that
 * usually shows the person across several angles, poses, and expressions. By the
 * time that sheet reaches a model it is just an opaque image URL, so the model
 * reads a sheet full of faces as a scene containing several different people and
 * applies the prompt to all of them. We prepend a short framing instruction so it
 * treats each sheet as ONE consistent character. The user never sees this text.
 *
 * No names and no descriptions are injected: the model has the image and can see
 * the character better than any sentence, and the user describes who they mean
 * ("the redhead") rather than naming them.
 */

export const CHARACTER_FRAMING_SINGLE =
  'The reference image is a character sheet showing ONE single person across ' +
  'multiple angles, poses, and expressions. Treat it as a single consistent ' +
  'character and apply the request to that one person.';

export const CHARACTER_FRAMING_MULTI =
  'The reference images are separate character sheets. Each sheet depicts ONE ' +
  'distinct person (shown across multiple angles/poses). These are different ' +
  'individuals — keep them distinct and apply the request to the people ' +
  'described below.';

/**
 * The framing text for a given number of connected character nodes.
 * Returns '' for 0 (nothing to frame), the single-character text for 1, and the
 * multi-character text for 2+.
 */
export function buildCharacterFraming(count: number): string {
  if (!count || count < 1) return '';
  return count === 1 ? CHARACTER_FRAMING_SINGLE : CHARACTER_FRAMING_MULTI;
}

/**
 * Count the distinct `character` nodes wired into `targetNodeId`.
 * `nodeTypeById` maps node id -> node type (e.g. 'character', 'ai_generator').
 * Used by both dispatch paths so the rule lives in exactly one place.
 */
export function countCharacterParents(
  edges: Array<{ source: string; target: string }>,
  targetNodeId: string,
  nodeTypeById: Map<string, string | undefined>
): number {
  const sources = new Set<string>();
  for (const e of edges) {
    if (e.target !== targetNodeId) continue;
    if (nodeTypeById.get(e.source) === 'character') sources.add(e.source);
  }
  return sources.size;
}
