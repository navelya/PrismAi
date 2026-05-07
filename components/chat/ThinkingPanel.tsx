'use client';

import { useEffect, useState } from 'react';
import { ChevronRight } from 'lucide-react';

const VISIBILITY_CHAR_THRESHOLD = 100;
const VISIBILITY_TIME_THRESHOLD_MS = 500;

export interface ThinkingPanelProps {
  /** Streaming or persisted reasoning text. Empty string means no thinking happened. */
  thinking: string;
  /** True while the assistant is still thinking on this turn. */
  isStreaming: boolean;
  /** ms — durations under threshold suppress the panel entirely. */
  durationMs?: number;
}

/**
 * Minimalist reasoning indicator. While streaming: a "Thinking" title
 * with a delicate shimmer sweep across the text (premium feel). After
 * streaming: a small chevron + "Thought for Xs" affordance that expands
 * to show the persisted reasoning in a quote-block-style indent.
 *
 * Three-dot loaders are intentionally NOT used here — they belong in
 * the loading-skeleton state (between sending and stream start).
 */
export function ThinkingPanel({ thinking, isStreaming, durationMs }: ThinkingPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [crossedThreshold, setCrossedThreshold] = useState(false);

  useEffect(() => {
    if (!isStreaming) {
      setCrossedThreshold(thinking.length >= VISIBILITY_CHAR_THRESHOLD);
      return;
    }
    if (thinking.length >= VISIBILITY_CHAR_THRESHOLD) {
      setCrossedThreshold(true);
      return;
    }
    const t = setTimeout(() => setCrossedThreshold(true), VISIBILITY_TIME_THRESHOLD_MS);
    return () => clearTimeout(t);
  }, [thinking, isStreaming]);

  if (!crossedThreshold) return null;

  if (isStreaming) {
    // Shimmering "Thinking" title — gradient sweeps across the text.
    return (
      <div className="my-1 text-xs">
        <span className="thinking-shimmer inline-block bg-clip-text font-normal tracking-tight text-transparent">
          Thinking
        </span>
        <style jsx>{`
          .thinking-shimmer {
            background-image: linear-gradient(
              90deg,
              rgb(161, 161, 170) 0%,
              rgb(212, 212, 216) 50%,
              rgb(161, 161, 170) 100%
            );
            background-size: 200% 100%;
            animation: shimmer-sweep 1.6s ease-in-out infinite;
          }
          :global(.dark) .thinking-shimmer {
            background-image: linear-gradient(
              90deg,
              rgb(113, 113, 122) 0%,
              rgb(228, 228, 231) 50%,
              rgb(113, 113, 122) 100%
            );
            background-size: 200% 100%;
          }
          @keyframes shimmer-sweep {
            0% { background-position: 200% 0; }
            100% { background-position: -200% 0; }
          }
        `}</style>
      </div>
    );
  }

  // Done thinking: minimal chevron + "Thought for Xs" label, expandable.
  return (
    <div className="my-1 text-xs">
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="group inline-flex items-center gap-1 text-zinc-500 transition-colors hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        aria-expanded={expanded}
      >
        <ChevronRight
          size={12}
          className={`transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
        />
        <span className="font-normal tracking-tight">Thought for {formatDuration(durationMs)}</span>
      </button>
      <div
        className={`grid overflow-hidden transition-[grid-template-rows] duration-300 ease-out ${
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="mt-2 ml-1 border-l border-zinc-200/50 pl-3 italic leading-relaxed whitespace-pre-wrap text-xs text-zinc-500/90 dark:border-zinc-700/40 dark:text-zinc-400/90">
            {thinking || '(no reasoning recorded)'}
          </div>
        </div>
      </div>
    </div>
  );
}

function formatDuration(ms?: number): string {
  if (!ms || ms < 0) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
