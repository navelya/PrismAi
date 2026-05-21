/**
 * Two handles connect if they share a data-type id, or either side is 'any'.
 * Either side may also be an array of accepted ids (input handles can declare
 * a union, e.g. compositor accepts ['image','text']).
 *
 * Array-typed handles (e.g. `image_array`) are treated as compatible with
 * their base type (`image`) in either direction: an array source feeds a
 * single-image consumer (which picks via `selectedIndex`) and a single-image
 * source feeds an array consumer (a length-1 array). Without this fold the
 * wire-drop menu would filter out almost every node when dragging from a
 * Media Input output.
 */
export function typesAreCompatible(
    sourceType: string | string[],
    targetType: string | string[]
): boolean {
    if (!sourceType || !targetType) return false;
    const sources = Array.isArray(sourceType) ? sourceType : [sourceType];
    const targets = Array.isArray(targetType) ? targetType : [targetType];
    if (sources.includes('any') || targets.includes('any')) return true;

    const stripArray = (t: string) => t.replace(/_array$/, '');
    const sourceBases = sources.map(stripArray);
    const targetBases = targets.map(stripArray);
    return sourceBases.some((s) => targetBases.includes(s));
}
