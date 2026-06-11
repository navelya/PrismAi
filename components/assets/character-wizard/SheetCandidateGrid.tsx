'use client';

import { Check, X, Loader2 } from 'lucide-react';
import type { SheetSlot } from './types';
import type { CharacterRefImage } from '@/lib/api/client';

interface SheetCandidateGridProps {
  slots: SheetSlot[];         // length = total candidates; null = loading, 'failed' = error tile
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  generating: boolean;        // true while a batch is still streaming in
}

function isImage(slot: SheetSlot): slot is CharacterRefImage {
  return slot !== null && slot !== 'failed';
}

export default function SheetCandidateGrid({
  slots,
  selectedIndex,
  onSelect,
  generating,
}: SheetCandidateGridProps) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-4">
        {slots.map((slot, index) => {
          const selected = selectedIndex === index;
          const borderClass = selected
            ? 'ring-2 ring-accent-primary border-accent-primary'
            : 'border-stroke-subtle';

          return (
            <div
              key={index}
              className={`relative aspect-square rounded-xl overflow-hidden border bg-surface-tertiary ${borderClass}`}
            >
              {isImage(slot) ? (
                <button
                  type="button"
                  className="w-full h-full cursor-pointer hover:opacity-95 focus:outline-none"
                  onClick={() => onSelect(index)}
                  aria-pressed={selected}
                >
                  <img
                    src={slot.url}
                    alt={`Candidate sheet ${index + 1}`}
                    className="w-full h-full object-contain"
                  />
                  {selected && (
                    <span className="absolute top-1.5 right-1.5 flex items-center justify-center w-5 h-5 rounded-full bg-accent-primary text-white shadow-sm">
                      <Check className="w-3 h-3" />
                    </span>
                  )}
                </button>
              ) : slot === 'failed' ? (
                <div className="w-full h-full flex flex-col items-center justify-center gap-1 bg-surface-tertiary text-content-tertiary">
                  <X className="w-5 h-5" />
                  <span className="text-[10px]">failed</span>
                </div>
              ) : (
                <div className="w-full h-full bg-surface-tertiary animate-pulse" />
              )}
            </div>
          );
        })}
      </div>

      {generating && (
        <p className="flex items-center gap-1.5 text-xs text-content-tertiary">
          <Loader2 className="w-3 h-3 animate-spin shrink-0" />
          Generating sheets… you can pick one as soon as it appears.
        </p>
      )}
    </div>
  );
}
