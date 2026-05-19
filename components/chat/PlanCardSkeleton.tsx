'use client';

import React from 'react';
import { Skeleton } from '@/components/ui/Skeleton';

function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <div className="text-[9px] uppercase tracking-widest text-content-primary/40 font-bold">
            {children}
        </div>
    );
}

export function PlanCardSkeleton() {
    return (
        <div
            className="relative w-full min-w-[22rem] max-w-full mt-2 rounded-lg border border-stroke-subtle/70 bg-surface-secondary/30 p-3 animate-fade-in"
            role="status"
            aria-label="Generating plan"
        >
            <Skeleton className="h-3.5 w-2/3 rounded-sm" />
            <div className="h-px bg-stroke-subtle/50 my-2" />

            <div className="space-y-1.5 mb-3">
                <SectionLabel>What it does</SectionLabel>
                <Skeleton className="h-2.5 w-full rounded-sm" />
                <Skeleton className="h-2.5 w-5/6 rounded-sm" />
            </div>

            <div className="space-y-1.5 mb-3">
                <SectionLabel>Overall workflow</SectionLabel>
                <Skeleton className="h-2.5 w-11/12 rounded-sm" />
                <Skeleton className="h-2.5 w-3/4 rounded-sm" />
            </div>

            <div className="space-y-1.5 mb-1">
                <SectionLabel>Models used</SectionLabel>
                <div className="flex flex-wrap gap-1 pt-0.5">
                    <Skeleton className="h-5 w-20 rounded-md" />
                    <Skeleton className="h-5 w-24 rounded-md" />
                    <Skeleton className="h-5 w-16 rounded-md" />
                </div>
            </div>
        </div>
    );
}
