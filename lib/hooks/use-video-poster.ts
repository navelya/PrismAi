'use client';

import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Module-level cache: URL → resolved poster data URL.
 *
 * In-memory only (lost on reload). At ~10KB per WebP poster, holding a few
 * hundred entries is well under any practical memory ceiling. Persisting to
 * localStorage isn't worth the complexity — re-extraction on cold start costs
 * ~200ms per asset spread over a queue, not noticeable.
 */
const posterCache = new Map<string, string>();

/**
 * URL → in-flight promise. De-duplicates concurrent requests for the same
 * source so two cards mounting the same asset don't both spin up extractors.
 */
const inflight = new Map<string, Promise<string | null>>();

/**
 * Concurrency-limited extraction queue. The whole point of the poster cache
 * is to STOP exhausting the browser's video-decoder pool, so we must not
 * recreate that pressure by extracting 16 posters in parallel. 2 in flight
 * keeps decode pressure tiny while still feeling responsive.
 */
const MAX_CONCURRENT_EXTRACTIONS = 2;
let runningExtractions = 0;
const waiters: Array<() => void> = [];

function acquireSlot(): Promise<void> {
    if (runningExtractions < MAX_CONCURRENT_EXTRACTIONS) {
        runningExtractions++;
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        waiters.push(() => {
            runningExtractions++;
            resolve();
        });
    });
}

function releaseSlot(): void {
    runningExtractions--;
    const next = waiters.shift();
    if (next) next();
}

const EXTRACTION_TIMEOUT_MS = 8000;
const POSTER_MAX_DIM = 320;

/**
 * Append `?notaint=1` (matching the cache-busting pattern used elsewhere) so
 * the request is cacheable independently from a normal display fetch and the
 * crossOrigin handshake works against Supabase storage without taint.
 */
function safeUrl(url: string): string {
    if (url.startsWith('data:') || url.startsWith('blob:')) return url;
    return url + (url.includes('?') ? '&' : '?') + 'notaint=1';
}

/**
 * One-shot poster extraction: spin up a hidden <video>, decode frame 0,
 * snapshot to a small WebP data URL, tear everything down so the decoder
 * slot is released immediately.
 *
 * Uses preload="auto" because Replicate's MP4 outputs aren't +faststart
 * muxed — preload="metadata" would stop before finding the moov atom and
 * neither loadedmetadata nor seeked would ever fire (see the comment in
 * AssetsPanel.tsx that documents this exact landmine).
 */
function extractPoster(url: string): Promise<string | null> {
    return new Promise((resolve) => {
        const video = document.createElement('video');
        video.crossOrigin = 'anonymous';
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';
        video.style.position = 'fixed';
        video.style.left = '-9999px';
        video.style.top = '-9999px';
        video.style.width = '1px';
        video.style.height = '1px';
        video.style.opacity = '0';
        video.style.pointerEvents = 'none';

        let settled = false;
        const finish = (val: string | null) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try {
                video.pause();
                video.removeAttribute('src');
                video.load();
            } catch { /* element going away */ }
            try { video.remove(); } catch { /* noop */ }
            resolve(val);
        };

        const timer = setTimeout(() => finish(null), EXTRACTION_TIMEOUT_MS);

        const grab = () => {
            try {
                const vw = video.videoWidth || 0;
                const vh = video.videoHeight || 0;
                if (!vw || !vh) return finish(null);
                const scale = Math.min(1, POSTER_MAX_DIM / Math.max(vw, vh));
                const canvas = document.createElement('canvas');
                canvas.width = Math.max(1, Math.round(vw * scale));
                canvas.height = Math.max(1, Math.round(vh * scale));
                const ctx = canvas.getContext('2d');
                if (!ctx) return finish(null);
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                finish(canvas.toDataURL('image/webp', 0.75));
            } catch (e) {
                console.error('[useVideoPoster] snapshot failed:', e);
                finish(null);
            }
        };

        // loadeddata fires once enough data exists to render at currentTime.
        // For preload=auto on a freshly-attached element that's typically the
        // first decoded frame.
        video.addEventListener('loadeddata', grab, { once: true });
        video.addEventListener('error', () => finish(null), { once: true });

        document.body.appendChild(video);
        video.src = safeUrl(url);
        video.load();
    });
}

async function requestPoster(url: string): Promise<string | null> {
    const cached = posterCache.get(url);
    if (cached) return cached;
    const existing = inflight.get(url);
    if (existing) return existing;

    const promise = (async () => {
        await acquireSlot();
        try {
            const dataUrl = await extractPoster(url);
            if (dataUrl) posterCache.set(url, dataUrl);
            return dataUrl;
        } finally {
            releaseSlot();
            inflight.delete(url);
        }
    })();

    inflight.set(url, promise);
    return promise;
}

/**
 * Hook: returns a cached poster data URL for `url`, extracting it lazily on
 * first visibility (via IntersectionObserver on the returned ref). Subsequent
 * mounts of the same URL get the cached poster immediately.
 *
 * The whole purpose is to STOP the asset panel from keeping 16 simultaneous
 * <video preload="auto"> decoders alive. Render the returned posterUrl as an
 * <img>; mount a real <video> only on hover/click.
 */
export function useVideoPoster(url: string | null): {
    posterUrl: string | null;
    setNode: (el: HTMLElement | null) => void;
} {
    const [posterUrl, setPosterUrl] = useState<string | null>(
        url ? posterCache.get(url) ?? null : null,
    );
    const nodeRef = useRef<HTMLElement | null>(null);
    const observerRef = useRef<IntersectionObserver | null>(null);
    const startedRef = useRef(false);

    // Cache-hit fast path on url change without re-running the observer setup.
    useEffect(() => {
        if (!url) {
            setPosterUrl(null);
            startedRef.current = false;
            return;
        }
        const cached = posterCache.get(url);
        if (cached) {
            setPosterUrl(cached);
            startedRef.current = true;
        } else {
            setPosterUrl(null);
            startedRef.current = false;
        }
    }, [url]);

    const setNode = useCallback((el: HTMLElement | null) => {
        nodeRef.current = el;
        if (observerRef.current) {
            observerRef.current.disconnect();
            observerRef.current = null;
        }
        if (!el || !url || startedRef.current) return;
        if (posterCache.has(url)) {
            setPosterUrl(posterCache.get(url) ?? null);
            startedRef.current = true;
            return;
        }
        // Defensive: SSR / non-DOM environments shouldn't create observers.
        if (typeof IntersectionObserver === 'undefined') {
            startedRef.current = true;
            requestPoster(url).then((p) => { if (p) setPosterUrl(p); });
            return;
        }
        const obs = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (entry.isIntersecting && !startedRef.current) {
                    startedRef.current = true;
                    obs.disconnect();
                    requestPoster(url).then((p) => { if (p) setPosterUrl(p); });
                    break;
                }
            }
        }, { rootMargin: '200px' });
        obs.observe(el);
        observerRef.current = obs;
    }, [url]);

    useEffect(() => () => {
        if (observerRef.current) observerRef.current.disconnect();
    }, []);

    return { posterUrl, setNode };
}
