'use client';

import React from 'react';
import { cn } from '@/lib/utils';

interface TooltipProps extends React.HTMLAttributes<HTMLDivElement> {
    content: string;
    children: React.ReactNode;
    position?: 'top' | 'bottom' | 'left' | 'right' | 'bottom-end' | 'top-end' | 'bottom-start' | 'top-start';
    className?: string; // Wrapper className
    popupClassName?: string; // Tooltip popup className
    delay?: number; // TODO: Implement delay if needed (CSS group-hover is instant)
}

export function Tooltip({ content, children, position = 'top', className, popupClassName, ...props }: TooltipProps) {
    return (
        <div className={cn("relative group flex items-center justify-center", className)} {...props}>
            {children}

            {content && (
                <div className={cn(
                    "absolute px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest shadow-premium pointer-events-none transition-all duration-300 z-50 whitespace-nowrap",
                    "bg-surface-secondary/95 text-content-primary border border-stroke-subtle backdrop-blur-md opacity-0 scale-95 group-hover:opacity-100 group-hover:scale-100",
                    // Center positions
                    position === 'top' && "bottom-full mb-2 origin-bottom left-1/2 -translate-x-1/2",
                    position === 'bottom' && "top-full mt-2 origin-top left-1/2 -translate-x-1/2",
                    position === 'left' && "right-full mr-2 origin-right top-1/2 -translate-y-1/2",
                    position === 'right' && "left-full ml-2 origin-left top-1/2 -translate-y-1/2",
                    // Corner positions
                    position === 'bottom-end' && "top-full mt-2 right-0 origin-top-right",
                    position === 'top-end' && "bottom-full mb-2 right-0 origin-bottom-right",
                    position === 'bottom-start' && "top-full mt-2 left-0 origin-top-left",
                    position === 'top-start' && "bottom-full mb-2 left-0 origin-bottom-left",
                    popupClassName
                )}>
                    {content}
                    {/* Arrow */}
                    <div className={cn(
                        "absolute w-2 h-2 bg-surface-secondary border-l border-t border-stroke-subtle rotate-45",
                        // Center Arrows
                        position === 'top' && "bottom-[-4px] left-1/2 -translate-x-1/2",
                        position === 'bottom' && "top-[-4px] left-1/2 -translate-x-1/2",
                        position === 'left' && "right-[-4px] top-1/2 -translate-y-1/2",
                        position === 'right' && "left-[-4px] top-1/2 -translate-y-1/2",
                        // Corner Arrows (align to the button center approximation)
                        (position === 'bottom-end' || position === 'top-end') && "right-3",
                        (position === 'bottom-start' || position === 'top-start') && "left-3",
                        (position === 'bottom-end' || position === 'bottom-start') && "top-[-4px]",
                        (position === 'top-end' || position === 'top-start') && "bottom-[-4px]"
                    )} />
                </div>
            )}
        </div>
    );
}
