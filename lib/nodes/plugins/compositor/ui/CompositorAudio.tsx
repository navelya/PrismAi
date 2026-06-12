'use client';

/**
 * Headless audio playback for the Compositor.
 *
 * Audio layers have no visual, so they can't live inside the Konva <Stage>
 * (react-konva only accepts Konva nodes as children of a <Layer>). Instead this
 * component renders `null` and drives one `HTMLAudioElement` per audio layer
 * imperatively, synced to the surface's playhead / play / mute state. Mount it
 * as a SIBLING of the Stage in both the card preview and the editor modal.
 *
 * It also reports each clip's intrinsic duration back via `onAudioLoad` so the
 * parent's `computeTimelineDuration` fills the timeline to the audio's real
 * length (audio is treated like video for duration purposes — see shared.ts).
 *
 * Playback model: the surface owns the playhead (a wall-clock rAF loop for
 * audio-only compositions, or the video master clock when a video is present).
 * Each track follows that playhead — it plays while active + isPlaying, seeks
 * to layer-local time on a scrub (or while paused), and stays muted outside its
 * [startTime, startTime + duration] window so a clip's audio never leaks past
 * its visible range.
 */

import { memo, useEffect, useRef } from 'react';
import { CompositorLayer } from '../definition';
import { detectSourceKindFromUrl, isLayerActiveAt } from '../shared';
import { RenderableLayer } from './Renderer';

function safeAudioUrl(url: string): string {
    if (url.startsWith('data:')) return url;
    return url + (url.includes('?') ? '&' : '?') + 'notaint=1';
}

/** How far the element may drift from the target time before we re-seek (s). */
const SEEK_THRESHOLD_SEC = 0.3;

const AudioTrack = memo(function AudioTrack({
    layer,
    url,
    playhead,
    isPlaying,
    muted,
    intrinsicDuration,
    onLoad,
}: {
    layer: CompositorLayer;
    url: string;
    playhead: number;
    isPlaying: boolean;
    muted: boolean;
    intrinsicDuration: number | null;
    onLoad?: (duration: number) => void;
}) {
    const elRef = useRef<HTMLAudioElement | null>(null);
    if (!elRef.current && typeof document !== 'undefined') {
        const a = document.createElement('audio');
        a.crossOrigin = 'anonymous';
        a.preload = 'auto';
        a.src = safeAudioUrl(url);
        // Attach off-screen to document.body (mirrors video-pool.ts). A fully
        // detached HTMLMediaElement gets throttled/suspended by the browser
        // when its owner isn't the foreground document — which is why audio
        // played in the editor modal (a foreground portal) but stayed silent
        // on the background canvas card. Attaching keeps the media pipeline
        // alive on both surfaces.
        a.style.position = 'fixed';
        a.style.left = '-9999px';
        a.style.top = '-9999px';
        a.style.width = '1px';
        a.style.height = '1px';
        a.style.pointerEvents = 'none';
        a.style.opacity = '0';
        document.body.appendChild(a);
        elRef.current = a;
    }

    // Keep onLoad in a ref so the metadata subscription isn't re-bound when the
    // parent hands a fresh callback per render.
    const onLoadRef = useRef(onLoad);
    onLoadRef.current = onLoad;

    // Recreate the element if the URL changes (new generation wired in).
    useEffect(() => {
        const a = elRef.current;
        if (!a) return;
        const next = safeAudioUrl(url);
        if (a.src !== next) {
            a.src = next;
            a.load();
        }
    }, [url]);

    // Report intrinsic duration once metadata is available.
    useEffect(() => {
        const a = elRef.current;
        if (!a) return;
        const report = () => {
            if (a.duration && isFinite(a.duration)) onLoadRef.current?.(a.duration);
        };
        if (a.readyState >= 1) report();
        a.addEventListener('loadedmetadata', report);
        return () => {
            a.removeEventListener('loadedmetadata', report);
        };
    }, [url]);

    // Pause + remove the off-screen element on unmount so a closed editor (or
    // removed layer) doesn't keep audio playing in the background.
    useEffect(() => {
        return () => {
            const a = elRef.current;
            if (!a) return;
            try {
                a.pause();
                a.removeAttribute('src');
                a.load();
                a.remove();
            } catch {
                /* element going away */
            }
        };
    }, []);

    const start = Math.max(0, layer.startTime || 0);
    const trimIn = Math.max(0, layer.trimIn || 0);
    const local = playhead - start;
    // Active window is timeline-space (folds in visible + start + duration/
    // intrinsic, with trimIn subtracted from the intrinsic fallback). `trimIn`
    // shifts only the SOURCE seek (target below), never this gate.
    const active = isLayerActiveAt(layer, 'audio', intrinsicDuration ?? null, playhead);
    // Mute outside the active window so a clip can't leak sound when the
    // playhead is parked before/after it.
    const effectiveMuted = muted || !active;

    // Drive play/pause/seek to follow the surface playhead.
    useEffect(() => {
        const a = elRef.current;
        if (!a) return;
        a.muted = effectiveMuted;

        const target = Math.max(0, local) + trimIn;
        if (isPlaying && active) {
            if (Math.abs(a.currentTime - target) > SEEK_THRESHOLD_SEC) {
                try { a.currentTime = target; } catch { /* not ready */ }
            }
            if (a.paused) a.play().catch(() => { /* autoplay blocked until gesture */ });
        } else {
            if (!a.paused) a.pause();
            // Keep a paused element parked at the scrub position so unmuting +
            // pressing play resumes from the right spot.
            if (active && Math.abs(a.currentTime - target) > 0.05) {
                try { a.currentTime = target; } catch { /* not ready */ }
            }
        }
    }, [isPlaying, active, local, effectiveMuted, trimIn]);

    return null;
});

/**
 * Manage the audio tracks for every audio layer in `layers`. Renders nothing.
 */
const CompositorAudio = memo(function CompositorAudio({
    layers,
    playhead,
    isPlaying,
    muted = true,
    intrinsicDurations,
    onAudioLoad,
}: {
    layers: RenderableLayer[];
    playhead: number;
    isPlaying: boolean;
    muted?: boolean;
    intrinsicDurations?: Record<string, number | null>;
    onAudioLoad?: (layerId: string, duration: number) => void;
}) {
    return (
        <>
            {layers.map(({ layer, resolved }) => {
                const url =
                    resolved && typeof resolved === 'object' && typeof (resolved as any).url === 'string'
                        ? ((resolved as any).url as string)
                        : null;
                if (!url || detectSourceKindFromUrl(url) !== 'audio') return null;
                return (
                    <AudioTrack
                        key={layer.id}
                        layer={layer}
                        url={url}
                        playhead={playhead}
                        isPlaying={isPlaying}
                        muted={muted || !!layer.muted}
                        intrinsicDuration={intrinsicDurations?.[layer.id] ?? null}
                        onLoad={onAudioLoad ? (d) => onAudioLoad(layer.id, d) : undefined}
                    />
                );
            })}
        </>
    );
});

export default CompositorAudio;
