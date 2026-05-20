'use client';

import React from 'react';
import { Download, Loader2, Check, AlertCircle } from 'lucide-react';
import { Tooltip } from '@/components/ui/Tooltip';
import type { CardDownloadState } from '@/lib/hooks/use-card-download';

/**
 * Compact Download button for a node's floating-actions toolbar (the
 * `customActions` slot on BaseNode). Pair with `useCardDownload` so the
 * pill at the top of the editor reflects fetch progress and the icon
 * cycles through idle/rendering/success/error.
 *
 * Compositor has its own bespoke variant inline in its component because
 * its action toolbar also carries the Edit button and a longer tooltip;
 * keep this component focused on the URL-fetch case used by AI Generator,
 * Blur (image), and Levels.
 */
export function CardDownloadButton({
    state,
    onClick,
}: {
    state: CardDownloadState;
    onClick: () => void;
}) {
    return (
        <Tooltip
            content={
                state === 'rendering' ? 'Downloading…'
                : state === 'success' ? 'Downloaded'
                : state === 'error' ? 'Download failed — click to retry'
                : 'Download'
            }
            position="top"
            delay={600}
        >
            <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onClick(); }}
                onMouseDown={(e) => e.stopPropagation()}
                disabled={state === 'rendering'}
                className="w-6 h-6 rounded flex items-center justify-center text-content-primary hover:bg-white/10 hover:text-accent-primary transition-all disabled:cursor-wait"
            >
                {state === 'rendering' ? <Loader2 className="w-3 h-3 animate-spin pointer-events-none" />
                : state === 'success' ? <Check className="w-3 h-3 pointer-events-none text-emerald-400" />
                : state === 'error' ? <AlertCircle className="w-3 h-3 pointer-events-none text-red-400" />
                : <Download className="w-3 h-3 pointer-events-none" />}
            </button>
        </Tooltip>
    );
}
