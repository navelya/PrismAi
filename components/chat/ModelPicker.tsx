'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, Check, Settings2, Zap } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface ModelPickerProps {
  selectedModel: 'haiku' | 'sonnet';
  onSelect: (m: 'haiku' | 'sonnet') => void;
  isPaid: boolean;
}

export function ModelPicker({ selectedModel, onSelect, isPaid }: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={containerRef} className="relative z-10">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`p-2 rounded-lg transition-colors ${
          open
            ? 'bg-surface-tertiary text-content-primary'
            : 'bg-surface-secondary hover:bg-surface-tertiary text-content-tertiary hover:text-content-secondary'
        }`}
        aria-label="Select chat model"
      >
        <Settings2 className="w-5 h-5" />
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-64 bg-surface-primary/90 backdrop-blur-xl rounded-xl shadow-2xl border border-stroke-subtle overflow-hidden z-50">
          {isPaid ? (
            <>
              {/* Sonnet option */}
              <button
                type="button"
                onClick={() => { onSelect('sonnet'); setOpen(false); }}
                className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-surface-secondary transition-colors"
              >
                <div className="mt-0.5 p-1.5 rounded-md bg-accent-primary/10 text-accent-primary shrink-0">
                  <Sparkles className="w-3.5 h-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-content-primary">Sonnet 4.6</p>
                  <p className="text-xs text-content-tertiary mt-0.5">Smarter, more capable</p>
                </div>
                {selectedModel === 'sonnet' && (
                  <Check className="w-4 h-4 text-accent-primary shrink-0 mt-1" strokeWidth={3} />
                )}
              </button>

              <div className="border-t border-stroke-subtle" />

              {/* Haiku option */}
              <button
                type="button"
                onClick={() => { onSelect('haiku'); setOpen(false); }}
                className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-surface-secondary transition-colors"
              >
                <div className="mt-0.5 p-1.5 rounded-md bg-content-tertiary/10 text-content-secondary shrink-0">
                  <Zap className="w-3.5 h-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-content-primary">Haiku 4.5</p>
                  <p className="text-xs text-content-tertiary mt-0.5">Faster, simpler tasks</p>
                </div>
                {selectedModel === 'haiku' && (
                  <Check className="w-4 h-4 text-accent-primary shrink-0 mt-1" strokeWidth={3} />
                )}
              </button>
            </>
          ) : (
            <>
              {/* Auto / Haiku (locked) */}
              <div className="flex items-start gap-3 px-4 py-3">
                <div className="mt-0.5 p-1.5 rounded-md bg-content-tertiary/10 text-content-secondary shrink-0">
                  <Zap className="w-3.5 h-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-content-primary">Automatic</p>
                  <p className="text-xs text-content-tertiary mt-0.5">Haiku 4.5 — auto</p>
                </div>
                <Check className="w-4 h-4 text-accent-primary shrink-0 mt-1" strokeWidth={3} />
              </div>

              <div className="border-t border-stroke-subtle" />

              {/* Upgrade CTA */}
              <button
                type="button"
                onClick={() => { setOpen(false); router.push('/settings?tab=plan-billing'); }}
                className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-surface-secondary transition-colors opacity-70"
              >
                <div className="mt-0.5 p-1.5 rounded-md bg-accent-primary/10 text-accent-primary shrink-0">
                  <Sparkles className="w-3.5 h-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-content-primary">Upgrade for Sonnet</p>
                  <p className="text-xs text-content-tertiary mt-0.5">Smarter, more capable</p>
                </div>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
