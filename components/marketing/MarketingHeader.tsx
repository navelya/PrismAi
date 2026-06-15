'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Menu, X } from 'lucide-react';
import { Logo } from '@/components/ui/Logo';
import { cn } from '@/lib/utils';
import { appUrl } from '@/lib/domains';

// Resources dropdown items — the legal docs live on the marketing host, so plain
// relative paths are correct.
const RESOURCES: { label: string; href: string }[] = [
    { label: 'Privacy Policy', href: '/legal/privacy' },
    { label: 'Terms of Service', href: '/legal/terms' },
    { label: 'Refunds', href: '/legal/refund' },
];

const navLink =
    'text-sm font-medium text-content-secondary hover:text-content-primary transition-colors';

interface MarketingHeaderProps {
    // '' when rendered on the home page (so #pricing/#faq scroll in-page), '/'
    // on every other page (so they jump back to the home section).
    homeBaseHref?: string;
}

export function MarketingHeader({ homeBaseHref = '' }: MarketingHeaderProps) {
    const [scrolled, setScrolled] = useState(false);
    const [resourcesOpen, setResourcesOpen] = useState(false);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [drawerResources, setDrawerResources] = useState(false);
    const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 60);
        onScroll();
        window.addEventListener('scroll', onScroll);
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    // Lock body scroll while the mobile drawer is open.
    useEffect(() => {
        if (!drawerOpen) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = prev; };
    }, [drawerOpen]);

    const pricingHref = `${homeBaseHref}#pricing`;
    const faqHref = `${homeBaseHref}#faq`;

    const openResources = () => {
        if (closeTimer.current) clearTimeout(closeTimer.current);
        setResourcesOpen(true);
    };
    const scheduleCloseResources = () => {
        if (closeTimer.current) clearTimeout(closeTimer.current);
        closeTimer.current = setTimeout(() => setResourcesOpen(false), 120);
    };

    return (
        <>
            <motion.nav
                initial={{ y: -20, x: '-50%', opacity: 0 }}
                animate={{ y: 0, x: '-50%', opacity: 1 }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
                className={cn(
                    'fixed top-4 left-1/2 z-50 w-[calc(100%-2rem)] max-w-5xl rounded-2xl transition-all duration-300',
                    scrolled
                        ? 'bg-surface-secondary/70 backdrop-blur-xl border border-stroke-subtle/70 shadow-[0_8px_32px_rgba(0,0,0,0.4)]'
                        : 'bg-transparent border border-transparent'
                )}
            >
                <div className="px-5 py-3 flex items-center justify-between">
                    <Link href={homeBaseHref || '/'} aria-label="Prisfol home" className="shrink-0">
                        <Logo variant="wordmark" className="h-7 w-auto text-content-primary" />
                    </Link>

                    {/* Desktop nav */}
                    <div className="hidden md:flex items-center gap-8">
                        <Link href={pricingHref} className={navLink}>Pricing</Link>

                        {/* Resources dropdown */}
                        <div
                            className="relative"
                            onMouseEnter={openResources}
                            onMouseLeave={scheduleCloseResources}
                        >
                            <button
                                type="button"
                                className={cn(navLink, 'inline-flex items-center gap-1')}
                                aria-haspopup="menu"
                                aria-expanded={resourcesOpen}
                                onClick={() => setResourcesOpen((v) => !v)}
                            >
                                Resources
                                <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', resourcesOpen && 'rotate-180')} />
                            </button>
                            <AnimatePresence>
                                {resourcesOpen && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -6, scale: 0.97 }}
                                        animate={{ opacity: 1, y: 0, scale: 1 }}
                                        exit={{ opacity: 0, y: -6, scale: 0.97 }}
                                        transition={{ duration: 0.14, ease: 'easeOut' }}
                                        className="absolute right-0 top-full mt-2 w-52 rounded-xl border border-stroke-subtle bg-surface-elevated/95 backdrop-blur-xl p-1.5 shadow-2xl"
                                        role="menu"
                                    >
                                        {RESOURCES.map((r) => (
                                            <Link
                                                key={r.href}
                                                href={r.href}
                                                role="menuitem"
                                                className="block px-3 py-2 rounded-lg text-sm text-content-secondary hover:bg-interactive-hover hover:text-content-primary transition-colors"
                                            >
                                                {r.label}
                                            </Link>
                                        ))}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>

                        <Link href="/blog" className={navLink}>Blog</Link>
                        <Link href="/roadmap" className={navLink}>Roadmap</Link>
                        <Link href={faqHref} className={navLink}>FAQ</Link>
                    </div>

                    {/* CTA + mobile trigger */}
                    <div className="flex items-center gap-2.5">
                        <Link
                            href={appUrl('/')}
                            className="px-4 py-2 rounded-xl bg-accent-primary text-surface-primary text-sm font-semibold hover:brightness-110 transition-all"
                        >
                            Start Free
                        </Link>
                        <button
                            type="button"
                            onClick={() => setDrawerOpen(true)}
                            aria-label="Open menu"
                            className="md:hidden h-11 w-11 grid place-items-center rounded-xl text-content-primary hover:bg-interactive-hover transition-colors"
                        >
                            <Menu className="w-5 h-5" />
                        </button>
                    </div>
                </div>
            </motion.nav>

            {/* Mobile drawer */}
            <AnimatePresence>
                {drawerOpen && (
                    <div className="md:hidden">
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.25 }}
                            onClick={() => setDrawerOpen(false)}
                            className="fixed inset-0 z-50 bg-surface-primary/60 backdrop-blur-sm"
                        />
                        <motion.div
                            initial={{ x: '100%' }}
                            animate={{ x: 0 }}
                            exit={{ x: '100%' }}
                            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
                            className="fixed right-0 top-0 z-50 h-[100dvh] w-[80%] max-w-sm bg-surface-secondary border-l border-stroke-subtle p-6 flex flex-col"
                        >
                            <div className="flex items-center justify-between mb-8">
                                <Logo variant="wordmark" className="h-6 w-auto text-content-primary" />
                                <button
                                    type="button"
                                    onClick={() => setDrawerOpen(false)}
                                    aria-label="Close menu"
                                    className="h-11 w-11 grid place-items-center rounded-xl text-content-primary hover:bg-interactive-hover transition-colors"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <nav className="flex flex-col">
                                <Link onClick={() => setDrawerOpen(false)} href={pricingHref} className="py-3 text-base font-medium text-content-secondary hover:text-content-primary transition-colors">Pricing</Link>

                                <button
                                    type="button"
                                    onClick={() => setDrawerResources((v) => !v)}
                                    className="py-3 flex items-center justify-between text-base font-medium text-content-secondary hover:text-content-primary transition-colors"
                                >
                                    Resources
                                    <ChevronDown className={cn('w-4 h-4 transition-transform', drawerResources && 'rotate-180')} />
                                </button>
                                <AnimatePresence initial={false}>
                                    {drawerResources && (
                                        <motion.div
                                            initial={{ height: 0, opacity: 0 }}
                                            animate={{ height: 'auto', opacity: 1 }}
                                            exit={{ height: 0, opacity: 0 }}
                                            transition={{ duration: 0.2 }}
                                            className="overflow-hidden pl-4"
                                        >
                                            {RESOURCES.map((r) => (
                                                <Link
                                                    key={r.href}
                                                    onClick={() => setDrawerOpen(false)}
                                                    href={r.href}
                                                    className="block py-2.5 text-sm text-content-tertiary hover:text-content-primary transition-colors"
                                                >
                                                    {r.label}
                                                </Link>
                                            ))}
                                        </motion.div>
                                    )}
                                </AnimatePresence>

                                <Link onClick={() => setDrawerOpen(false)} href="/blog" className="py-3 text-base font-medium text-content-secondary hover:text-content-primary transition-colors">Blog</Link>
                                <Link onClick={() => setDrawerOpen(false)} href="/roadmap" className="py-3 text-base font-medium text-content-secondary hover:text-content-primary transition-colors">Roadmap</Link>
                                <Link onClick={() => setDrawerOpen(false)} href={faqHref} className="py-3 text-base font-medium text-content-secondary hover:text-content-primary transition-colors">FAQ</Link>
                            </nav>

                            <Link
                                href={appUrl('/')}
                                onClick={() => setDrawerOpen(false)}
                                className="mt-auto px-4 py-3 rounded-xl bg-accent-primary text-surface-primary text-sm font-semibold text-center hover:brightness-110 transition-all"
                            >
                                Start Free
                            </Link>
                        </motion.div>
                    </div>
                )}
            </AnimatePresence>
        </>
    );
}
