'use client';

import React from 'react';
import { Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip } from './Tooltip';

interface DescriptionHintProps {
    /** The description body to show in the tooltip. Renders nothing when empty. */
    body?: string;
    /** Which side the tooltip points to. Default 'bottom' (used next to control labels). */
    side?: 'top' | 'bottom' | 'left' | 'right';
    className?: string;
}

/**
 * A minimal circled-ⓘ info marker that reveals a field's description on hover.
 * Reuses the shared Tooltip (smooth zoom in/out, auto-fits within the viewport)
 * with a description-style popup (wrapping, normal-case). Used next to model
 * control labels; handle labels use the Tooltip directly (no icon).
 */
export function DescriptionHint({ body, side = 'bottom', className }: DescriptionHintProps) {
    if (!body) return null;
    return (
        <Tooltip
            content={body}
            position={side}
            delay={120}
            className={cn('cursor-help', className)}
            popupClassName="whitespace-normal max-w-[15rem] py-1.5 leading-snug normal-case tracking-normal font-medium text-[10px]"
        >
            <Info className="w-3 h-3 text-content-tertiary/70 hover:text-content-secondary transition-colors" />
        </Tooltip>
    );
}
