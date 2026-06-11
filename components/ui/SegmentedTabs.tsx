'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export interface SegmentedTabOption<T extends string> {
  key: T;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
}

interface SegmentedTabsProps<T extends string> {
  options: SegmentedTabOption<T>[];
  value: T;
  onChange: (key: T) => void;
  /**
   * Unique framer-motion layoutId for the sliding pill. MUST be unique per
   * on-screen tab group — two groups sharing an id would animate the pill
   * between each other.
   */
  layoutId: string;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * A segmented control with a glassmorphism sliding "pill" that springs between
 * tabs (the same effect as the /templates Popular/New tabs), extracted for
 * reuse. The active pill's surface is intentionally a touch more visible than
 * the templates version (full-opacity border + shadow + inner highlight).
 */
export default function SegmentedTabs<T extends string>({
  options,
  value,
  onChange,
  layoutId,
  size = 'md',
  className,
}: SegmentedTabsProps<T>) {
  const pad = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3.5 py-1.5 text-sm';
  const iconSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';

  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      className={cn(
        'inline-flex items-center gap-1 p-1 rounded-xl bg-surface-tertiary/70 border border-stroke-subtle/60',
        className,
      )}
    >
      {options.map(({ key, label, icon: Icon }) => {
        const active = value === key;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(key)}
            className={cn(
              'relative inline-flex items-center justify-center whitespace-nowrap rounded-lg font-medium transition-[color,transform] duration-150 ease-out active:scale-[0.97] motion-reduce:active:scale-100',
              pad,
            )}
          >
            {active && (
              <motion.span
                layoutId={layoutId}
                aria-hidden
                className="absolute inset-0 rounded-lg bg-surface-elevated border border-stroke-subtle shadow-md ring-1 ring-inset ring-white/10"
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
              />
            )}
            <span
              className={cn(
                'relative z-10 inline-flex items-center gap-1.5',
                active ? 'text-content-primary' : 'text-content-tertiary hover:text-content-secondary',
              )}
            >
              {Icon && <Icon className={iconSize} />}
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
