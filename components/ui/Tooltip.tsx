'use client';

import React from 'react';
import * as RadixTooltip from '@radix-ui/react-tooltip';
import { cn } from '@/lib/utils';

interface TooltipProps {
    content: string;
    children: React.ReactNode;
    position?: 'top' | 'bottom' | 'left' | 'right';
    className?: string;         // Wrapper className
    popupClassName?: string;    // Tooltip popup className
    delay?: number;
}

export function Tooltip({
    content,
    children,
    position = 'top',
    className,
    popupClassName,
    delay = 400,
}: TooltipProps) {
    if (!content) {
        return <>{children}</>;
    }

    return (
        <RadixTooltip.Root delayDuration={delay}>
            <RadixTooltip.Trigger asChild>
                <div className={cn('flex items-center justify-center', className)}>
                    {children}
                </div>
            </RadixTooltip.Trigger>

            <RadixTooltip.Portal>
                <RadixTooltip.Content
                    side={position}
                    sideOffset={8}
                    collisionPadding={8}
                    className={cn(
                        'z-[9999] px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest whitespace-nowrap',
                        'bg-surface-secondary/95 text-content-primary border border-stroke-subtle backdrop-blur-md shadow-premium',
                        'animate-in fade-in-0 zoom-in-95',
                        'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95',
                        'data-[side=top]:slide-in-from-bottom-1',
                        'data-[side=bottom]:slide-in-from-top-1',
                        'data-[side=left]:slide-in-from-right-1',
                        'data-[side=right]:slide-in-from-left-1',
                        popupClassName
                    )}
                >
                    {content}
                    <RadixTooltip.Arrow
                        className="fill-surface-secondary/95"
                        width={10}
                        height={5}
                    />
                </RadixTooltip.Content>
            </RadixTooltip.Portal>
        </RadixTooltip.Root>
    );
}
