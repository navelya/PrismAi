import { MarketingShell } from '@/components/marketing/MarketingShell';
import { EYEBROW, H1, H3, LEAD, GLASS_CARD } from '@/components/marketing/typography';
import { CheckCircle2, CircleDot, Circle } from 'lucide-react';

export const metadata = {
    title: 'Roadmap — Prisfol',
    description: 'What we have shipped, what we are building now, and what is coming next on Prisfol.',
};

type Status = 'shipped' | 'in-progress' | 'planned';

interface Column {
    status: Status;
    label: string;
    icon: typeof CheckCircle2;
    accent: string;
    items: { title: string; desc: string }[];
}

const COLUMNS: Column[] = [
    {
        status: 'shipped',
        label: 'Shipped',
        icon: CheckCircle2,
        accent: 'text-accent-success',
        items: [
            { title: 'Chat-first workflow building', desc: 'Describe what you want and Prisfol wires the nodes and models for you.' },
            { title: 'Use-case templates', desc: 'Open a real workflow on the canvas and make it yours in one click.' },
            { title: 'Multi-provider generation', desc: 'Image, video and audio models from across the industry, with failover.' },
            { title: 'Compositor & timeline editor', desc: 'Layer, trim and render image and video compositions.' },
        ],
    },
    {
        status: 'in-progress',
        label: 'In progress',
        icon: CircleDot,
        accent: 'text-accent-primary',
        items: [
            { title: 'Team collaboration', desc: 'Shared workspaces and real-time collaboration on workflows.' },
            { title: 'Workflow versions & checkpoints', desc: 'Branch, restore and compare versions of any workflow.' },
            { title: 'Richer asset library', desc: 'Uploads, characters and generated results in one searchable place.' },
        ],
    },
    {
        status: 'planned',
        label: 'Planned',
        icon: Circle,
        accent: 'text-content-tertiary',
        items: [
            { title: 'Public API', desc: 'Run your saved workflows programmatically from your own apps.' },
            { title: 'Scheduled runs', desc: 'Trigger workflows on a schedule or from external events.' },
            { title: 'Mobile editing', desc: 'Full template and workflow editing on phones and tablets.' },
            { title: 'Marketplace', desc: 'Share and discover community-built workflows.' },
        ],
    },
];

export default function RoadmapPage() {
    return (
        <MarketingShell>
            <div className="max-w-7xl mx-auto px-6 md:px-8 py-12 md:py-20">
                <header className="mb-14 md:mb-20 space-y-4 max-w-2xl">
                    <span className={EYEBROW}><span className="h-1 w-1 rounded-full bg-accent-primary" /> Roadmap</span>
                    <h1 className={H1}>Where Prisfol is headed.</h1>
                    <p className={LEAD}>A living view of what we have shipped, what we are building now, and what is coming next.</p>
                </header>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {COLUMNS.map((col) => {
                        const Icon = col.icon;
                        return (
                            <div key={col.status} className="space-y-4">
                                <div className="flex items-center gap-2">
                                    <Icon className={`w-4 h-4 ${col.accent}`} />
                                    <h2 className="font-sans normal-case font-semibold text-content-primary text-lg">{col.label}</h2>
                                    <span className="ml-auto text-xs text-content-tertiary">{col.items.length}</span>
                                </div>
                                <div className="space-y-4">
                                    {col.items.map((it) => (
                                        <div key={it.title} className={`${GLASS_CARD} p-5`}>
                                            <h3 className={`${H3} text-base mb-1.5`}>{it.title}</h3>
                                            <p className="text-sm text-content-secondary leading-relaxed">{it.desc}</p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
        </MarketingShell>
    );
}
