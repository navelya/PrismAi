'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { blurRevealMotion } from './blur-reveal';

interface BlurryImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart' | 'onLoad'> {
    containerClassName?: string;
    blurAmount?: string;
    transitionDuration?: number;
    /**
     * Fired when the image finishes loading. Receives the image's natural
     * (intrinsic) pixel dimensions so callers can size their container to the
     * real aspect ratio — see the ai_generator node, which uses this to avoid
     * reserving extra width beside portrait outputs.
     */
    onLoad?: (dims?: { naturalWidth: number; naturalHeight: number }) => void;
    /**
     * Used when `src` fails to load (e.g. a Supabase image-transform URL on a
     * project where transformations aren't enabled). Lets callers pass the
     * downscaled URL as `src` and the original full-size URL as `fallbackSrc`,
     * getting the perf benefit when transforms work and degrading gracefully
     * to the original when they don't.
     */
    fallbackSrc?: string;
}

export default function BlurryImage({
    src,
    alt,
    className,
    containerClassName,
    blurAmount = "20px",
    transitionDuration = 0.8,
    onLoad,
    fallbackSrc,
    ...props
}: BlurryImageProps) {
    const [isLoaded, setIsLoaded] = useState(false);
    const [currentSrc, setCurrentSrc] = useState(src);
    const [didFallback, setDidFallback] = useState(false);

    // Reset loaded/fallback state when src changes (e.g. new generation)
    useEffect(() => {
        if (src !== currentSrc) {
            setIsLoaded(false);
            setDidFallback(false);
            setCurrentSrc(src);
        }
    }, [src, currentSrc]);

    const displaySrc = didFallback && fallbackSrc ? fallbackSrc : src;

    return (
        <div className={cn("relative overflow-hidden w-full h-full bg-white/5", containerClassName)}>
            {/* Blurry Placeholder / Previous Image remains visible during transition */}
            <AnimatePresence mode="wait">
                <motion.img
                    key={src}
                    src={displaySrc}
                    alt={alt}
                    {...blurRevealMotion(isLoaded, blurAmount, transitionDuration)}
                    onLoad={(e) => {
                        setIsLoaded(true);
                        const img = e.currentTarget;
                        onLoad?.({ naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight });
                    }}
                    onError={() => {
                        if (fallbackSrc && !didFallback) setDidFallback(true);
                    }}
                    className={cn(
                        // Render at intrinsic size capped at 420 in either
                        // dimension; the browser auto-preserves aspect ratio
                        // when both max-width and max-height apply, so the
                        // image scales to fit within a 420×420 box without
                        // cropping or distortion.
                        "block object-contain max-w-[420px] max-h-[420px]",
                        className
                    )}
                    {...props}
                />
            </AnimatePresence>
            
            {!isLoaded && (
                <div className="absolute inset-0 bg-white/5 backdrop-blur-sm pointer-events-none" />
            )}
        </div>
    );
}
