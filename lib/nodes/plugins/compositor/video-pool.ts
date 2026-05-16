'use client';

/**
 * Shared HTMLVideoElement pool keyed by source URL with cooperative play state.
 *
 * Each consumer (one `LayerVideo` instance) acquires the element by URL and
 * receives a unique numeric `id`. Consumers vote on play state via
 * `setPlayState(url, id, wantsPlay)`. The pool plays the element if ANY
 * consumer wants it playing, pauses it if NONE do. This means:
 *
 *   - Card preview paused + modal playing → element plays (modal wins via OR)
 *   - Card preview paused + modal closes → element pauses (no playing voter
 *     remains). This fixes the bug where closing the modal mid-play left the
 *     card's preview running in the background.
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
    metadataReady: boolean;
    metaWaiters: Array<(el: HTMLVideoElement) => void>;
}

const pool = new Map<string, PoolEntry>();
let nextConsumerId = 1;

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

/**
 * Acquire a pooled video for a URL. Returns the element AND a consumer id.
 * The caller MUST release with the same id on unmount.
 */
export function acquireVideo(url: string): { el: HTMLVideoElement; id: number } {
    const id = nextConsumerId++;
    let entry = pool.get(url);
    if (entry) {
        entry.consumers.set(id, false);
        return { el: entry.el, id };
    }

    const el = document.createElement('video');
    el.crossOrigin = 'anonymous';
    el.muted = true;
    el.playsInline = true;
    el.loop = true;
    el.preload = 'auto';
    el.style.position = 'fixed';
    el.style.left = '-9999px';
    el.style.top = '-9999px';
    el.style.width = '1px';
    el.style.height = '1px';
    el.style.pointerEvents = 'none';
    el.style.opacity = '0';
    document.body.appendChild(el);

    entry = {
        el,
        consumers: new Map([[id, false]]),
        metadataReady: false,
        metaWaiters: [],
    };
    pool.set(url, entry);

    el.addEventListener('loadedmetadata', () => {
        const e = pool.get(url);
        if (!e) return;
        e.metadataReady = true;
        const waiters = e.metaWaiters;
        e.metaWaiters = [];
        waiters.forEach((cb) => cb(e.el));
    });

    el.src = makeSafeUrl(url);
    el.load();
    // Element starts paused. Consumers vote into play state via setPlayState.

    return { el, id };
}

/**
 * Subscribe to metadata-ready. Fires immediately if already loaded.
 */
export function onVideoMetadata(
    url: string,
    cb: (el: HTMLVideoElement) => void,
): () => void {
    const entry = pool.get(url);
    if (!entry) return () => {};
    if (entry.metadataReady) {
        cb(entry.el);
        return () => {};
    }
    entry.metaWaiters.push(cb);
    return () => {
        const e = pool.get(url);
        if (!e) return;
        const idx = e.metaWaiters.indexOf(cb);
        if (idx >= 0) e.metaWaiters.splice(idx, 1);
    };
}

/**
 * Set this consumer's vote on whether the pooled element should be playing.
 * The pool reconciles by OR-ing all consumer votes.
 */
export function setPlayState(url: string, id: number, wantsPlay: boolean): void {
    const entry = pool.get(url);
    if (!entry) return;
    entry.consumers.set(id, wantsPlay);
    reconcilePlayState(entry);
}

export function releaseVideo(url: string, id: number): void {
    const entry = pool.get(url);
    if (!entry) return;
    entry.consumers.delete(id);
    if (entry.consumers.size === 0) {
        try {
            entry.el.pause();
            entry.el.removeAttribute('src');
            entry.el.load();
        } catch {
            // Element going away — nothing meaningful to recover from.
        }
        entry.el.remove();
        pool.delete(url);
    } else {
        // Other consumers remain; recompute play state without this voter.
        reconcilePlayState(entry);
    }
}
