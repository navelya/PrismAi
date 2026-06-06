'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface GeneratingBorderProps {
    /** Border-radius utility to match the host element (default rounded-2xl). */
    className?: string;
}

// Mask that punches out the center, leaving only a thin border ring visible.
// The two rotating conic gradients fill the ring and read as travelling light.
const RING_THICKNESS = 2; // px
const ringMask: React.CSSProperties = {
    padding: RING_THICKNESS,
    WebkitMask:
        'linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)',
    WebkitMaskComposite: 'xor',
    maskComposite: 'exclude',
};

/**
 * Animated "generating" border — two light arcs travelling the perimeter in
 * opposite directions, masked down to a thin ring. Absolutely positioned and
 * pointer-events-none, so it overlays the host's border without affecting
 * layout or interaction. Match the host's border-radius via `className`.
 */
export default function GeneratingBorder({ className }: GeneratingBorderProps) {
    return (
        <div
            className={cn(
                'absolute inset-0 z-40 overflow-hidden rounded-2xl pointer-events-none',
                className
            )}
            style={ringMask}
        >
            <motion.div
                className="absolute -inset-[60%]"
                style={{
                    background:
                        'conic-gradient(from 0deg, transparent 0deg, transparent 300deg, rgb(var(--accent-primary)) 350deg, transparent 360deg)',
                }}
                animate={{ rotate: 360 }}
                transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
            />
            <motion.div
                className="absolute -inset-[60%]"
                style={{
                    background:
                        'conic-gradient(from 180deg, transparent 0deg, transparent 300deg, rgb(var(--accent-secondary)) 350deg, transparent 360deg)',
                }}
                animate={{ rotate: -360 }}
                transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
            />
        </div>
    );
}
