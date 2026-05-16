'use client';

import React, { memo } from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import { formatTimecode } from '../shared';

interface TransportProps {
    playhead: number;
    totalDuration: number;
    fps: number;
    isPlaying: boolean;
    audioMuted: boolean;
    onTogglePlay: () => void;
    onSeek: (t: number) => void;
    onToggleAudioMute: () => void;
}

/**
 * Transport bar mirrors the layout in the user's reference screenshot:
 * step-back / play / step-forward / current-timecode / audio toggle.
 *
 * Step buttons advance one frame at the current fps. We don't show end
 * timecode here — the timeline ruler already conveys total duration.
 */
const Transport = memo(function Transport({
    playhead,
    totalDuration,
    fps,
    isPlaying,
    audioMuted,
    onTogglePlay,
    onSeek,
    onToggleAudioMute,
}: TransportProps) {
    const stepBack = () => {
        const frame = 1 / Math.max(1, fps);
        onSeek(Math.max(0, playhead - frame));
    };
    const stepForward = () => {
        const frame = 1 / Math.max(1, fps);
        onSeek(Math.min(totalDuration, playhead + frame));
    };

    return (
        <div className="flex items-center justify-center gap-2 px-4 py-2 border-b border-white/5 bg-white/[0.02]">
            <button
                onClick={stepBack}
                className="p-1.5 rounded-md text-white/60 hover:text-white hover:bg-white/5 transition-colors"
                title="Step back 1 frame"
            >
                <SkipBack className="w-4 h-4" />
            </button>
            <button
                onClick={onTogglePlay}
                className="p-2 rounded-md bg-accent-primary/20 border border-accent-primary/30 text-accent-primary hover:bg-accent-primary/30 transition-colors"
                title={isPlaying ? 'Pause' : 'Play'}
            >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            <button
                onClick={stepForward}
                className="p-1.5 rounded-md text-white/60 hover:text-white hover:bg-white/5 transition-colors"
                title="Step forward 1 frame"
            >
                <SkipForward className="w-4 h-4" />
            </button>
            <div className="ml-2 px-3 py-1 rounded-md bg-black/40 border border-white/5 font-mono text-xs tabular-nums text-white/80 min-w-[80px] text-center">
                {formatTimecode(playhead, fps)}
            </div>
            <button
                onClick={onToggleAudioMute}
                className="ml-1 p-1.5 rounded-md text-white/60 hover:text-white hover:bg-white/5 transition-colors"
                title={audioMuted ? 'Unmute' : 'Mute'}
            >
                {audioMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
        </div>
    );
});

export default Transport;
