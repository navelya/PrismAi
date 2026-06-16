/**
 * Shared media-fit sizing for nodes that hug their preview media.
 *
 * A node sized to its media's aspect ratio shows the WHOLE frame — no cropping,
 * no empty letterbox bars. The trick is to derive the node's WIDTH from the
 * media's natural aspect so that, paired with `object-contain` media that fills
 * that width (`w-full h-auto`), the rendered height never exceeds the cap:
 *   - landscape/square → full width; height (width / aspect) stays ≤ cap.
 *   - portrait        → narrow the node so its height lands exactly on the cap.
 *
 * The ai_generator node has used this model for its single-view preview; the
 * ephemeral media nodes (blur, extract_frame, levels, compare) share it via this
 * helper so every node fits media identically instead of each diverging into its
 * own object-cover / fixed-box behaviour.
 */
export const MEDIA_FIT_MAX = 460;

export function fitMediaWidth(
    naturalWidth: number,
    naturalHeight: number,
    {
        maxWidth = MEDIA_FIT_MAX,
        maxHeight = MEDIA_FIT_MAX,
        minWidth = 200,
    }: { maxWidth?: number; maxHeight?: number; minWidth?: number } = {},
): number | null {
    if (!(naturalWidth > 0) || !(naturalHeight > 0)) return null;
    const w =
        naturalWidth >= naturalHeight
            ? maxWidth
            : Math.round((maxHeight * naturalWidth) / naturalHeight);
    return Math.max(minWidth, Math.min(maxWidth, w));
}

/**
 * Tailwind classes for a media element that fills its (aspect-fitted) node width
 * and never crops. Use alongside a node whose width comes from `fitMediaWidth`.
 */
export const MEDIA_FIT_CLASS = 'w-full h-auto object-contain max-w-none max-h-[460px]';
