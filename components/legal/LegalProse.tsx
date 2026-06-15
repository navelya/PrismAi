import React from 'react';
import { cn } from '@/lib/utils';

export function LegalHeader({ tag, title, updated }: { tag: string; title: string; updated: string }) {
    return (
        <header className="mb-16 space-y-4">
            <span className="inline-flex items-center gap-2 text-xs font-semibold tracking-[0.18em] uppercase text-accent-primary">
                <span className="h-1 w-1 rounded-full bg-accent-primary" />
                {tag}
            </span>
            <h1 className="font-display normal-case font-semibold tracking-tight text-content-primary text-3xl md:text-5xl leading-tight">
                {title}
            </h1>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-content-tertiary">
                Last updated · {updated}
            </p>
        </header>
    );
}

export function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
    return (
        <section id={id} className="mb-12 scroll-mt-28">
            <h2 className="font-display normal-case font-semibold tracking-tight text-content-primary text-xl md:text-2xl mb-4">
                {title}
            </h2>
            <div className="space-y-4 text-[15px] leading-relaxed text-content-secondary max-w-[68ch]">
                {children}
            </div>
        </section>
    );
}

export function P({ children, className }: { children: React.ReactNode; className?: string }) {
    return <p className={cn('text-[15px] leading-relaxed text-content-secondary max-w-[68ch]', className)}>{children}</p>;
}

export function UL({ children }: { children: React.ReactNode }) {
    return <ul className="list-disc pl-5 space-y-2 marker:text-content-tertiary">{children}</ul>;
}

export function Strong({ children }: { children: React.ReactNode }) {
    return <strong className="font-semibold text-content-primary">{children}</strong>;
}
