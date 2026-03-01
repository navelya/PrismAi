'use client';

import React from 'react';
import * as Icons from 'lucide-react';
import { cn } from '@/lib/utils';

interface NodeHeaderProps {
    icon: string;
    label: string;
    description?: string; // We'll keep it in props but won't render it per requirement
    color: string;
    badgeCount?: number;
    className?: string;
}

export function NodeHeader({ icon, label, color, badgeCount, className }: NodeHeaderProps) {
    const IconComponent = (Icons[icon as keyof typeof Icons] as React.ComponentType<any>) || Icons.Box;

    return (
        <div className={cn("flex items-center gap-2 px-3 py-2 border-b border-white/5", className)}>
            <div
                className="w-6 h-6 rounded-md flex items-center justify-center shrink-0"
                style={{ backgroundColor: `${color}30` }}
            >
                <IconComponent
                    className="w-3.5 h-3.5"
                    style={{ color: color }}
                />
            </div>

            <div className="flex-1 min-w-0">
                <h3 className="text-[11px] font-bold text-white/90 truncate tracking-tight uppercase">
                    {label}
                </h3>
            </div>

            {badgeCount !== undefined && badgeCount > 0 && (
                <div className="px-1.5 py-0.5 rounded-full bg-accent-primary text-[9px] font-bold text-white leading-none shadow-sm">
                    {badgeCount}
                </div>
            )}
        </div>
    );
}
