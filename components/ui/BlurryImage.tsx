'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

interface BlurryImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart' | 'onLoad'> {
    containerClassName?: string;
    blurAmount?: string;
    transitionDuration?: number;
    onLoad?: () => void;
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
                    initial={{ filter: `blur(${blurAmount})`, opacity: 0.3 }}
                    animate={{
                        filter: isLoaded ? 'blur(0px)' : `blur(${blurAmount})`,
                        opacity: isLoaded ? 1 : 0.5,
                        scale: isLoaded ? 1 : 1.05
                    }}
                    transition={{
                        duration: transitionDuration,
                        ease: [0.4, 0, 0.2, 1]
                    }}
                    onLoad={() => {
                        setIsLoaded(true);
                        onLoad?.();
                    }}
                    onError={() => {
                        if (fallbackSrc && !didFallback) setDidFallback(true);
                    }}
                    className={cn(
                        "w-full h-auto block object-contain",
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
