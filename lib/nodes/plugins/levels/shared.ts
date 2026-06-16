/**
 * Pure helpers shared by Levels server + client executors.
 *
 * The math:
 *   normalized = (i - black) / (white - black)         // clamped to [0,1]
 *   output     = pow(normalized, 1 / gamma) * 255      // gamma>1 brightens midtones
 */

export function buildLevelsLut(black: number, white: number, gamma: number): Uint8ClampedArray {
    const b = Math.max(0, Math.min(255, black));
    const w = Math.max(0, Math.min(255, white));
    const g = Math.max(0.01, gamma);
    // Avoid div-by-zero when black >= white: produce a hard threshold at b.
    const range = w - b;
    const invGamma = 1 / g;
    const lut = new Uint8ClampedArray(256);
    if (range <= 0) {
        for (let i = 0; i < 256; i++) lut[i] = i >= b ? 255 : 0;
        return lut;
    }
    for (let i = 0; i < 256; i++) {
        const n = (i - b) / range;
        const clamped = n <= 0 ? 0 : n >= 1 ? 1 : n;
        lut[i] = Math.round(Math.pow(clamped, invGamma) * 255);
    }
    return lut;
}

/**
 * Apply an RGB LUT in-place to a raw RGBA buffer (channels = 4).
 * Alpha channel is left untouched.
 */
export function applyLutInPlace(buf: Uint8Array | Uint8ClampedArray, lut: Uint8ClampedArray): void {
    for (let i = 0, n = buf.length; i < n; i += 4) {
        buf[i] = lut[buf[i]];
        buf[i + 1] = lut[buf[i + 1]];
        buf[i + 2] = lut[buf[i + 2]];
    }
}

/**
 * Levels expressed as a token in the shared compositor cssFilter vocabulary
 * (see lib/nodes/plugins/compositor/css-filter-ffmpeg.ts and graph-renderer.ts).
 *
 * Levels' gamma has no native CSS-filter equivalent, so it can't ride the same
 * `ctx.filter` string path that blur's `blur(Npx)` does. Instead the video
 * branch publishes this custom `levels(black,white,gamma)` token inside the
 * `kind: 'filter'` graph; the client renderer applies it as a per-frame LUT and
 * the server translator maps it to an exact ffmpeg `lutrgb` expression. Both
 * sides parse the same token, so the live preview and the committed render match.
 */
export function levelsFilterToken(black: number, white: number, gamma: number): string {
    const b = Math.max(0, Math.min(255, Math.round(black)));
    const w = Math.max(0, Math.min(255, Math.round(white)));
    const g = Math.max(0.01, gamma);
    return `levels(${b},${w},${g})`;
}

/**
 * Build the exact ffmpeg `lutrgb` per-component expression for a levels
 * transform. Mirrors buildLevelsLut's math exactly so the rendered video
 * matches the LUT used for stills and the live preview:
 *   out = clip(pow(clip((val-b)/(w-b), 0, 1), 1/g), 0, 1) * 255
 * When black >= white the range collapses to a hard threshold at b.
 *
 * Returns the inner expression string (the same for r/g/b); callers compose
 * `lutrgb=r='EXPR':g='EXPR':b='EXPR'`. `val` is ffmpeg's input-sample variable.
 */
export function levelsLutrgbExpr(black: number, white: number, gamma: number): string {
    const b = Math.max(0, Math.min(255, Math.round(black)));
    const w = Math.max(0, Math.min(255, Math.round(white)));
    const g = Math.max(0.01, gamma);
    const invG = 1 / g;
    if (w - b <= 0) {
        // Hard threshold at b (matches buildLevelsLut's range<=0 branch).
        return `if(gte(val,${b}),255,0)`;
    }
    const range = w - b;
    // clip the normalized value to [0,1], raise to 1/gamma, scale to 0-255.
    return `clip(pow(clip((val-${b})/${range},0,1),${invG}),0,1)*255`;
}
