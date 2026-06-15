import Link from 'next/link';
import { MarketingShell } from '@/components/marketing/MarketingShell';
import { EYEBROW, H1, H3, LEAD, GLASS_CARD } from '@/components/marketing/typography';

export const metadata = {
    title: 'Blog — Prisfol',
    description: 'Product updates, workflow deep-dives and AI creative craft from the Prisfol team.',
};

interface Post {
    title: string;
    excerpt: string;
    date: string;
    tag: string;
    cover: string;
}

// Sample editorial content — swap for a CMS/MDX source later.
const POSTS: Post[] = [
    { title: 'Introducing the visual workflow engine', excerpt: 'Why we built Prisfol around a node graph instead of a single prompt box — and what that unlocks for image and video creators.', date: 'June 10, 2026', tag: 'Product', cover: 'https://images.unsplash.com/photo-1620641788421-7a1c342ea42e?auto=format&fit=crop&q=80&w=1200' },
    { title: 'Chaining frontier models on one canvas', excerpt: 'A practical guide to wiring generation, upscaling and background removal into a single repeatable pipeline.', date: 'June 3, 2026', tag: 'Guide', cover: 'https://images.unsplash.com/photo-1635776062127-d379bfcba9f8?auto=format&fit=crop&q=80&w=1200' },
    { title: 'From prompt to product photoshoot', excerpt: 'How brands use Prisfol use-case templates to render a full lookbook from a single product photo.', date: 'May 27, 2026', tag: 'Use case', cover: 'https://images.unsplash.com/photo-1547891654-e66ed7ebb968?auto=format&fit=crop&q=80&w=1200' },
    { title: 'The chat brain, explained', excerpt: 'A look under the hood at how plain-language requests become a wired, runnable workflow.', date: 'May 19, 2026', tag: 'Engineering', cover: 'https://images.unsplash.com/photo-1633957897986-70e83293f3ff?auto=format&fit=crop&q=80&w=1200' },
    { title: 'Designing for motion', excerpt: 'Bringing stills to life with frame interpolation, looping and video extension — without leaving the canvas.', date: 'May 12, 2026', tag: 'Craft', cover: 'https://images.unsplash.com/photo-1614624532983-4ce03382d63d?auto=format&fit=crop&q=80&w=1200' },
    { title: 'Credits, plans and how pricing works', excerpt: 'Everything you need to know about credit-based pricing, rollover and top-up packs.', date: 'May 5, 2026', tag: 'Company', cover: 'https://images.unsplash.com/photo-1620421680010-0766ff230392?auto=format&fit=crop&q=80&w=1200' },
];

export default function BlogPage() {
    return (
        <MarketingShell>
            <div className="max-w-7xl mx-auto px-6 md:px-8 py-12 md:py-20">
                <header className="mb-14 md:mb-20 space-y-4 max-w-2xl">
                    <span className={EYEBROW}><span className="h-1 w-1 rounded-full bg-accent-primary" /> Blog</span>
                    <h1 className={H1}>Notes from the canvas.</h1>
                    <p className={LEAD}>Product updates, workflow deep-dives and the craft of building with AI image and video models.</p>
                </header>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                    {POSTS.map((p) => (
                        <Link key={p.title} href="#" className={`${GLASS_CARD} flex flex-col`}>
                            <div className="relative aspect-[16/10] overflow-hidden">
                                <img src={p.cover} alt="" className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                                <div className="absolute inset-0 bg-gradient-to-t from-surface-secondary/80 to-transparent" />
                                <span className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-surface-primary/70 backdrop-blur border border-stroke-subtle/60 text-xs font-medium text-content-secondary">{p.tag}</span>
                            </div>
                            <div className="p-6 flex flex-col gap-3 flex-1">
                                <h3 className={H3}>{p.title}</h3>
                                <p className="text-sm text-content-secondary leading-relaxed flex-1">{p.excerpt}</p>
                                <p className="text-xs text-content-tertiary mt-2">{p.date}</p>
                            </div>
                        </Link>
                    ))}
                </div>
            </div>
        </MarketingShell>
    );
}
