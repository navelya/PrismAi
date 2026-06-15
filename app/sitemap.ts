import type { MetadataRoute } from 'next';

// Sitemap of public, server-rendered marketing pages. All URLs are absolute on
// the canonical marketing host so verification bots / search crawlers discover
// the Terms, Privacy and Refund pages at their 200 location (the app host
// 308-redirects /legal/* cross-domain, which some bots refuse to follow).
const MARKETING_BASE = (process.env.NEXT_PUBLIC_MARKETING_URL || 'https://prisfol.com').replace(/\/$/, '');

const ROUTES: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]['changeFrequency'] }[] = [
    { path: '/', priority: 1.0, changeFrequency: 'weekly' },
    { path: '/pricing', priority: 0.8, changeFrequency: 'weekly' },
    { path: '/blog', priority: 0.6, changeFrequency: 'weekly' },
    { path: '/roadmap', priority: 0.6, changeFrequency: 'weekly' },
    { path: '/demo', priority: 0.6, changeFrequency: 'monthly' },
    { path: '/legal/privacy', priority: 0.5, changeFrequency: 'monthly' },
    { path: '/legal/terms', priority: 0.5, changeFrequency: 'monthly' },
    { path: '/legal/refund', priority: 0.5, changeFrequency: 'monthly' },
];

export default function sitemap(): MetadataRoute.Sitemap {
    return ROUTES.map(({ path, priority, changeFrequency }) => ({
        url: `${MARKETING_BASE}${path}`,
        changeFrequency,
        priority,
    }));
}
