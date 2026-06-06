'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Play, Pause } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Minimal dark audio player that blends into the app's surfaces instead of the
 * browser's native (white) `<audio controls>` chrome.
 *
 * Layout: [play/pause] [current] [scrub track] [duration]
 *
 * Drives a hidden `<audio>` element imperatively. Click/drag the track to seek.
 */
function fmt(seconds: number): string {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}

export default function AudioPlayer({
    src,
    className,
}: {
    src: string;
    className?: string;
}) {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const trackRef = useRef<HTMLDivElement>(null);
    const [playing, setPlaying] = useState(false);
    const [current, setCurrent] = useState(0);
    const [duration, setDuration] = useState(0);

    // Reset transport state when the source changes (new generation).
    useEffect(() => {
        setPlaying(false);
        setCurrent(0);
        setDuration(0);
    }, [src]);

    useEffect(() => {
        const a = audioRef.current;
        if (!a) return;
        const onMeta = () => setDuration(a.duration || 0);
        const onTime = () => setCurrent(a.currentTime || 0);
        const onEnd = () => { setPlaying(false); setCurrent(0); };
        const onPlay = () => setPlaying(true);
        const onPause = () => setPlaying(false);
        a.addEventListener('loadedmetadata', onMeta);
        a.addEventListener('timeupdate', onTime);
        a.addEventListener('ended', onEnd);
        a.addEventListener('play', onPlay);
        a.addEventListener('pause', onPause);
        if (a.readyState >= 1) onMeta();
        return () => {
            a.removeEventListener('loadedmetadata', onMeta);
            a.removeEventListener('timeupdate', onTime);
            a.removeEventListener('ended', onEnd);
            a.removeEventListener('play', onPlay);
            a.removeEventListener('pause', onPause);
        };
    }, [src]);

    const toggle = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        const a = audioRef.current;
        if (!a) return;
        if (a.paused) a.play().catch(() => {});
        else a.pause();
    }, []);

    const seekToClientX = useCallback((clientX: number) => {
        const el = trackRef.current;
        const a = audioRef.current;
        if (!el || !a || !duration) return;
        const rect = el.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
        try { a.currentTime = ratio * duration; } catch { /* not ready */ }
        setCurrent(ratio * duration);
    }, [duration]);

    const onTrackPointerDown = useCallback((e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        seekToClientX(e.clientX);
        const onMove = (ev: PointerEvent) => seekToClientX(ev.clientX);
        const onUp = () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
    }, [seekToClientX]);

    const progress = duration > 0 ? (current / duration) * 100 : 0;

    return (
        <div
            className={cn('flex items-center gap-3 w-full select-none', className)}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
        >
            <audio ref={audioRef} src={src} preload="metadata" crossOrigin="anonymous" className="hidden" />

            <button
                type="button"
                onClick={toggle}
                className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-content-secondary hover:text-content-primary hover:bg-white/5 transition-colors"
                title={playing ? 'Pause' : 'Play'}
            >
                {playing
                    ? <Pause className="w-4 h-4 fill-current" />
                    : <Play className="w-4 h-4 fill-current translate-x-[1px]" />}
            </button>

            <span className="font-mono text-xs tabular-nums text-content-secondary shrink-0">
                {fmt(current)}
            </span>

            <div
                ref={trackRef}
                onPointerDown={onTrackPointerDown}
                className="relative flex-1 h-1 rounded-full bg-white/15 cursor-pointer"
            >
                <div
                    className="absolute top-0 left-0 h-full rounded-full bg-accent-primary"
                    style={{ width: `${progress}%` }}
                />
                <div
                    className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-accent-primary shadow-md"
                    style={{ left: `calc(${progress}% - 5px)` }}
                />
            </div>

            <span className="font-mono text-xs tabular-nums text-content-tertiary shrink-0">
                {fmt(duration)}
            </span>
        </div>
    );
}
