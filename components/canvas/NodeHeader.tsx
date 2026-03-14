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
    providerLogo?: string;
}

export function NodeHeader({ icon, label, color, badgeCount, className, providerLogo }: NodeHeaderProps) {
    const IconComponent = (Icons[icon as keyof typeof Icons] as React.ComponentType<any>) || Icons.Box;

    return (
        <div className={cn("flex items-center gap-2 px-3 py-2 border-stroke-subtle", className)}>
            <div
                className="w-6 h-6 rounded flex items-center justify-center shrink-0 bg-accent-primary/10 border border-accent-primary/20 overflow-hidden"
            >
                <IconComponent
                    className="w-3.5 h-3.5 text-accent-primary"
                />
            </div>

            <div className="flex-1 min-w-0">
                <h3 className="text-[11px] font-bold text-content-primary truncate tracking-wider uppercase">
                    {label}
                </h3>
            </div>

            {badgeCount !== undefined && badgeCount > 0 && (
                <div className="px-2 py-0.5 rounded-full bg-accent-primary text-[10px] font-black text-content-inverted leading-none shadow-lg">
                    {badgeCount}
                </div>
            )}
        </div>
    );
}
