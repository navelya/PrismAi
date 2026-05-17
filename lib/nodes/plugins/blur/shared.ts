/**
 * Shared blur math used by the component, the client executor, and (via
 * import) verified against the server executor.
 *
 * The slider stores 0–100 in `config.radius` for UI familiarity. Both the
 * client preview (CSS `blur(Npx)`) and the server pipeline (ffmpeg
 * `gblur=sigma=N` / sharp's `.blur(N)`) need to receive the SAME effective
 * sigma so the live preview matches the committed render.
 *
 * Mapping: sigma = radius / 2 (range 0–50). Why half:
 *   - Server-side `gblur=sigma=100` is extreme and overshoots what most users
 *     actually want; capping the effective sigma at 50 keeps the high end of
 *     the slider in a useful range without changing the saved slider value
 *     (so existing workflows preserve their radius).
 *   - 50px CSS blur is already very strong on the client — past that the
 *     image is essentially a flat color, so wider client-side mapping
 *     wouldn't add expressive range either.
 *
 * If we ever want to widen the range, change BOTH this helper AND the
 * matching factor in executor.server.ts (`sigma = (config.radius ?? 5) / 2`).
 */

export function radiusToSigma(radius: number): number {
    return Math.max(0, radius) / 2;
}

export function blurFilterString(radius: number): string {
    return `blur(${radiusToSigma(radius)}px)`;
}
