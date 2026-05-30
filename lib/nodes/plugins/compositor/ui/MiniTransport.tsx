'use client';

import React, { memo, useCallback, useEffect, useRef } from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import { formatTimecode } from '../shared';

interface MiniTransportProps {
    playhead: number;
    totalDuration: number;
    fps: number;
    isPlaying: boolean;
    muted: boolean;
    onTogglePlay: () => void;
    onSeek: (t: number) => void;
    onToggleMute: () => void;
    /**
     * Optional absolute-frame readout shown inline next to the timecode.
     * Shared between the compositor card and the extract_frame node so both
     * present the same "[timecode] frame N / total" display.
     */
    frameNumber?: number;
    totalFrames?: number;
}

/**
 * Compact transport bar for the compositor card preview.
 *
 * Layout: [scrub track full width] / [timecode] [« play »] [mute]
 *
 * Visual language: glassmorphism — matches the surrounding canvas card
 * chrome (slight white tint on white/5, subtle borders). The modal's full
 * `<Transport>` is the maximalist counterpart with more affordances and
 * tools; this one is built for "at-a-glance preview" inside a 320px-wide
 * node card.
 */
const MiniTransport = memo(function MiniTransport({
    playhead,
    totalDuration,
    fps,
    isPlaying,
    muted,
    onTogglePlay,
    onSeek,
    onToggleMute,
    frameNumber,
    totalFrames,
}: MiniTransportProps) {
    const trackRef = useRef<HTMLDivElement>(null);
    const draggingRef = useRef(false);

    // Scrub coalescing: pointermove can fire faster than the display refresh.
    // We buffer the latest X and flush exactly one onSeek per animation frame.
    const pendingXRef = useRef<number | null>(null);
    const rafRef = useRef<number | null>(null);

    const flushSeek = useCallback(() => {
        rafRef.current = null;
        const clientX = pendingXRef.current;
        pendingXRef.current = null;
        if (clientX === null) return;
        const el = trackRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
        onSeek(ratio * totalDuration);
    }, [onSeek, totalDuration]);

    const scheduleSeek = useCallback((clientX: number) => {
        pendingXRef.current = clientX;
        if (rafRef.current === null) {
            rafRef.current = requestAnimationFrame(flushSeek);
        }
    }, [flushSeek]);

    const onPointerDown = useCallback((e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        draggingRef.current = true;
        scheduleSeek(e.clientX);
    }, [scheduleSeek]);

    useEffect(() => {
        const onMoveEvt = (e: PointerEvent) => {
            if (!draggingRef.current) return;
            e.preventDefault();
            scheduleSeek(e.clientX);
        };
        const onUp = () => {
            draggingRef.current = false;
            // Cancel any frame still queued so it can't fire on an unmounted
            // component; we commit the final position synchronously instead.
            if (rafRef.current !== null) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
            }
            // Make sure the final pointer position is committed even if it
            // arrived between frames.
            if (pendingXRef.current !== null) flushSeek();
        };
        window.addEventListener('pointermove', onMoveEvt);
        window.addEventListener('pointerup', onUp);
        return () => {
            window.removeEventListener('pointermove', onMoveEvt);
            window.removeEventListener('pointerup', onUp);
            if (rafRef.current !== null) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
            }
        };
    }, [scheduleSeek, flushSeek]);

    const progress = totalDuration > 0 ? (playhead / totalDuration) * 100 : 0;

    const stepBack = (e: React.MouseEvent) => {
        e.stopPropagation();
        const frame = 1 / Math.max(1, fps);
        onSeek(Math.max(0, playhead - frame));
    };
    const stepForward = (e: React.MouseEvent) => {
        e.stopPropagation();
        const frame = 1 / Math.max(1, fps);
        onSeek(Math.min(totalDuration, playhead + frame));
    };

    return (
        <div
            className="w-full px-2 pt-1.5 pb-2 select-none"
            // Stop ALL clicks from propagating — without this, hitting play
            // would trigger the card's `onClick` lightbox opener.
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
        >
            {/* Scrub track */}
            <div
                ref={trackRef}
                onPointerDown={onPointerDown}
                className="relative h-1 rounded-full bg-white/10 cursor-pointer mb-1.5"
            >
                <div
                    className="absolute top-0 left-0 h-full rounded-full bg-accent-primary"
                    style={{ width: `${progress}%` }}
                />
                <div
                    className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-accent-primary shadow-md"
                    style={{ left: `calc(${progress}% - 4px)` }}
                />
            </div>

            {/* Controls row. Both side groups are flex-1 so the play controls
                stay pinned to the true center of the card width regardless of how
                wide the timecode (left) or frame+mute (right) groups get. */}
            <div className="flex items-center gap-2">
                {/* Left: timecode */}
                <div className="flex-1 flex items-center min-w-0">
                    <span className="font-mono text-[9px] tabular-nums text-white/60 whitespace-nowrap">
                        {formatTimecode(playhead, fps)}
                    </span>
                </div>

                {/* Center: transport — centered in the node width */}
                <div className="flex items-center gap-0.5 shrink-0">
                    <button
                        onClick={stepBack}
                        className="p-1 rounded text-white/50 hover:text-white hover:bg-white/5 transition-colors"
                        title="Step back 1 frame"
                    >
                        <SkipBack className="w-3 h-3" />
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); onTogglePlay(); }}
                        className="p-1 rounded text-white/80 hover:text-white hover:bg-white/10 transition-colors"
                        title={isPlaying ? 'Pause' : 'Play'}
                    >
                        {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    </button>
                    <button
                        onClick={stepForward}
                        className="p-1 rounded text-white/50 hover:text-white hover:bg-white/5 transition-colors"
                        title="Step forward 1 frame"
                    >
                        <SkipForward className="w-3 h-3" />
                    </button>
                </div>

                {/* Right: frame readout (sits between play and mute) + mute */}
                <div className="flex-1 flex items-center justify-end gap-1.5 min-w-0">
                    {typeof frameNumber === 'number' && (
                        <span className="font-mono text-[9px] tabular-nums text-accent-primary/70 whitespace-nowrap">
                            frame {frameNumber}{totalFrames && totalFrames > 0 ? ` / ${totalFrames}` : ''}
                        </span>
                    )}
                    <button
                        onClick={(e) => { e.stopPropagation(); onToggleMute(); }}
                        className="p-1 rounded text-white/50 hover:text-white hover:bg-white/5 transition-colors shrink-0"
                        title={muted ? 'Unmute' : 'Mute'}
                    >
                        {muted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
                    </button>
                </div>
            </div>
        </div>
    );
});

export default MiniTransport;
