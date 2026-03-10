'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface FloatingGlassProps {
    className?: string;
}

export const FloatingGlass: React.FC<FloatingGlassProps> = ({ className }) => {
    return (
        <div className={cn("absolute inset-0 overflow-hidden pointer-events-none z-0", className)}>
            {/* Mesh Background */}
            <div className="absolute inset-0 mesh-gradient opacity-40" />

            {/* Animated Glass Blobs */}
            <div className="absolute top-[10%] left-[10%] w-[30rem] h-[30rem] bg-accent-primary/20 rounded-full blur-[120px] animate-pulse"
                style={{ animationDuration: '8s' }} />
            <div className="absolute bottom-[20%] right-[10%] w-[25rem] h-[25rem] bg-accent-secondary/15 rounded-full blur-[100px] animate-pulse"
                style={{ animationDuration: '12s', animationDelay: '2s' }} />
            <div className="absolute top-[40%] right-[30%] w-[20rem] h-[20rem] bg-blue-500/10 rounded-full blur-[80px] animate-pulse"
                style={{ animationDuration: '10s', animationDelay: '1s' }} />

            {/* Noise Overlay for texture */}
            <div className="absolute inset-0 opacity-[0.03] mix-blend-overlay pointer-events-none bg-[url('https://grainy-gradients.vercel.app/noise.svg')]" />
        </div>
    );
};
