'use client';

import React from 'react';
import { Check } from 'lucide-react';

interface WizardStepperProps {
  /** Ordered step labels. */
  steps: string[];
  /** 0-based index of the active step. */
  current: number;
}

/**
 * A horizontal step ruler: numbered circles joined by connector lines. Completed
 * steps show a check, the active step is ringed, upcoming steps are muted.
 * Purely presentational — navigation is driven by the wizard's footer buttons.
 */
export default function WizardStepper({ steps, current }: WizardStepperProps) {
  return (
    <div className="flex items-center">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <React.Fragment key={label}>
            <div className="flex items-center gap-2 shrink-0">
              <div
                className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-semibold transition-colors ${
                  done
                    ? 'bg-accent-primary text-white'
                    : active
                      ? 'bg-accent-primary/15 text-accent-primary ring-2 ring-accent-primary'
                      : 'bg-surface-tertiary text-content-tertiary'
                }`}
              >
                {done ? <Check className="w-3.5 h-3.5" /> : i + 1}
              </div>
              <span
                className={`text-sm font-medium hidden sm:block ${
                  active ? 'text-content-primary' : 'text-content-tertiary'
                }`}
              >
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                className={`flex-1 h-px mx-3 transition-colors ${
                  i < current ? 'bg-accent-primary' : 'bg-stroke-subtle'
                }`}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

/** Framer-motion variants for the horizontal step slide. Pass the navigation
 *  direction (1 = forward, -1 = back) as `custom` on AnimatePresence + child. */
export const stepSlideVariants = {
  enter: (dir: number) => ({ x: dir * 48, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir * -48, opacity: 0 }),
};
