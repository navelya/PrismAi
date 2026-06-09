'use client';

import { useMemo, useState } from 'react';
import { ScanSearch, Brain, LibraryBig, Route, Workflow, ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * Minimal, monochrome "thinking & steps" timeline that replaces the old raw
 * ThinkingPanel. It derives a small ordered list of process steps purely from
 * fields the stream consumer already populates on the message — no new stream
 * events, no system-prompt changes.
 *
 * Visual language (locked with the user via the brainstorm companion):
 *  - one icon badge per step, connector line between them
 *  - NO checkmarks; status carried by the badge + label weight/brightness
 *      done   → quiet grey badge, secondary label
 *      active → accent-tinted badge with a soft pulsing halo, brighter label
 *               that gently shimmers while streaming
 *  - small & light type (12px label / weight 400)
 *  - the "Thought for Ns" step stays expandable to reveal the reasoning
 */
export interface ActivityTimelineProps {
  thinking?: string;
  isThinking?: boolean;
  thinkingDurationMs?: number;
  /** True while the brain is consulting the template library (between
   *  `template_search_start` and `template_search_complete`). The hit/miss
   *  outcome is intentionally NOT surfaced — the search is internal
   *  scaffolding. The step disappears as soon as the search resolves. */
  templateSearching?: boolean;
  planLoading?: boolean;
  hasPlan?: boolean;
  /** True once this turn built/modified the workflow (derived from runProposal /
   *  taskProgress — both persist, so this step survives reload). */
  built?: boolean;
}

type StepStatus = 'done' | 'active';

interface Step {
  key: string;
  Icon: LucideIcon;
  label: string;
  status: StepStatus;
  shimmer?: boolean;
  reasoning?: string;
}

// Below these, a "Thought" flash isn't worth a row — mirrors the old panel's
// suppression so trivial sub-second thinking doesn't add noise.
const THINK_MIN_CHARS = 20;
const THINK_MIN_MS = 500;
// Only offer the expand affordance when there's enough reasoning to be worth it.
const REASONING_MIN_CHARS = 40;

export function ActivityTimeline({
  thinking,
  isThinking,
  thinkingDurationMs,
  templateSearching,
  planLoading,
  hasPlan,
  built,
}: ActivityTimelineProps) {
  const [open, setOpen] = useState(false);

  const steps = useMemo<Step[]>(() => {
    const out: Step[] = [];

    // Lead step — the model always reads the request before acting.
    out.push({ key: 'analyze', Icon: ScanSearch, label: 'Analyzed your request', status: 'done' });

    const thinkLen = thinking?.length ?? 0;
    const showThink =
      !!isThinking ||
      (thinking !== undefined && (thinkLen >= THINK_MIN_CHARS || (thinkingDurationMs ?? 0) >= THINK_MIN_MS));
    if (showThink) {
      const durStr = formatDuration(thinkingDurationMs);
      out.push({
        key: 'think',
        Icon: Brain,
        label: isThinking ? 'Thinking' : durStr ? `Thought for ${durStr}` : 'Thought',
        status: isThinking ? 'active' : 'done',
        shimmer: !!isThinking,
        reasoning: thinking || '',
      });
    }

    // Transient: only renders while the matcher is in flight. We do NOT
    // expose the hit/miss outcome — the search is internal scaffolding, so
    // there's no "Found template / no match" follow-up step. Once the search
    // resolves, the step simply disappears and the next step (plan or build)
    // takes its place.
    if (templateSearching) {
      out.push({
        key: 'templates',
        Icon: LibraryBig,
        label: 'Consulting templates',
        status: 'active',
        shimmer: true,
      });
    }

    const showPlan = !!planLoading || !!hasPlan;
    if (showPlan) {
      const active = !!planLoading && !hasPlan;
      out.push({
        key: 'plan',
        Icon: Route,
        label: active ? 'Creating plan' : 'Created plan',
        status: active ? 'active' : 'done',
        shimmer: active,
      });
    }

    // Built/modified the workflow this turn (runProposal / taskProgress present).
    if (built) {
      out.push({
        key: 'build',
        Icon: Workflow,
        label: 'Built the workflow',
        status: 'done',
      });
    }

    return out;
  }, [thinking, isThinking, thinkingDurationMs, templateSearching, planLoading, hasPlan, built]);

  // A lone "Analyzed your request" on a finished plain answer is just noise.
  if (steps.length <= 1) return null;

  return (
    <div className="my-1.5 flex flex-col">
      {steps.map((step, i) => {
        const isActive = step.status === 'active';
        const isLast = i === steps.length - 1;
        const canExpand = !!step.reasoning && step.reasoning.length >= REASONING_MIN_CHARS;

        return (
          <div key={step.key} className="flex gap-2.5">
            {/* badge + connector rail */}
            <div className="flex flex-col items-center">
              <span
                className={
                  'relative grid h-[21px] w-[21px] shrink-0 place-items-center rounded-md border ' +
                  (isActive
                    ? 'border-accent-primary/50 bg-accent-primary/15 text-accent-primary timeline-halo'
                    : 'border-stroke-subtle bg-surface-tertiary/50 text-content-secondary')
                }
              >
                <step.Icon size={12} strokeWidth={2} />
              </span>
              {!isLast && <span className="mt-0.5 w-px flex-1 bg-stroke/40" />}
            </div>

            {/* label + optional reasoning */}
            <div className="min-w-0 flex-1 pb-2.5">
              <div className="flex min-h-[21px] items-center gap-1.5">
                <span
                  className={
                    'text-xs tracking-[0.1px] ' +
                    (isActive
                      ? step.shimmer
                        ? 'timeline-shimmer font-medium'
                        : 'font-medium text-content-primary'
                      : 'font-normal text-content-secondary')
                  }
                >
                  {step.label}
                </span>
                {canExpand && (
                  <button
                    type="button"
                    onClick={() => setOpen((o) => !o)}
                    aria-expanded={open}
                    aria-label={open ? 'Hide reasoning' : 'Show reasoning'}
                    className="text-content-tertiary transition-colors hover:text-content-secondary"
                  >
                    <ChevronRight
                      size={12}
                      className={'transition-transform duration-200 ' + (open ? 'rotate-90' : '')}
                    />
                  </button>
                )}
              </div>

              {canExpand && open && (
                // -ml-5 pulls the border back under the icon (continuous line from
                // the badge); pl-5 puts the text back under the label.
                <div className="mt-1.5 -ml-5 pl-5 text-[11px] italic leading-relaxed whitespace-pre-wrap text-content-tertiary">
                  {step.reasoning}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function formatDuration(ms?: number): string {
  if (!ms || ms < 0) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
