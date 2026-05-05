import React from 'react';
import { cn } from '@/lib/utils';

export function LegalHeader({ tag, title, updated }: { tag: string; title: string; updated: string }) {
    return (
        <header className="mb-16 space-y-4">
            <span className="text-[7px] font-black uppercase tracking-[0.5em] text-accent-primary opacity-70">{tag}</span>
            <h1 className="text-3xl md:text-5xl font-black leading-tight uppercase font-display text-slate-900">
                {title}
            </h1>
            <p className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-400">
                Last updated · {updated}
            </p>
        </header>
    );
}

export function Section({ id, title, children }: { id?: string; title: string; children: React.ReactNode }) {
    return (
        <section id={id} className="mb-12 scroll-mt-24">
            <h2 className="text-base md:text-lg font-black uppercase font-display tracking-tight text-slate-900 mb-4">
                {title}
            </h2>
            <div className="space-y-4 text-[14px] leading-relaxed text-slate-600">
                {children}
            </div>
        </section>
    );
}

export function P({ children, className }: { children: React.ReactNode; className?: string }) {
    return <p className={cn('text-[14px] leading-relaxed text-slate-600', className)}>{children}</p>;
}

export function UL({ children }: { children: React.ReactNode }) {
    return <ul className="list-disc pl-5 space-y-2 marker:text-slate-300">{children}</ul>;
}

export function Strong({ children }: { children: React.ReactNode }) {
    return <strong className="font-semibold text-slate-900">{children}</strong>;
}
