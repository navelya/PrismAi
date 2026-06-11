'use client';

import { ArrowLeft, Loader2, Sparkles } from 'lucide-react';
import type { CharacterRefImage } from '@/lib/api/client';

interface CharacterConfirmStepProps {
  sheet: CharacterRefImage;
  cover: CharacterRefImage | null;     // null while generating
  coverLoading: boolean;
  name: string;
  onName: (v: string) => void;
  description: string;
  onDescription: (v: string) => void;
  weight: number;
  onWeight: (v: number) => void;
  onAutoDescribe: () => void;
  describing: boolean;
  onBack?: () => void;                 // optional inline back; omit when a footer owns navigation
}

export default function CharacterConfirmStep({
  sheet,
  cover,
  coverLoading,
  name,
  onName,
  description,
  onDescription,
  weight,
  onWeight,
  onAutoDescribe,
  describing,
  onBack,
}: CharacterConfirmStepProps) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 h-full">
      {/* LEFT: selected sheet */}
      <div className="flex flex-col gap-2 min-h-0">
        <span className="text-xs font-medium text-content-secondary">Selected sheet</span>
        <div className="rounded-lg overflow-hidden bg-surface-tertiary border border-stroke-subtle flex-1 min-h-[10rem]">
          <img
            src={sheet.url}
            alt="Selected character sheet"
            className="w-full h-full object-contain"
          />
        </div>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 text-xs text-content-tertiary hover:text-content-secondary mt-1 self-start"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to options
          </button>
        )}
      </div>

      {/* RIGHT: cover + fields */}
      <div className="flex flex-col gap-3 min-h-0 overflow-y-auto">
        {/* Cover preview */}
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-content-secondary">Cover</span>
          <div className="aspect-square w-full max-w-[12rem] rounded-lg overflow-hidden bg-surface-tertiary border border-stroke-subtle flex items-center justify-center">
            {coverLoading ? (
              <div className="flex flex-col items-center gap-1.5 text-content-tertiary">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="text-[10px]">Generating cover…</span>
              </div>
            ) : cover ? (
              <img
                src={cover.url}
                alt="Character cover"
                className="w-full h-full object-cover"
              />
            ) : null}
          </div>
        </div>

        {/* Name */}
        <div>
          <label className="block text-xs font-medium text-content-secondary mb-1">Name *</label>
          <input
            value={name}
            onChange={(e) => onName(e.target.value)}
            placeholder="Alice"
            className="w-full px-3 py-2 rounded-lg bg-surface-tertiary border border-stroke-subtle text-content-primary focus:outline-none focus:ring-2 focus:ring-accent-primary"
          />
        </div>

        {/* Description */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="block text-xs font-medium text-content-secondary">Description</label>
            <button
              type="button"
              onClick={onAutoDescribe}
              disabled={describing}
              className="flex items-center gap-1 text-xs text-accent-primary hover:underline disabled:opacity-50"
            >
              {describing ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Sparkles className="w-3 h-3" />
              )}
              Auto-describe
            </button>
          </div>
          <textarea
            value={description}
            onChange={(e) => onDescription(e.target.value)}
            rows={4}
            placeholder="red hair, freckles, green eyes, leather jacket..."
            className="w-full px-3 py-2 rounded-lg bg-surface-tertiary border border-stroke-subtle text-content-primary resize-y min-h-[5rem] focus:outline-none focus:ring-2 focus:ring-accent-primary"
          />
        </div>

        {/* Weight slider */}
        <div>
          <label className="block text-xs font-medium text-content-secondary mb-1">
            Reference weight: {weight}
          </label>
          <input
            type="range"
            min={0}
            max={100}
            value={weight}
            onChange={(e) => onWeight(Number(e.target.value))}
            className="w-full accent-accent-primary"
          />
        </div>
      </div>
    </div>
  );
}
