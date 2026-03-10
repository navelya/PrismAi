'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
    shimmer?: boolean;
    hoverIntensity?: 'low' | 'high';
}

export const GlassCard: React.FC<GlassCardProps> = ({
    children,
    className,
    shimmer = true,
    hoverIntensity = 'high',
    ...props
}) => {
    return (
        <div
            className={cn(
                "glassmorphism rounded-3xl p-8 transition-all duration-500",
                shimmer && "glass-shimmer",
                hoverIntensity === 'high' ? "hover:scale-[1.02] hover:shadow-premium" : "hover:bg-white/10",
                className
            )}
            {...props}
        >
            {children}
        </div>
    );
};
