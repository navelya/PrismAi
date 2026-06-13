'use client';

/**
 * Shared playback clock for the compositor surfaces (editor modal + card
 * preview).
 *
 * The clock is the single authority on "what time is it" during playback;
 * media elements CHASE it (seek on activation edges, drift-correct while
 * playing) — never the reverse. This replaces two prior clocks:
 *
 *   - The editor's rAF loop that committed React state (setPlayhead) every
 *     frame, re-rendering the whole 2,000-line modal at ~60fps — the root
 *     cause of choppy playback + laggy dragging in the editor.
 *   - The card's "master video" rVFC clock, which acquired its element under
 *     the plain poolKey while LayerVideo pools per-layer (`poolKey:layerId`),
 *     so the master element never played, rVFC never re-fired, and the card
 *     playhead froze whenever a video layer existed. It also derived time as
 *     mediaTime + startTime (ignoring trimIn) and wrapped inside the master
 *     clip's own loop, so multi-clip timelines could never advance past clip 1.
 *
 * Time advances in a plain ref via rAF while playing; React only sees commits
 * at ~10Hz (plus immediately on wrap/seek/pause so UI never sticks stale).
 * Per-frame consumers — the timeline playhead line, Konva activity gating,
 * video drift correction — subscribe directly and are called once per rAF
 * tick with (time, dt).
 */

import { useEffect, useMemo, useRef } from 'react';

export interface TransportClock {
    /** Current playhead in seconds (continuous, not the 10Hz React value). */
    getTime(): number;
    isPlaying(): boolean;
    /** Total timeline duration used for wrap. */
    getDuration(): number;
    play(): void;
    pause(): void;
    /** Jump the clock. Commits to React immediately and notifies subscribers. */
    seek(t: number): void;
    /**
     * Per-rAF-tick subscription while playing (also fired once on seek so
     * paused consumers can react). Returns an unsubscribe function.
     */
    subscribe(cb: (t: number, dt: number) => void): () => void;
}

interface ClockOptions {
    /**
     * React commit sink — called at ~COMMIT_MS cadence while playing, and
     * immediately on wrap/seek/pause. Typically `setPlayhead`.
     */
    onCommit: (t: number) => void;
}

const COMMIT_MS = 100;

export function createTransportClock(opts: ClockOptions): TransportClock & {
    setDuration(d: number): void;
    dispose(): void;
} {
    let time = 0;
    let duration = 0;
    let playing = false;
    let raf: number | null = null;
    const subscribers = new Set<(t: number, dt: number) => void>();

    let lastTick = 0;
    let lastCommit = 0;

    const notify = (dt: number) => {
        subscribers.forEach((cb) => {
            try { cb(time, dt); } catch { /* one bad subscriber must not stall the clock */ }
        });
    };

    const tick = (now: number) => {
        if (!playing) { raf = null; return; }
        const dt = (now - lastTick) / 1000;
        lastTick = now;
        time += dt;
        let wrapped = false;
        if (duration > 0 && time >= duration) {
            time = 0;
            wrapped = true;
        }
        notify(dt);
        if (wrapped || now - lastCommit >= COMMIT_MS) {
            lastCommit = now;
            opts.onCommit(time);
        }
        raf = requestAnimationFrame(tick);
    };

    return {
        getTime: () => time,
        isPlaying: () => playing,
        getDuration: () => duration,
        setDuration(d: number) {
            duration = Math.max(0, d);
            if (duration > 0 && time > duration) time = 0;
        },
        play() {
            if (playing) return;
            playing = true;
            lastTick = performance.now();
            lastCommit = lastTick;
            if (raf === null) raf = requestAnimationFrame(tick);
        },
        pause() {
            if (!playing) return;
            playing = false;
            if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
            // Commit the exact final position so the paused UI (and the
            // LayerVideo seek-on-pause effect) lands where playback stopped.
            opts.onCommit(time);
        },
        seek(t: number) {
            time = Math.max(0, duration > 0 ? Math.min(t, duration) : t);
            // Subscribers see dt=0 — a seek, not natural advancement.
            notify(0);
            opts.onCommit(time);
        },
        subscribe(cb) {
            subscribers.add(cb);
            return () => { subscribers.delete(cb); };
        },
        dispose() {
            playing = false;
            if (raf !== null) { cancelAnimationFrame(raf); raf = null; }
            subscribers.clear();
        },
    };
}

/**
 * React wrapper. Returns a stable clock instance for the component's
 * lifetime; keeps duration in sync and tears the rAF down on unmount.
 *
 * `onCommit` is read through a ref so callers can pass an inline setter.
 */
export function useTransportClock(totalDuration: number, onCommit: (t: number) => void) {
    const onCommitRef = useRef(onCommit);
    onCommitRef.current = onCommit;

    const clock = useMemo(
        () => createTransportClock({ onCommit: (t) => onCommitRef.current(t) }),
        [],
    );

    useEffect(() => {
        clock.setDuration(totalDuration);
    }, [clock, totalDuration]);

    useEffect(() => () => clock.dispose(), [clock]);

    return clock;
}
