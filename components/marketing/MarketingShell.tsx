import React from 'react';
import { MarketingHeader } from './MarketingHeader';
import { MarketingFooter } from './MarketingFooter';

// Shared dark chrome for every non-home marketing page (legal, blog, roadmap).
// The home page composes the header/footer itself (it needs the in-page
// #pricing/#faq anchors), so it does NOT use this shell.
export function MarketingShell({ children }: { children: React.ReactNode }) {
    return (
        <div className="relative min-h-screen w-full bg-surface-primary mesh-gradient text-content-primary overflow-x-clip">
            <MarketingHeader homeBaseHref="/" />
            <main className="relative z-10 pt-28 md:pt-32">{children}</main>
            <MarketingFooter />
        </div>
    );
}
