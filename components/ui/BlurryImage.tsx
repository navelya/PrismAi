'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { blurRevealMotion } from './blur-reveal';
import { toThumbnailUrl } from '@/lib/utils/supabase-image';

const REVEAL_EASE = [0.4, 0, 0.2, 1] as const;
const RENDER_SEGMENT = '/storage/v1/render/image/';

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

    // ── LQIP placeholder ──────────────────────────────────────────────────────
    // A tiny (32px) Supabase transform of the same image. It loads near-instantly
    // and is shown blurred + slightly scaled behind the full image, so the user
    // sees the whole frame as blurry content immediately instead of the browser's
    // top-to-bottom raster fill of the high-res file.
    //
    // Prefer `fallbackSrc` when present: ai_generator passes an already-transformed
    // `/render/image/` URL as `src` and the original `/object/public/` URL as
    // `fallbackSrc`. toThumbnailUrl only rewrites object URLs, so deriving from the
    // original is what actually yields a 32px version.
    const placeholderSrc =
        toThumbnailUrl(typeof fallbackSrc === 'string' ? fallbackSrc : undefined, { width: 32, quality: 30 })
        ?? toThumbnailUrl(typeof src === 'string' ? src : undefined, { width: 32, quality: 30 });
    // Only treat it as a real LQIP when a downscaled transform was actually
    // produced. data:/blob:/external URLs pass through unchanged → fall back to
    // the plain blur-up reveal below.
    const hasPlaceholder = !!placeholderSrc && placeholderSrc.includes(RENDER_SEGMENT);

    // When we have a real placeholder, the full image renders at full opacity and
    // drives the container size (its intrinsic dimensions parse from the first
    // network chunk); the blurred placeholder sits ON TOP and hides the partial
    // top-to-bottom paint until the image is fully decoded. Without a placeholder,
    // keep the original self-blur reveal so non-transformable sources still work.
    const mainMotion = hasPlaceholder
        ? { initial: { opacity: 1 }, animate: { opacity: 1 } }
        : blurRevealMotion(isLoaded, blurAmount, transitionDuration);

    return (
        <div className={cn("relative overflow-hidden w-full h-full bg-white/5", containerClassName)}>
            {/* Full-resolution image. Drives layout size; covered by the blurred
                placeholder below until it finishes decoding. */}
            <motion.img
                key={src}
                src={displaySrc}
                alt={alt}
                {...mainMotion}
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

            {/* Blurry full-frame placeholder, laid over the still-loading image and
                faded out once it has decoded — so the user sees blurry-but-complete
                content immediately instead of a top-to-bottom raster fill. */}
            <AnimatePresence>
                {hasPlaceholder && !isLoaded && (
                    <motion.img
                        key="lqip"
                        src={placeholderSrc}
                        alt=""
                        aria-hidden
                        initial={{ opacity: 1 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: transitionDuration, ease: REVEAL_EASE }}
                        className="absolute inset-0 w-full h-full object-contain pointer-events-none"
                        style={{ filter: `blur(${blurAmount})`, transform: 'scale(1.1)' }}
                    />
                )}
            </AnimatePresence>

            {/* Generic loading veil only when there's no LQIP placeholder to show. */}
            {!isLoaded && !hasPlaceholder && (
                <div className="absolute inset-0 bg-white/5 backdrop-blur-sm pointer-events-none" />
            )}
        </div>
    );
}
