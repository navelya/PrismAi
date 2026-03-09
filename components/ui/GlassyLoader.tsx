'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface GlassyLoaderProps {
    className?: string;
    containerClassName?: string;
}

export default function GlassyLoader({ className, containerClassName }: GlassyLoaderProps) {
    return (
        <div className={cn(
            "absolute inset-0 z-10 flex items-center justify-center overflow-hidden bg-black/10 backdrop-blur-[6px]",
            containerClassName
        )}>
            {/* Soft Breathing Aura Pulses */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                {/* Core Aura Pulse */}
                <motion.div
                    animate={{
                        scale: [1, 1.3, 1],
                        opacity: [0.3, 0.5, 0.3],
                    }}
                    transition={{
                        duration: 4,
                        repeat: Infinity,
                        ease: "easeInOut"
                    }}
                    className="absolute w-[80%] aspect-square rounded-full bg-accent-primary blur-[80px]"
                />

                {/* Secondary Aura Pulse */}
                <motion.div
                    animate={{
                        scale: [1.2, 0.9, 1.2],
                        opacity: [0.2, 0.4, 0.2],
                    }}
                    transition={{
                        duration: 6,
                        repeat: Infinity,
                        ease: "easeInOut",
                        delay: 1
                    }}
                    className="absolute w-[90%] aspect-square rounded-full bg-accent-secondary blur-[100px]"
                />
            </div>

            {/* Central Glassy Morphing Aura */}
            <div className="relative">
                <motion.div
                    animate={{
                        borderRadius: [
                            "42% 58% 70% 30% / 45% 45% 55% 55%",
                            "70% 30% 46% 54% / 30% 29% 71% 70%",
                            "42% 58% 70% 30% / 45% 45% 55% 55%"
                        ],
                        rotate: [0, 180, 360],
                    }}
                    transition={{
                        duration: 20,
                        repeat: Infinity,
                        ease: "linear"
                    }}
                    className={cn(
                        "w-40 h-40 bg-white/5 backdrop-blur-2xl border border-white/10 flex items-center justify-center",
                        className
                    )}
                >
                    {/* Inner Holographic Glow */}
                    <motion.div
                        animate={{
                            scale: [0.8, 1.1, 0.8],
                        }}
                        transition={{
                            duration: 3,
                            repeat: Infinity,
                            ease: "easeInOut"
                        }}
                        className="w-16 h-16 rounded-full bg-white/10 blur-[30px]"
                    />
                </motion.div>

                {/* Shimmer overlay */}
                <motion.div
                    animate={{ x: ['-200%', '200%'] }}
                    transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                    className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent skew-x-12 opacity-30 pointer-events-none"
                />
            </div>

            {/* Breathing Progress Indicator */}
            <div className="absolute bottom-10 left-0 right-0 flex flex-col items-center gap-1">
                <motion.div
                    animate={{ scaleX: [0, 0.6, 0] }}
                    transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
                    className="w-32 h-[1px] bg-gradient-to-r from-transparent via-accent-primary to-transparent"
                />
                <motion.span
                    animate={{ opacity: [0.3, 0.6, 0.3] }}
                    transition={{ duration: 2, repeat: Infinity }}
                    className="text-[9px] font-bold tracking-[0.4em] uppercase text-white/40"
                >
                    Processing
                </motion.span>
            </div>
        </div>
    );
}
