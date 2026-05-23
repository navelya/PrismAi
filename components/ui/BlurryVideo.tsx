'use client';

import React, { forwardRef, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { blurRevealMotion } from './blur-reveal';

type MotionVideoProps = Omit<
    React.VideoHTMLAttributes<HTMLVideoElement>,
    'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart'
>;

interface BlurryVideoProps extends MotionVideoProps {
    containerClassName?: string;
    blurAmount?: string;
    transitionDuration?: number;
}

/**
 * Video sibling of BlurryImage. Renders a `<video>` that fades in from blurry to
 * sharp once the first frame has decoded (`onLoadedData`), matching the blur-up
 * UX used for images across node previews.
 *
 * Forwards a ref to the underlying <video> so callers can drive hover play/pause
 * or read metadata, and passes through all native video props (muted, loop,
 * playsInline, preload, width, onLoadedMetadata, mouse handlers, ...).
 */
const BlurryVideo = forwardRef<HTMLVideoElement, BlurryVideoProps>(function BlurryVideo(
    {
        src,
        className,
        containerClassName,
        blurAmount = '20px',
        transitionDuration = 0.8,
        onLoadedData,
        onLoadedMetadata,
        ...props
    },
    ref
) {
    const [isLoaded, setIsLoaded] = useState(false);

    // Reset blur state when the source changes (e.g. switching the active media).
    useEffect(() => {
        setIsLoaded(false);
    }, [src]);

    return (
        <div className={cn('relative overflow-hidden w-full h-full bg-white/5', containerClassName)}>
            <AnimatePresence mode="wait">
                <motion.video
                    key={src as string}
                    ref={ref}
                    src={src}
                    {...blurRevealMotion(isLoaded, blurAmount, transitionDuration)}
                    onLoadedData={(e) => {
                        setIsLoaded(true);
                        onLoadedData?.(e);
                    }}
                    // Also clear the blur on loadedmetadata: with preload="metadata"
                    // (or the browser default) `loadeddata` may not fire until
                    // playback, which would leave the first frame stuck blurred.
                    onLoadedMetadata={(e) => {
                        setIsLoaded(true);
                        onLoadedMetadata?.(e);
                    }}
                    className={cn('block object-contain max-w-[420px] max-h-[420px]', className)}
                    {...props}
                />
            </AnimatePresence>

            {!isLoaded && (
                <div className="absolute inset-0 bg-white/5 backdrop-blur-sm pointer-events-none" />
            )}
        </div>
    );
});

export default BlurryVideo;
