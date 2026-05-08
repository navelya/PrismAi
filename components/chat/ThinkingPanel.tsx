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
 * Reasoning indicator + collapsible body. Header is clickable in BOTH
 * states (streaming and done) so the user can read live thoughts while
 * the assistant is still thinking.
 *
 * - While streaming: header shows shimmering "Thinking" (no duration yet).
 * - After streaming: header shows "Thought for Xs" with the same chevron.
 * - Body (when expanded) renders the live `thinking` text in either state.
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
        {isStreaming ? (
          <span className="thinking-shimmer inline-block bg-clip-text font-normal tracking-tight text-transparent">
            Thinking
          </span>
        ) : (
          <span className="font-normal tracking-tight">
            Thought for {formatDuration(durationMs)}
          </span>
        )}
      </button>
      <div
        className={`grid overflow-hidden transition-[grid-template-rows] duration-300 ease-out ${
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="mt-2 ml-1 border-l border-zinc-200/30 pl-3 italic leading-7 whitespace-pre-wrap text-xs text-zinc-500 dark:border-zinc-700/25 dark:text-zinc-300/85">
            {thinking || (isStreaming ? '...' : '(no reasoning recorded)')}
          </div>
        </div>
      </div>
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

function formatDuration(ms?: number): string {
  if (!ms || ms < 0) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
