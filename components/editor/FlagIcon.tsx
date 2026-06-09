'use client';

import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { flagCdnUrl } from '@/lib/voices/language-flags';

/**
 * Renders a country flag as an IMAGE (SVG from flagcdn), not an emoji — Windows
 * has no flag-emoji glyphs, so emoji flags silently fail there. Falls back to a
 * 2-letter code chip if the image can't load (e.g. a strict CSP or unknown code).
 *
 * Pass a sizing className (e.g. "w-4 h-4"); the flag fills it via object-cover so
 * a 3:2 flag reads as a tidy circle when combined with rounded-full.
 */
export function FlagIcon({
  country,
  code,
  title,
  className,
}: {
  country?: string | null;
  code?: string | null;
  title?: string;
  className?: string;
}) {
  const [errored, setErrored] = useState(false);
  const url = country ? flagCdnUrl(country) : null;

  if (!url || errored) {
    return (
      <span
        title={title}
        className={cn(
          'inline-flex items-center justify-center rounded-full bg-white/10 text-[7px] font-bold uppercase text-content-tertiary leading-none',
          className
        )}
      >
        {String(code || country || '').slice(0, 2)}
      </span>
    );
  }

  return (
    <img
      src={url}
      alt={title || ''}
      title={title}
      loading="lazy"
      onError={() => setErrored(true)}
      className={cn('inline-block object-cover rounded-full bg-white/10', className)}
    />
  );
}
