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
 * Minimalist collapsible reasoning display, modeled on Claude.ai's
 * "thinking" chip. Hidden until thinking exceeds 100 chars OR 500ms —
 * prevents flicker for trivial turns.
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

  const headerLabel = isStreaming
    ? 'Thinking'
    : `Thought for ${formatDuration(durationMs)}`;

  return (
    <div className="my-1.5 text-sm">
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="group inline-flex items-center gap-1.5 text-zinc-500 transition-colors hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200"
        aria-expanded={expanded}
      >
        <ChevronRight
          size={14}
          className={`transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}
        />
        <span className="font-normal">{headerLabel}</span>
        {isStreaming && (
          <span className="ml-1 inline-flex items-center gap-0.5">
            <span className="size-1 animate-pulse rounded-full bg-current opacity-60 [animation-delay:0ms]" />
            <span className="size-1 animate-pulse rounded-full bg-current opacity-60 [animation-delay:150ms]" />
            <span className="size-1 animate-pulse rounded-full bg-current opacity-60 [animation-delay:300ms]" />
          </span>
        )}
      </button>
      <div
        className={`grid overflow-hidden transition-[grid-template-rows] duration-200 ease-out ${
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="mt-2 ml-2 border-l-2 border-zinc-200 pl-3 italic whitespace-pre-wrap leading-relaxed text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
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
