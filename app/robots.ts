import type { MetadataRoute } from 'next';

// Crawler policy. Served at /robots.txt on whichever host requests it. We point
// crawlers (incl. payment-provider verification bots that fetch Terms/Privacy/
// Refund) at the canonical marketing host, where every public page — including
// /legal/* — returns 200 directly with no cross-host redirect. The app host
// (app.prisfol.com) only carries auth-gated surfaces, so /admin and /api are
// disallowed everywhere.
const MARKETING_BASE = (process.env.NEXT_PUBLIC_MARKETING_URL || 'https://prisfol.com').replace(/\/$/, '');

export default function robots(): MetadataRoute.Robots {
    return {
        rules: [
            {
                userAgent: '*',
                allow: '/',
                disallow: ['/admin', '/api/'],
            },
        ],
        sitemap: `${MARKETING_BASE}/sitemap.xml`,
        host: MARKETING_BASE,
    };
}
