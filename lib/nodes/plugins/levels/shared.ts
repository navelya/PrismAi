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
