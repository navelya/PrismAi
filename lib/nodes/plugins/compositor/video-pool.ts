'use client';

/**
 * HTMLVideoElement pool keyed by (source URL, poolKey) with cooperative play
 * state.
 *
 * Each top-level consumer (a compositor card + its editor modal share one
 * pool; a downstream blur or compositor each get their own) passes a stable
 * `poolKey` — typically their node id — so different consumer trees decode
 * the same URL into independent <video> elements with independent playheads.
 * Without per-key isolation, every surface seeking the same URL would fight
 * over a single shared `currentTime`, which is exactly what the pull-model
 * architecture is built to avoid.
 *
 * Inside a single pool entry, individual `LayerVideo` instances still vote on
 * play state via `setPlayState`. The element plays if ANY voter wants it
 * playing, pauses if NONE do. Within one compositor's surface this lets the
 * card and the editor modal share an element correctly:
 *
 *   - Card preview paused + modal playing → element plays (modal wins via OR)
 *   - Card preview paused + modal closes → element pauses (no playing voter
 *     remains)
 *   - Lightbox opens with its own autoplay → its consumer votes true; card's
 *     vote is independent. Closing lightbox removes its vote and the element
 *     returns to whatever the card wanted.
 *
 * Elements live off-screen but attached to `document.body` so the browser's
 * media pipeline decodes them. They survive remounts (e.g. modal open/close)
 * so we don't repeatedly warm up the same source.
 */

interface PoolEntry {
    el: HTMLVideoElement;
    /** Consumer id → wantsPlay. Pool plays iff any value is true. */
    consumers: Map<number, boolean>;
    /** Consumer id → wantsAudio. Element is unmuted iff any value is true.
     *  Same OR semantics as `consumers`: any surface unmuting wins for the
     *  shared element. The common case (only one surface visible at a time
     *  for a given poolKey) makes the choice between OR and AND moot. */
    consumerAudio: Map<number, boolean>;
    metadataReady: boolean;
    metaWaiters: Array<(el: HTMLVideoElement) => void>;
}

const pool = new Map<string, PoolEntry>();
let nextConsumerId = 1;

/** Default key used when a caller doesn't supply one. */
const DEFAULT_POOL_KEY = '_global_';

function entryKey(url: string, poolKey: string): string {
    return `${poolKey}|${url}`;
}

function poolKeyOfEntryKey(key: string): string {
    const i = key.indexOf('|');
    return i >= 0 ? key.slice(0, i) : key;
}

// ───────────────────────────────────────────────────────────────────────────
// Frame subscriptions (requestVideoFrameCallback).
//
// A consumer (CompositorAnimator, LayerSubgraph) subscribes with a poolKey
// PREFIX and gets called whenever any pooled element under that prefix
// presents a new video frame. This is what lets the Konva redraw follow the
// decoder's actual cadence instead of a fixed-rate rAF loop: when the decoder
// stalls, no callbacks fire and no paint work happens — the starvation
// feedback loop the old fixed 15fps cap papered over can't occur.
//
// Prefix matching covers the per-layer suffixing convention: LayerVideo and
// GraphRenderCache acquire under `${baseKey}:${layerId}`, so a subscriber for
// `baseKey` matches `baseKey` itself and every `baseKey:*` entry. Entries
// acquired AFTER subscribing attach automatically via the acquire hook.
// ───────────────────────────────────────────────────────────────────────────

interface FrameSub {
    prefix: string;
    cb: () => void;
    /** entryKey → detach fn for the rVFC loop attached on that element. */
    attached: Map<string, () => void>;
}

const frameSubs = new Set<FrameSub>();

function prefixMatches(prefix: string, poolKey: string): boolean {
    return poolKey === prefix || poolKey.startsWith(prefix + ':');
}

function attachRVFC(el: HTMLVideoElement, cb: () => void): () => void {
    const rvfc = (el as any).requestVideoFrameCallback;
    if (typeof rvfc !== 'function') return () => {};
    let cancelled = false;
    let handle = 0;
    const onFrame = () => {
        if (cancelled) return;
        cb();
        handle = (el as any).requestVideoFrameCallback(onFrame);
    };
    handle = (el as any).requestVideoFrameCallback(onFrame);
    return () => {
        cancelled = true;
        try { (el as any).cancelVideoFrameCallback?.(handle); } catch { /* gone */ }
    };
}

function attachSubToEntry(sub: FrameSub, key: string, entry: PoolEntry): void {
    if (sub.attached.has(key)) return;
    if (!prefixMatches(sub.prefix, poolKeyOfEntryKey(key))) return;
    sub.attached.set(key, attachRVFC(entry.el, sub.cb));
}

function detachSubFromEntry(sub: FrameSub, key: string): void {
    const detach = sub.attached.get(key);
    if (detach) {
        detach();
        sub.attached.delete(key);
    }
}

/** Whether this browser supports requestVideoFrameCallback at all. */
export function supportsVideoFrameCallback(): boolean {
    return typeof HTMLVideoElement !== 'undefined' &&
        typeof (HTMLVideoElement.prototype as any).requestVideoFrameCallback === 'function';
}

/**
 * Subscribe to "a pooled video under `poolKeyPrefix` presented a new frame".
 * Fires for current and future entries. Returns an unsubscribe function.
 */
export function subscribeFrames(poolKeyPrefix: string, cb: () => void): () => void {
    const sub: FrameSub = { prefix: poolKeyPrefix, cb, attached: new Map() };
    frameSubs.add(sub);
    pool.forEach((entry, key) => attachSubToEntry(sub, key, entry));
    return () => {
        frameSubs.delete(sub);
        sub.attached.forEach((detach) => detach());
        sub.attached.clear();
    };
}

function makeSafeUrl(url: string): string {
    if (url.startsWith('data:')) return url;
    return url + (url.includes('?') ? '&' : '?') + 'notaint=1';
}

function reconcilePlayState(entry: PoolEntry): void {
    let anyWantsPlay = false;
    entry.consumers.forEach((v) => { if (v) anyWantsPlay = true; });
    if (anyWantsPlay) {
        if (entry.el.paused) {
            entry.el.play().catch(() => {
                // Autoplay may be blocked; element stays paused until the next
                // user gesture re-fires a setPlayState(true).
            });
        }
    } else {
        if (!entry.el.paused) entry.el.pause();
    }
}

function reconcileMuted(entry: PoolEntry): void {
    let anyWantsAudio = false;
    entry.consumerAudio.forEach((v) => { if (v) anyWantsAudio = true; });
    const shouldBeMuted = !anyWantsAudio;
    if (entry.el.muted !== shouldBeMuted) {
        entry.el.muted = shouldBeMuted;
    }
}

/**
 * Acquire a pooled video for a (URL, poolKey) pair. Returns the element AND a
 * consumer id. The caller MUST release with the same (url, poolKey, id) on
 * unmount.
 *
 * Surfaces that should share an element (e.g. a compositor card + its editor
 * modal viewing the same compositor) pass the same poolKey. Surfaces that
 * need independent playback (e.g. a downstream blur or chained compositor)
 * pass their own distinct poolKey so they get a fresh decoder.
 */
export function acquireVideo(
    url: string,
    poolKey: string = DEFAULT_POOL_KEY,
): { el: HTMLVideoElement; id: number } {
    const id = nextConsumerId++;
    const key = entryKey(url, poolKey);
    let entry = pool.get(key);
    if (entry) {
        entry.consumers.set(id, false);
        entry.consumerAudio.set(id, false);
        return { el: entry.el, id };
    }

    const el = document.createElement('video');
    el.crossOrigin = 'anonymous';
    el.muted = true;
    el.playsInline = true;
    el.loop = true;
    el.preload = 'auto';
    entry = {
        el,
        consumers: new Map([[id, false]]),
        consumerAudio: new Map([[id, false]]),
        metadataReady: false,
        metaWaiters: [],
    };
    pool.set(key, entry);

    el.addEventListener('loadedmetadata', () => {
        const e = pool.get(key);
        if (!e) return;
        e.metadataReady = true;
        const waiters = e.metaWaiters;
        e.metaWaiters = [];
        waiters.forEach((cb) => cb(e.el));
    });

    el.style.position = 'fixed';
    el.style.left = '-9999px';
    el.style.top = '-9999px';
    el.style.width = '1px';
    el.style.height = '1px';
    el.style.pointerEvents = 'none';
    el.style.opacity = '0';
    document.body.appendChild(el);

    el.src = makeSafeUrl(url);
    el.load();
    // Element starts paused. Consumers vote into play state via setPlayState.

    // Attach any live frame subscriptions whose prefix covers this entry.
    frameSubs.forEach((sub) => attachSubToEntry(sub, key, entry!));

    return { el, id };
}

/**
 * Subscribe to metadata-ready. Fires immediately if already loaded.
 */
export function onVideoMetadata(
    url: string,
    cb: (el: HTMLVideoElement) => void,
    poolKey: string = DEFAULT_POOL_KEY,
): () => void {
    const key = entryKey(url, poolKey);
    const entry = pool.get(key);
    if (!entry) return () => {};
    if (entry.metadataReady) {
        cb(entry.el);
        return () => {};
    }
    entry.metaWaiters.push(cb);
    return () => {
        const e = pool.get(key);
        if (!e) return;
        const idx = e.metaWaiters.indexOf(cb);
        if (idx >= 0) e.metaWaiters.splice(idx, 1);
    };
}

/**
 * Set this consumer's vote on whether the pooled element should be playing.
 * The pool reconciles by OR-ing all consumer votes.
 */
export function setPlayState(
    url: string,
    id: number,
    wantsPlay: boolean,
    poolKey: string = DEFAULT_POOL_KEY,
): void {
    const entry = pool.get(entryKey(url, poolKey));
    if (!entry) return;
    entry.consumers.set(id, wantsPlay);
    reconcilePlayState(entry);
}

/**
 * Vote on whether the pooled element should emit audio. OR-ed across
 * consumers — element is unmuted iff at least one consumer wants audio.
 * The toggle in MiniTransport / Transport flows through here.
 */
export function setMuted(
    url: string,
    id: number,
    muted: boolean,
    poolKey: string = DEFAULT_POOL_KEY,
): void {
    const entry = pool.get(entryKey(url, poolKey));
    if (!entry) return;
    entry.consumerAudio.set(id, !muted);
    reconcileMuted(entry);
}

export function releaseVideo(
    url: string,
    id: number,
    poolKey: string = DEFAULT_POOL_KEY,
): void {
    const key = entryKey(url, poolKey);
    const entry = pool.get(key);
    if (!entry) return;
    entry.consumers.delete(id);
    entry.consumerAudio.delete(id);
    if (entry.consumers.size === 0) {
        try {
            entry.el.pause();
            entry.el.removeAttribute('src');
            entry.el.load();
        } catch {
            // Element going away — nothing meaningful to recover from.
        }
        entry.el.remove();
        pool.delete(key);
        frameSubs.forEach((sub) => detachSubFromEntry(sub, key));
    } else {
        // Other consumers remain; recompute play state + mute without this voter.
        reconcilePlayState(entry);
        reconcileMuted(entry);
    }
}
