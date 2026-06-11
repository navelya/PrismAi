'use client';

import { useEffect, useState } from 'react';
import { Check, X, Loader2, Expand } from 'lucide-react';
import ImageLightbox from '@/components/ui/ImageLightbox';
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

/**
 * A square (1:1) 2×2 grid of candidate sheets that fits the fixed-height content
 * area without scrolling. Clicking a tile only MARKS it selected (the wizard's
 * Continue advances). Hovering a tile reveals an expand icon that opens the sheet
 * in a full-screen lightbox.
 */
export default function SheetCandidateGrid({
  slots,
  selectedIndex,
  onSelect,
  generating,
}: SheetCandidateGridProps) {
  // Lightbox holds the position within the image-only list (for prev/next nav).
  const [lightboxPos, setLightboxPos] = useState<number | null>(null);
  const imageUrls = slots.filter(isImage).map((s) => s.url);

  const openLightbox = (slotIndex: number) => {
    let pos = 0;
    for (let i = 0; i < slotIndex; i++) if (isImage(slots[i])) pos++;
    setLightboxPos(pos);
  };

  // Capture-phase Escape guard: when the lightbox is open, swallow Escape so it
  // closes the lightbox only — without bubbling to the parent modal's own Escape
  // handler (which would otherwise dismiss the whole wizard).
  useEffect(() => {
    if (lightboxPos === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation();
        e.preventDefault();
        setLightboxPos(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [lightboxPos]);

  return (
    <div className="h-full flex flex-col min-h-0">
      {/* Centered square grid that scales to the available height (1:1 tiles). */}
      <div className="flex-1 min-h-0 w-full flex items-center justify-center">
        <div className="grid grid-cols-2 grid-rows-2 gap-4 h-full aspect-square max-w-full">
          {slots.map((slot, index) => {
            const selected = selectedIndex === index;
            const borderClass = selected
              ? 'ring-2 ring-accent-primary border-accent-primary'
              : 'border-stroke-subtle';

            return (
              <div
                key={index}
                className={`group relative min-h-0 rounded-xl overflow-hidden border bg-surface-tertiary ${borderClass}`}
              >
                {isImage(slot) ? (
                  <>
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
                    </button>

                    {/* Expand → lightbox (hover-revealed; never triggers selection) */}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); openLightbox(index); }}
                      title="Open in lightbox"
                      className="absolute top-2 left-2 z-10 p-1.5 rounded-md bg-black/50 text-white opacity-0 group-hover:opacity-100 hover:bg-black/70 transition-opacity focus:outline-none focus:opacity-100"
                    >
                      <Expand className="w-4 h-4" />
                    </button>

                    {selected && (
                      <span className="absolute top-2 right-2 z-10 flex items-center justify-center w-6 h-6 rounded-full bg-accent-primary text-white shadow-sm pointer-events-none">
                        <Check className="w-3.5 h-3.5" />
                      </span>
                    )}
                  </>
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
      </div>

      {generating && (
        <p className="flex items-center gap-1.5 text-xs text-content-tertiary pt-3 shrink-0 justify-center">
          <Loader2 className="w-3 h-3 animate-spin shrink-0" />
          Generating sheets… click one to select as soon as it appears.
        </p>
      )}

      {lightboxPos !== null && imageUrls.length > 0 && (
        <ImageLightbox
          media={imageUrls}
          type="image"
          initialIndex={Math.min(lightboxPos, imageUrls.length - 1)}
          onClose={() => setLightboxPos(null)}
        />
      )}
    </div>
  );
}
