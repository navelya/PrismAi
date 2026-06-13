'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import { Analytics } from '@vercel/analytics/next';
import { SpeedInsights } from '@vercel/speed-insights/next';
import { Cookie, X } from 'lucide-react';
import { marketingUrl } from '@/lib/domains';

const STORAGE_KEY = 'prism-cookie-consent';
type Choice = 'accepted' | 'rejected';

function readChoice(): Choice | null {
    if (typeof window === 'undefined') return null;
    try {
        const value = window.localStorage.getItem(STORAGE_KEY);
        return value === 'accepted' || value === 'rejected' ? value : null;
    } catch {
        return null;
    }
}

function writeChoice(choice: Choice) {
    try {
        window.localStorage.setItem(STORAGE_KEY, choice);
    } catch {
        // ignore — user has storage disabled, the banner will reappear next visit
    }
}

export function CookieConsent() {
    const [choice, setChoice] = useState<Choice | null>(null);
    const [hydrated, setHydrated] = useState(false);

    useEffect(() => {
        setChoice(readChoice());
        setHydrated(true);

        const handler = () => setChoice(readChoice());
        window.addEventListener('storage', handler);
        window.addEventListener('prism:cookie-consent-change', handler);
        return () => {
            window.removeEventListener('storage', handler);
            window.removeEventListener('prism:cookie-consent-change', handler);
        };
    }, []);

    const handleAccept = () => {
        writeChoice('accepted');
        setChoice('accepted');
        window.dispatchEvent(new Event('prism:cookie-consent-change'));
    };

    const handleReject = () => {
        writeChoice('rejected');
        setChoice('rejected');
        window.dispatchEvent(new Event('prism:cookie-consent-change'));
    };

    return (
        <>
            {choice === 'accepted' && (
                <>
                    <Analytics />
                    <SpeedInsights />
                </>
            )}

            <AnimatePresence>
                {hydrated && choice === null && (
                    <motion.div
                        key="cookie-banner"
                        initial={{ opacity: 0, y: 24 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 24 }}
                        transition={{ type: 'spring', damping: 24, stiffness: 280 }}
                        role="dialog"
                        aria-live="polite"
                        aria-label="Cookie preferences"
                        className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 z-[200] sm:max-w-md"
                    >
                        <div className="rounded-2xl border border-slate-200 bg-white shadow-2xl p-5 sm:p-6 flex flex-col gap-4">
                            <div className="flex items-start gap-3">
                                <div className="flex-shrink-0 w-9 h-9 rounded-xl bg-slate-900 flex items-center justify-center">
                                    <Cookie className="w-4 h-4 text-white" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h2 className="text-sm font-bold text-slate-900 mb-1">Cookies on Prisfol</h2>
                                    <p className="text-[12px] leading-relaxed text-slate-500">
                                        We use cookies that are required to sign you in and run the app. With your consent
                                        we also use anonymized analytics to understand how Prisfol is used and to improve
                                        performance. Read our{' '}
                                        <Link href={marketingUrl('/legal/privacy')} className="text-accent-primary hover:underline">
                                            Privacy Policy
                                        </Link>.
                                    </p>
                                </div>
                                <button
                                    type="button"
                                    onClick={handleReject}
                                    aria-label="Reject non-essential cookies"
                                    className="flex-shrink-0 -mt-1 -mr-1 p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100 transition-colors"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                            <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
                                <button
                                    type="button"
                                    onClick={handleReject}
                                    className="px-4 py-2 rounded-lg border border-slate-200 text-[11px] font-bold uppercase tracking-wider text-slate-600 hover:bg-slate-50 transition-colors"
                                >
                                    Reject
                                </button>
                                <button
                                    type="button"
                                    onClick={handleAccept}
                                    className="px-4 py-2 rounded-lg bg-slate-900 text-white text-[11px] font-bold uppercase tracking-wider hover:bg-slate-800 transition-colors"
                                >
                                    Accept all
                                </button>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </>
    );
}
