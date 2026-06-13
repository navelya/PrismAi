/**
 * CSS-filter → ffmpeg filter-atom translator (server-safe, no React).
 *
 * Live filter nodes (blur today; future effects) publish their effect as a
 * CSS filter string inside a `kind: 'filter'` GraphDescription — that's what
 * every client surface renders via `ctx.filter`. The server export flattens
 * those graphs into a single ffmpeg pass, so the same vocabulary must map to
 * ffmpeg filters here.
 *
 * Unit semantics: `blur(Npx)` sigma is interpreted in the BASE graph's canvas
 * pixels (that's the resolution the client applies `ctx.filter` at — see
 * paintGraphFrame's filter branch). Callers must therefore inject these atoms
 * into the layer's chain at base-canvas resolution, BEFORE the final scale to
 * the layer's transform box.
 *
 * Unknown filter functions THROW. Every filter node is in-repo, so an unknown
 * function means this translator wasn't updated alongside a new node — fail
 * loudly in dev rather than silently rendering without the effect. (When you
 * add a filter-publishing ephemeral node, add its functions here.)
 *
 * Known approximations (mirroring blur/executor.server.ts):
 *   - CSS brightness() is multiplicative; ffmpeg eq brightness is additive.
 *     brightness(1.05) ≈ eq brightness=+0.05.
 *   - opacity() is a compositing concept with no meaning for an opaque video
 *     stream; dropped, matching the sharp pipeline which also drops it.
 *
 * Ordering: spatial atoms (gblur/hue) are emitted in CSS encounter order; the
 * combined `eq` atom (brightness/contrast/saturation) is always appended LAST.
 * blur and eq are both linear-ish operations so they commute in practice, and
 * no current filter node emits both in one chain — but if a future node needs
 * strict CSS left-to-right ordering between a spatial and a non-spatial filter,
 * emit per-encounter atoms instead of coalescing eq.
 */

/**
 * @param blurSigmaScale Multiplier for blur sigma. blur() px is relative to the
 *   resolution the filter is applied at; when the server renders a layer at a
 *   HIGHER resolution than the cssFilter was calibrated for (the base graph's
 *   canvas), pass nativeWidth/baseCanvasWidth so the rendered blur matches the
 *   preview's apparent strength. Only gblur scales with resolution (hue/eq don't).
 */
export function cssFilterToFfmpegAtoms(cssFilter: string, blurSigmaScale = 1): string[] {
    const atoms: string[] = [];
    const eq: { contrast?: number; brightness?: number; saturation?: number } = {};

    const re = /([a-z-]+)\(([^)]*)\)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(cssFilter)) !== null) {
        const fn = m[1].toLowerCase();
        const arg = m[2].trim();
        const num = parseFloat(arg);
        switch (fn) {
            case 'blur':
                if (isFinite(num) && num > 0) {
                    const sigma = num * (blurSigmaScale > 0 ? blurSigmaScale : 1);
                    atoms.push(`gblur=sigma=${sigma.toFixed(4)}`);
                }
                break;
            case 'contrast':
                if (isFinite(num)) eq.contrast = num;
                break;
            case 'brightness':
                if (isFinite(num)) eq.brightness = num;
                break;
            case 'saturate':
                if (isFinite(num)) eq.saturation = num;
                break;
            case 'grayscale':
                if (isFinite(num)) atoms.push(`hue=s=${Math.max(0, 1 - num)}`);
                break;
            case 'hue-rotate':
                if (isFinite(num)) atoms.push(`hue=h=${num}`);
                break;
            case 'opacity':
                // Dropped — see header.
                break;
            default:
                throw new Error(
                    `Unsupported CSS filter function "${fn}" in "${cssFilter}" — add a mapping in css-filter-ffmpeg.ts`,
                );
        }
    }

    const eqParts: string[] = [];
    if (eq.contrast !== undefined && eq.contrast !== 1) eqParts.push(`contrast=${eq.contrast}`);
    if (eq.brightness !== undefined && eq.brightness !== 1) eqParts.push(`brightness=${(eq.brightness - 1).toFixed(4)}`);
    if (eq.saturation !== undefined && eq.saturation !== 1) eqParts.push(`saturation=${eq.saturation}`);
    if (eqParts.length > 0) atoms.push(`eq=${eqParts.join(':')}`);

    return atoms;
}
