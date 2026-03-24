'use client';

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

interface BlurryImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'onDrag' | 'onDragStart' | 'onDragEnd' | 'onAnimationStart'> {
    containerClassName?: string;
    blurAmount?: string;
    transitionDuration?: number;
}

export default function BlurryImage({
    src,
    alt,
    className,
    containerClassName,
    blurAmount = "20px",
    transitionDuration = 0.8,
    ...props
}: BlurryImageProps) {
    const [isLoaded, setIsLoaded] = useState(false);
    const [currentSrc, setCurrentSrc] = useState(src);

    // Reset loaded state when src changes (e.g. new generation)
    useEffect(() => {
        if (src !== currentSrc) {
            setIsLoaded(false);
            setCurrentSrc(src);
        }
    }, [src, currentSrc]);

    return (
        <div className={cn("relative overflow-hidden w-full h-full bg-white/5", containerClassName)}>
            {/* Blurry Placeholder / Previous Image remains visible during transition */}
            <AnimatePresence mode="wait">
                <motion.img
                    key={src}
                    src={src}
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
                    onLoad={() => setIsLoaded(true)}
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
