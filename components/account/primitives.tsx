'use client';

import React from 'react';

/**
 * Small uppercase divider that labels a group of settings inside a tab (e.g.
 * "Appearance", "Automation"). The tab itself has no big title — the sidebar
 * label is the heading — so these dividers carry the in-tab hierarchy.
 */
export function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex items-center gap-3">
            <h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-content-tertiary whitespace-nowrap">
                {children}
            </h3>
            <div className="h-px flex-1 bg-stroke-subtle/70" />
        </div>
    );
}

interface SettingRowProps {
    title: string;
    description?: string;
    children?: React.ReactNode;
    disabled?: boolean;
    soon?: boolean;
    /** `inline` puts the control to the right; `stacked` puts it on its own row below. */
    layout?: 'inline' | 'stacked';
}

/** A single labelled setting: title + optional description, with its control. */
export function SettingRow({
    title,
    description,
    children,
    disabled = false,
    soon = false,
    layout = 'inline',
}: SettingRowProps) {
    const header = (
        <div className="min-w-0">
            <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-content-primary">{title}</span>
                {soon && (
                    <span className="px-1.5 py-0.5 text-[8.5px] font-bold uppercase tracking-[0.1em] text-content-tertiary border border-stroke-subtle rounded-md">
                        Soon
                    </span>
                )}
            </div>
            {description && (
                <p className="text-xs text-content-tertiary mt-1 leading-relaxed">{description}</p>
            )}
        </div>
    );

    return (
        <div className={disabled ? 'opacity-50 pointer-events-none' : ''}>
            {layout === 'inline' ? (
                <div className="flex items-center justify-between gap-6">
                    {header}
                    {children && <div className="shrink-0">{children}</div>}
                </div>
            ) : (
                <div className="space-y-4">
                    {header}
                    {children}
                </div>
            )}
        </div>
    );
}

/** A disabled placeholder toggle, used for the "Soon" editor settings. */
export function DisabledToggle() {
    return (
        <div className="w-10 h-6 bg-surface-tertiary rounded-full relative">
            <div className="w-4 h-4 bg-content-tertiary rounded-full absolute left-1 top-1" />
        </div>
    );
}
