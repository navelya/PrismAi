/**
 * Pure helpers shared between the compositor's client renderer, editor modal,
 * server executor, and timeline UI. NO React, NO Sharp, NO ffmpeg imports —
 * this module must be safely importable from any of those surfaces.
 */

import { CompositorLayer } from './definition';

export type LayerSourceKind = 'image' | 'video' | 'audio' | 'text' | 'unknown';

// ───────────────────────────────────────────────────────────────────────────
// Pull-model graph description
//
// A `GraphDescription` is a serializable "how to render this output at any
// time t" — published in `nodeOutputs[id].data[0].graph` by any node whose
// output is a live signal. Downstream consumers don't read the upstream's
// canvas; they walk the graph and render it themselves at their own playhead.
//
// Two kinds:
//   - 'compositor': a timeline of layers, each with a source (media URL, text,
//     or a nested graph). The renderer composites them.
//   - 'filter': wraps an upstream graph and applies a CSS filter on top.
//     Used by Blur (and future filter nodes) so the filter compounds purely
//     as a descriptor without baking pixels.
// ───────────────────────────────────────────────────────────────────────────

export type GraphLayerSource =
    | { kind: 'media'; url: string; mediaKind: 'image' | 'video' }
    | { kind: 'text'; text: string }
    | { kind: 'graph'; graph: GraphDescription };

export interface GraphLayer {
    layer: CompositorLayer;
    source: GraphLayerSource;
}

export type GraphDescription =
    | {
          kind: 'compositor';
          layers: GraphLayer[];
          canvasWidth: number;
          canvasHeight: number;
          duration: number;
          fps: number;
          intrinsicDurations: Record<string, number | null>;
      }
    | {
          kind: 'filter';
          upstream: GraphDescription;
          cssFilter: string;
      };

/**
 * Pull the dimensions of a graph regardless of kind — filter graphs report
 * their upstream's dimensions since they don't change resolution.
 */
export function graphDimensions(graph: GraphDescription): { width: number; height: number } {
    if (graph.kind === 'filter') return graphDimensions(graph.upstream);
    return { width: graph.canvasWidth, height: graph.canvasHeight };
}

/**
 * Total timeline duration of a graph regardless of kind.
 */
export function graphDuration(graph: GraphDescription): number {
    if (graph.kind === 'filter') return graphDuration(graph.upstream);
    return graph.duration;
}

/**
 * Accumulate the cssFilter chain by descending through filter graphs.
 * Returns the concatenated CSS filter string and the innermost non-filter
 * graph. Used by consumers that render the underlying compositor surface
 * once and then apply the accumulated filter via CSS at display time.
 */
export function flattenFilters(graph: GraphDescription): {
    base: Exclude<GraphDescription, { kind: 'filter' }>;
    cssFilter: string;
} {
    let cssFilter = '';
    let current: GraphDescription = graph;
    while (current.kind === 'filter') {
        cssFilter = cssFilter ? `${current.cssFilter} ${cssFilter}` : current.cssFilter;
        current = current.upstream;
    }
    return { base: current, cssFilter };
}

/**
 * Best-effort detection of a layer's source kind from its resolved upstream
 * value. The renderer hands us either:
 *   - a string (text from Prompt nodes)
 *   - an object with `.graph` (live `GraphDescription` — pull-model upstream)
 *   - an object with `.url` (image or video media object)
 *   - null/undefined when the upstream hasn't produced anything yet
 */
export function detectSourceKind(resolved: any): LayerSourceKind {
    if (resolved === null || resolved === undefined) return 'unknown';
    if (typeof resolved === 'string') return 'text';
    if (typeof resolved !== 'object') return 'unknown';

    // A pull-model graph is always video-like for gating + transport purposes;
    // even a still-image-only subgraph behaves as a temporal surface here.
    if ((resolved as any).graph) return 'video';

    const url: string | undefined =
        typeof (resolved as any).url === 'string' && (resolved as any).url.length > 0
            ? (resolved as any).url
            : undefined;
    if (!url) return 'unknown';
    return detectSourceKindFromUrl(url);
}

export function detectSourceKindFromUrl(url: string): LayerSourceKind {
    const normalized = url.toLowerCase();
    if (/\.(mp4|webm|mov|avi|mkv|m4v)(\?|$)/.test(normalized)) return 'video';
    if (/\.(png|jpe?g|webp|gif|bmp|svg|avif)(\?|$)/.test(normalized)) return 'image';
    if (/\.(mp3|wav|ogg|oga|m4a|aac|flac|opus|weba)(\?|$)/.test(normalized)) return 'audio';
    if (/^data:video/.test(normalized)) return 'video';
    if (/^data:image/.test(normalized)) return 'image';
    if (/^data:audio/.test(normalized)) return 'audio';
    return 'unknown';
}

/**
 * "Effective duration" for a single layer given:
 *   - its configured `duration` (may be null)
 *   - its source kind (video knows its own length; image/text don't)
 *   - the source's intrinsic length (only known for video; in seconds)
 *   - the resolved timeline total (used as the fallback length for layers
 *     whose `duration` is null and which have no intrinsic length)
 *
 * Returns the visible length in seconds. For image/text layers with no
 * configured duration, this falls back to `fallbackTimeline` so they're
 * "always on" by default.
 */
export function getEffectiveDuration(
    layer: CompositorLayer,
    sourceKind: LayerSourceKind,
    intrinsicDuration: number | null,
    fallbackTimeline: number,
): number {
    if (typeof layer.duration === 'number' && layer.duration > 0) {
        return layer.duration;
    }
    // Video AND audio know their own intrinsic length; an audio clip should
    // span its real running time on the timeline rather than the image/text
    // "full timeline" fallback.
    if ((sourceKind === 'video' || sourceKind === 'audio') && intrinsicDuration && intrinsicDuration > 0) {
        return Math.max(0.1, intrinsicDuration - Math.max(0, layer.trimIn || 0));
    }
    return Math.max(0.1, fallbackTimeline);
}

/**
 * Source-relative seek time for a layer at a given timeline time.
 * `trimIn` shifts the source forward; activity gating is separate (timeline
 * space). Shared so preview (Renderer/CompositorAudio) and any future caller
 * agree on the mapping.
 */
export function getSourceSeekTime(layer: CompositorLayer, timelineTime: number): number {
    const local = Math.max(0, timelineTime - Math.max(0, layer.startTime || 0));
    return local + Math.max(0, layer.trimIn || 0);
}

/** Minimum clip length (seconds) — prevents zero/negative-width splits. */
export const MIN_CLIP_DURATION = 0.05;

/**
 * Split one layer into two contiguous clips at the playhead (blade cut).
 *
 * - The left clip keeps `startTime`/`trimIn`, gets a finite `duration` up to
 *   the playhead.
 * - The right clip gets a fresh `id`, starts at the playhead, advances
 *   `trimIn` by the left length (so its source content is time-locked), and
 *   gets the remaining duration.
 *
 * Returns `[left, null]` (no split) when the playhead is not strictly inside
 * `(startTime, startTime + effectiveDuration)`. Caller passes the resolved
 * effective duration (handles `null`-duration image/video uniformly).
 */
export function splitLayerAtPlayhead(
    layer: CompositorLayer,
    playhead: number,
    effectiveDuration: number,
): [CompositorLayer, CompositorLayer | null] {
    const start = Math.max(0, layer.startTime || 0);
    const end = start + effectiveDuration;
    if (playhead <= start + MIN_CLIP_DURATION || playhead >= end - MIN_CLIP_DURATION) {
        return [layer, null];
    }
    const leftDur = playhead - start;
    const rightDur = end - playhead;
    const left: CompositorLayer = { ...layer, duration: leftDur };
    const right: CompositorLayer = {
        ...layer,
        id: `layer_${crypto.randomUUID()}`,
        startTime: playhead,
        duration: rightDur,
        trimIn: Math.max(0, layer.trimIn || 0) + leftDur,
    };
    return [left, right];
}

/**
 * Compute the timeline's total duration in seconds.
 *
 * - If `config.timelineDuration` is a positive number, that wins.
 * - Otherwise we resolve it as the max layer end (startTime + effective
 *   duration). Image/text layers without configured durations contribute
 *   0 here so they don't artificially extend the timeline.
 * - Falls back to a small positive number so callers can divide safely.
 *
 * `intrinsicByLayerId` maps layer.id → its source's natural duration in
 * seconds. Callers (editor + server executor) populate it from probed
 * video metadata; layers absent from the map are treated as having no
 * intrinsic length.
 */
export function computeTimelineDuration(
    layers: CompositorLayer[],
    configuredDuration: number | null,
    intrinsicByLayerId: Record<string, number | null> = {},
): number {
    if (typeof configuredDuration === 'number' && configuredDuration > 0) {
        return configuredDuration;
    }

    let maxEnd = 0;
    for (const l of layers) {
        const start = Math.max(0, l.startTime || 0);
        const intrinsic = intrinsicByLayerId[l.id] ?? null;
        let dur = 0;
        if (typeof l.duration === 'number' && l.duration > 0) {
            dur = l.duration;
        } else if (intrinsic && intrinsic > 0) {
            dur = Math.max(0.1, intrinsic - Math.max(0, l.trimIn || 0));
        }
        const end = start + dur;
        if (end > maxEnd) maxEnd = end;
    }
    return maxEnd > 0 ? maxEnd : 1;
}

/**
 * Is the layer "active" (within its visibility window) at timeline time `t`?
 *
 * For layers with a finite effective duration (video, or anything with a
 * configured duration): active when `startTime <= t < startTime + duration`.
 *
 * For layers with no finite duration (image/text without configured duration):
 * active whenever `t >= startTime` — they stay on until the end of the
 * timeline. This matches the "logo always on" UX default.
 */
export function isLayerActiveAt(
    layer: CompositorLayer,
    sourceKind: LayerSourceKind,
    intrinsicDuration: number | null,
    t: number,
): boolean {
    if (!layer.visible) return false;
    const start = Math.max(0, layer.startTime || 0);
    if (t < start) return false;

    // Has a finite duration → time-bounded
    if (typeof layer.duration === 'number' && layer.duration > 0) {
        return t < start + layer.duration;
    }
    // Video/audio with known intrinsic length and no overridden duration.
    // Subtract trimIn so a trimmed clip's window ends at its remaining source.
    if ((sourceKind === 'video' || sourceKind === 'audio') && intrinsicDuration && intrinsicDuration > 0) {
        return t < start + Math.max(0.1, intrinsicDuration - Math.max(0, layer.trimIn || 0));
    }
    // Image/text with null duration → always on after startTime
    return true;
}

/**
 * Resolve a graph's effective timeline duration, trusting the published
 * `duration` field when positive but falling back to a recomputation from the
 * graph's own layers when it is 0/absent (blur's `wrapUrlAsCompositorGraph`
 * publishes duration 0 because the client executor can't know the video's
 * intrinsic length synchronously).
 *
 * `getIntrinsic` supplies the intrinsic duration of a media layer once the
 * consumer's decoder has loaded metadata (e.g. GraphRenderCache's pooled
 * <video>.duration). Layers whose intrinsic isn't known yet contribute 0 —
 * callers should re-resolve when metadata arrives.
 */
export function resolveGraphDuration(
    graph: GraphDescription,
    getIntrinsic: (url: string, layerId: string) => number | null,
): number {
    if (graph.kind === 'filter') return resolveGraphDuration(graph.upstream, getIntrinsic);
    if (graph.duration > 0) return graph.duration;

    const intrinsicByLayerId: Record<string, number | null> = {};
    for (const gl of graph.layers) {
        if (gl.source.kind === 'media' && gl.source.mediaKind === 'video') {
            intrinsicByLayerId[gl.layer.id] = getIntrinsic(gl.source.url, gl.layer.id);
        } else if (gl.source.kind === 'graph') {
            intrinsicByLayerId[gl.layer.id] = resolveGraphDuration(gl.source.graph, getIntrinsic) || null;
        }
    }
    const computed = computeTimelineDuration(
        graph.layers.map((gl) => gl.layer),
        null,
        intrinsicByLayerId,
    );
    // computeTimelineDuration floors at 1 even when nothing is known; report 0
    // in the genuinely-unknown case so callers can distinguish "not loaded yet".
    const anyKnown = Object.values(intrinsicByLayerId).some((v) => v && v > 0)
        || graph.layers.some((gl) => typeof gl.layer.duration === 'number' && gl.layer.duration > 0);
    return anyKnown ? computed : 0;
}

/**
 * Has any layer been positioned on the timeline OR is sourced from a video?
 * The server executor uses this to decide between the still-image path and
 * the video render path. The client UI uses it to decide whether to surface
 * the transport bar.
 */
export function hasTemporalContent(
    layers: CompositorLayer[],
    sourceKindByLayerId: Record<string, LayerSourceKind>,
): boolean {
    for (const l of layers) {
        const kind = sourceKindByLayerId[l.id] ?? 'unknown';
        // Audio is temporal too — its presence forces the video render path so
        // the output mp4 can carry an audio track (an image-only "still" output
        // has no container for sound).
        if (kind === 'video' || kind === 'audio') return true;
        if ((l.startTime || 0) > 0) return true;
        if (typeof l.duration === 'number' && l.duration > 0) return true;
    }
    return false;
}

/** Frame index for a given time and framerate. */
export function timeToFrame(t: number, fps: number): number {
    return Math.max(0, Math.floor(t * fps));
}

/** Format `12.345` seconds as `00:12:10` (mm:ss:ff) given a framerate. */
export function formatTimecode(seconds: number, fps: number): string {
    const safe = Math.max(0, seconds);
    const totalFrames = Math.floor(safe * fps);
    const ff = totalFrames % fps;
    const totalSeconds = Math.floor(safe);
    const ss = totalSeconds % 60;
    const mm = Math.floor(totalSeconds / 60);
    return `${pad2(mm)}:${pad2(ss)}:${pad2(ff)}`;
}

function pad2(n: number): string {
    return n < 10 ? `0${n}` : String(n);
}

/** Axis-aligned bounding box in canvas coordinates. */
export interface AABB { minX: number; minY: number; maxX: number; maxY: number; }

/**
 * Rotated-rectangle axis-aligned bounding box for a layer, in canvas
 * coordinates. Mirrors the corner math previously inlined in the editor's
 * fit-canvas-to-content routine so the marquee hit-test and the fit logic
 * share one implementation.
 */
export function layerAABB(layer: CompositorLayer): AABB {
    const t = layer.transform;
    const cx = t.x + t.width / 2;
    const cy = t.y + t.height / 2;
    const rad = ((t.rotation || 0) * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const hw = t.width / 2;
    const hh = t.height / 2;
    const corners = [
        { x: -hw, y: -hh }, { x: hw, y: -hh },
        { x: hw, y: hh }, { x: -hw, y: hh },
    ];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of corners) {
        const rx = c.x * cos - c.y * sin + cx;
        const ry = c.x * sin + c.y * cos + cy;
        if (rx < minX) minX = rx;
        if (ry < minY) minY = ry;
        if (rx > maxX) maxX = rx;
        if (ry > maxY) maxY = ry;
    }
    return { minX, minY, maxX, maxY };
}

/** Do two AABBs overlap (touching edges count as overlap)? */
export function rectsIntersect(a: AABB, b: AABB): boolean {
    return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/**
 * The opaque base color a compositor should composite its layers against so
 * blend modes (multiply/screen/etc.) have something to act on. Mirrors the
 * video export, which renders onto an opaque black background.
 *
 *   - Opaque configured backgroundColor  -> that color
 *   - Transparent/unset bg + has video   -> '#000000' (matches export)
 *   - Transparent/unset bg + image-only  -> null (keep transparent/checkerboard)
 *
 * Hex alpha is honored: an 8-digit '#RRGGBBAA' with AA === '00' is transparent.
 */
export function resolveCompositeBaseFill(backgroundColor: string | undefined, hasVideo: boolean): string | null {
    const bg = (backgroundColor || '').trim();
    if (bg && bg.toLowerCase() !== 'transparent') {
        const m8 = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})$/.exec(bg);
        if (m8) {
            if (m8[2].toLowerCase() !== '00') return bg; // 8-digit hex, non-zero alpha => opaque-ish
            // fully transparent 8-digit hex => fall through
        } else {
            return bg; // 6-digit hex or any other non-empty, non-'transparent' color => opaque
        }
    }
    return hasVideo ? '#000000' : null;
}
