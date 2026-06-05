'use client';

import React from 'react';
import { Sparkles } from 'lucide-react';

export function ComingSoonTab({
    icon,
    title,
    description,
}: {
    icon: React.ReactNode;
    title: string;
    description: string;
}) {
    return (
        <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-surface-elevated border border-stroke-subtle flex items-center justify-center mb-6 text-content-tertiary">
                {icon}
            </div>
            <h3 className="text-lg font-bold text-content-primary">{title}</h3>
            <p className="text-sm text-content-tertiary max-w-xs mt-2 leading-relaxed">{description}</p>
            <div className="mt-6 flex items-center gap-2 px-3 py-1.5 bg-surface-elevated border border-stroke-subtle rounded-full text-[10px] font-bold text-content-tertiary uppercase tracking-widest">
                <Sparkles className="w-3 h-3 text-accent-primary" />
                Coming soon
            </div>
        </div>
    );
}
