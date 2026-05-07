'use client';

import { useEffect, useState } from 'react';

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
 * Collapsible reasoning display. Hidden until thinking exceeds 100 chars
 * OR 500ms — keeps the panel from flickering for trivial turns.
 *
 * After the turn ends, the panel collapses by default. Click the header
 * to re-expand. On history reload, the same rules apply.
 */
export function ThinkingPanel({ thinking, isStreaming, durationMs }: ThinkingPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [crossedThreshold, setCrossedThreshold] = useState(false);

  useEffect(() => {
    if (!isStreaming) {
      // After stream ends, visibility is based on final thinking length.
      setCrossedThreshold(thinking.length >= VISIBILITY_CHAR_THRESHOLD);
      return;
    }
    // While streaming, cross the threshold on length OR a 500ms timer.
    if (thinking.length >= VISIBILITY_CHAR_THRESHOLD) {
      setCrossedThreshold(true);
      return;
    }
    const t = setTimeout(() => setCrossedThreshold(true), VISIBILITY_TIME_THRESHOLD_MS);
    return () => clearTimeout(t);
  }, [thinking, isStreaming]);

  if (!crossedThreshold) return null;

  const headerLabel = isStreaming
    ? 'Thinking...'
    : `Thinking · ${formatDuration(durationMs)}`;

  return (
    <div className="my-2 rounded border border-zinc-200 bg-zinc-50 text-zinc-600 text-sm dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400">
      <button
        type="button"
        onClick={() => setExpanded(e => !e)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-zinc-100 dark:hover:bg-zinc-800/50"
      >
        <span className="text-xs">{expanded ? '▾' : '▸'}</span>
        <span className="font-medium">{headerLabel}</span>
      </button>
      {expanded && (
        <div className="px-3 pb-3 pt-1 italic whitespace-pre-wrap leading-relaxed">
          {thinking || '(no reasoning recorded)'}
        </div>
      )}
    </div>
  );
}

function formatDuration(ms?: number): string {
  if (!ms || ms < 0) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
