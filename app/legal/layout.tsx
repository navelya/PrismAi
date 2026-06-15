import React from 'react';
import { MarketingShell } from '@/components/marketing/MarketingShell';

export const metadata = {
    title: 'Legal — Prisfol',
    description: 'Legal documents for the Prisfol platform.',
};

export default function LegalLayout({ children }: { children: React.ReactNode }) {
    return (
        <MarketingShell>
            <div className="max-w-3xl mx-auto px-6 md:px-8 py-12 md:py-20">
                {children}
            </div>
        </MarketingShell>
    );
}
