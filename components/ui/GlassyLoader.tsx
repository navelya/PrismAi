'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface GlassyLoaderProps {
    className?: string;
    containerClassName?: string;
    /** Verb shown before the jumping dots. Defaults to "Generating". */
    label?: string;
}

/**
 * Overlay shown over a node's preview while it works. Blurs whatever result is
 * already underneath (frosted glass) and shows a minimal "<label>…" with three
 * jumping dots. The travelling-light border now lives on the node card itself
 * (see GeneratingBorder), so this overlay carries no border.
 *
 * It's `absolute inset-0`, so it stretches over the preview without affecting
 * the node's dimensions.
 */
export default function GlassyLoader({ className, containerClassName, label = 'Generating' }: GlassyLoaderProps) {
    return (
        <div
            className={cn(
                'absolute inset-0 z-10 flex items-center justify-center overflow-hidden rounded-xl',
                // Frosted glass over the previous result.
                'bg-black/10 backdrop-blur-md',
                containerClassName
            )}
        >
            <span
                className={cn(
                    'flex items-baseline text-xs font-medium tracking-wide text-white/80',
                    className
                )}
            >
                {label}
                {[0, 1, 2].map((i) => (
                    <motion.span
                        key={i}
                        className="ml-[1px]"
                        animate={{ y: [0, -3, 0] }}
                        transition={{
                            duration: 0.6,
                            repeat: Infinity,
                            ease: 'easeInOut',
                            delay: i * 0.15,
                        }}
                    >
                        .
                    </motion.span>
                ))}
            </span>
        </div>
    );
}
