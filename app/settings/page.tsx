'use client';

import { useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAppStore } from '@/lib/store/app-store';
import { useTheme } from '@/components/theme/ThemeProvider';
import { LayoutEngine } from '@/lib/utils/graph-layout';
import {
    Settings,
    Network,
    Palette,
    Bell,
    Shield,
    Database,
    Zap,
    Check,
    Monitor,
    Sun,
    Moon,
    User,
    Lock,
    CreditCard,
    Coins,
    KeyRound,
    Plug,
    ChevronRight,
    ArrowLeft,
} from 'lucide-react';

// =============================================================================
// TYPES
// =============================================================================

type TabId =
    | 'profile'
    | 'security'
    | 'editor-appearance'
    | 'notifications'
    | 'plan-billing'
    | 'usage'
    | 'api-keys'
    | 'integrations';

interface NavItem {
    id: TabId;
    label: string;
    icon: React.ReactNode;
    comingSoon?: boolean;
}

interface NavSection {
    title: string;
    items: NavItem[];
}

// =============================================================================
// NAVIGATION CONFIG
// =============================================================================

const navSections: NavSection[] = [
    {
        title: 'Account',
        items: [
            { id: 'profile', label: 'Public Profile', icon: <User className="w-4 h-4" />, comingSoon: true },
            { id: 'security', label: 'Security', icon: <Lock className="w-4 h-4" />, comingSoon: true },
        ],
    },
    {
        title: 'Workspace',
        items: [
            { id: 'editor-appearance', label: 'Editor & Appearance', icon: <Palette className="w-4 h-4" /> },
            { id: 'notifications', label: 'Notifications', icon: <Bell className="w-4 h-4" />, comingSoon: true },
        ],
    },
    {
        title: 'Usage & Billing',
        items: [
            { id: 'plan-billing', label: 'Plan & Billing', icon: <CreditCard className="w-4 h-4" />, comingSoon: true },
            { id: 'usage', label: 'Token / Credit Usage', icon: <Coins className="w-4 h-4" />, comingSoon: true },
        ],
    },
    {
        title: 'Developer',
        items: [
            { id: 'api-keys', label: 'API Keys', icon: <KeyRound className="w-4 h-4" />, comingSoon: true },
            { id: 'integrations', label: 'Integrations', icon: <Plug className="w-4 h-4" />, comingSoon: true },
        ],
    },
];

// =============================================================================
// SHARED SETTING COMPONENTS (preserved exactly from original)
// =============================================================================

interface SettingCardProps {
    title: string;
    description: string;
    children: React.ReactNode;
    disabled?: boolean;
    layout?: 'stacked' | 'inline';
}

function SettingCard({ title, description, children, disabled = false, layout = 'stacked' }: SettingCardProps) {
    return (
        <div className={`
            py-8 border-b border-stroke-subtle last:border-0 transition-all duration-200
            ${disabled ? 'opacity-50 grayscale-[0.5] pointer-events-none' : ''}
        `}>
            {layout === 'stacked' ? (
                <div className="flex flex-col gap-4">
                    <div>
                        <div className="flex items-center gap-3">
                            <h3 className="font-medium text-content-primary">{title}</h3>
                            {disabled && (
                                <span className="px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase bg-surface-secondary border border-stroke-subtle text-content-tertiary rounded-full">
                                    Soon
                                </span>
                            )}
                        </div>
                        <p className="text-sm mt-1 text-content-secondary">{description}</p>
                    </div>
                    <div className="w-full">
                        {children}
                    </div>
                </div>
            ) : (
                <div className="flex items-start sm:items-center justify-between gap-6">
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3">
                            <h3 className="font-medium text-content-primary">{title}</h3>
                            {disabled && (
                                <span className="px-2 py-0.5 text-[10px] font-semibold tracking-wide uppercase bg-surface-secondary border border-stroke-subtle text-content-tertiary rounded-full">
                                    Soon
                                </span>
                            )}
                        </div>
                        <p className="text-sm mt-1 text-content-secondary">{description}</p>
                    </div>
                    <div className="shrink-0 mt-2 sm:mt-0">
                        {children}
                    </div>
                </div>
            )}
        </div>
    );
}

interface SelectOptionProps {
    value?: string;
    label: string;
    description?: string;
    selected: boolean;
    disabled?: boolean;
    onSelect: () => void;
    icon?: React.ReactNode;
}

function SelectOption({ value, label, description, selected, disabled, onSelect, icon }: SelectOptionProps) {
    return (
        <button
            onClick={onSelect}
            disabled={disabled}
            className={`
                w-full p-3 py-3.5 rounded-lg border-2 text-left transition-all duration-200 flex items-start gap-3 justify-between
                ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
                ${selected
                    ? 'border-accent-primary bg-accent-primary/5'
                    : 'border-stroke-subtle hover:border-stroke-strong bg-surface-primary'
                }
            `}
        >
            <div className="flex items-start gap-3 min-w-0 flex-1">
                {icon && (
                    <div className={`shrink-0 mt-0.5 ${selected ? 'text-accent-primary' : 'text-content-secondary'}`}>
                        {icon}
                    </div>
                )}
                <div className="min-w-0">
                    <div className={`font-medium text-sm ${selected ? 'text-accent-primary' : 'text-content-primary'}`}>
                        {label}
                    </div>
                    {description && (
                        <div className={`text-xs mt-1 leading-relaxed ${selected ? 'text-accent-primary/80' : 'text-content-secondary'}`}>
                            {description}
                        </div>
                    )}
                </div>
            </div>
            {/* Always render a 20x20 slot so text wrapping doesn't change upon selection */}
            {selected ? (
                <div className="w-5 h-5 shrink-0 rounded-full bg-accent-primary flex items-center justify-center mt-0.5 shadow-sm">
                    <Check className="w-3 h-3 text-content-inverted" strokeWidth={3} />
                </div>
            ) : (
                <div className="w-5 h-5 shrink-0" />
            )}
        </button>
    );
}

// =============================================================================
// COMING SOON PLACEHOLDER
// =============================================================================

function ComingSoonView({ title, description }: { title: string; description: string }) {
    return (
        <div className="flex flex-col items-center justify-center py-20 text-center">
            <div className="w-16 h-16 rounded-2xl bg-surface-tertiary flex items-center justify-center mb-5">
                <Lock className="w-7 h-7 text-content-tertiary" />
            </div>
            <h3 className="text-xl font-semibold text-content-primary mb-2">{title}</h3>
            <p className="text-content-secondary text-sm max-w-sm">{description}</p>
            <span className="mt-4 px-3 py-1 text-xs font-medium bg-surface-tertiary text-content-tertiary rounded-full">
                Planned for a future update
            </span>
        </div>
    );
}

// =============================================================================
// TAB CONTENT VIEWS
// =============================================================================

function EditorAppearanceView() {
    const { theme, setTheme } = useTheme();
    const layoutEngine = useAppStore((state) => state.layoutEngine);
    const setLayoutEngine = useAppStore((state) => state.setLayoutEngine);

    const layoutEngines = [
        { value: 'elk' as LayoutEngine, label: 'ELK', description: 'Best for minimizing edge crossings' },
        { value: 'dagre' as LayoutEngine, label: 'Dagre', description: 'Fast horizontal layouts' },
        { value: 'd3-hierarchy' as LayoutEngine, label: 'D3 Tree', description: 'Tree-based hierarchical layouts' },
    ];

    const themes = [
        { id: 'light', name: 'Light', icon: <Sun className="w-4 h-4" /> },
        { id: 'dark', name: 'Dark', icon: <Moon className="w-4 h-4" /> },
        { id: 'system', name: 'System', icon: <Monitor className="w-4 h-4" /> },
    ];

    return (
        <div className="space-y-12">
            {/* Editor Section */}
            <div>
                <h2 className="text-xs font-semibold text-content-tertiary tracking-wider mb-6">
                    EDITOR
                </h2>
                <div className="flex flex-col">
                    <SettingCard
                        title="Layout Engine"
                        description="Choose the algorithm used for auto-arranging workflow nodes."
                        layout="stacked"
                    >
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            {layoutEngines.map((engine) => (
                                <SelectOption
                                    key={engine.value}
                                    value={engine.value}
                                    label={engine.label}
                                    description={engine.description}
                                    selected={layoutEngine === engine.value}
                                    onSelect={() => setLayoutEngine(engine.value)}
                                />
                            ))}
                        </div>
                    </SettingCard>

                    <SettingCard
                        title="Auto-save"
                        description="Automatically save your workflow changes."
                        layout="inline"
                        disabled
                    >
                        <div className="w-11 h-6 bg-surface-tertiary rounded-full relative">
                            <div className="w-5 h-5 bg-content-tertiary rounded-full absolute left-0.5 top-0.5"></div>
                        </div>
                    </SettingCard>
                </div>
            </div>

            {/* Appearance Section */}
            <div>
                <h2 className="text-xs font-semibold text-content-tertiary tracking-wider mb-6">
                    APPEARANCE
                </h2>
                <div className="flex flex-col">
                    <SettingCard
                        title="Theme"
                        description="Choose between light and dark mode."
                        layout="stacked"
                    >
                        <div className="grid grid-cols-3 gap-3">
                            {themes.map((t) => (
                                <SelectOption
                                    key={t.id}
                                    label={t.name}
                                    selected={theme === t.id}
                                    onSelect={() => setTheme(t.id as any)}
                                    icon={t.icon}
                                />
                            ))}
                        </div>
                    </SettingCard>
                </div>
            </div>

            {/* Performance Section */}
            <div>
                <h2 className="text-xs font-semibold text-content-tertiary tracking-wider mb-6">
                    PERFORMANCE
                </h2>
                <div className="flex flex-col">
                    <SettingCard
                        title="Hardware Acceleration"
                        description="Use GPU acceleration for image processing tasks."
                        layout="inline"
                        disabled
                    >
                        <div className="w-11 h-6 bg-surface-tertiary rounded-full relative">
                            <div className="w-5 h-5 bg-content-tertiary rounded-full absolute left-0.5 top-0.5"></div>
                        </div>
                    </SettingCard>

                    <SettingCard
                        title="Usage Analytics"
                        description="Help improve PrismAI by sharing anonymous usage data."
                        layout="inline"
                        disabled
                    >
                        <div className="w-11 h-6 bg-surface-tertiary rounded-full relative">
                            <div className="w-5 h-5 bg-content-tertiary rounded-full absolute left-0.5 top-0.5"></div>
                        </div>
                    </SettingCard>
                </div>
            </div>
        </div>
    );
}

// =============================================================================
// TAB CONTENT MAP
// =============================================================================

const comingSoonDescriptions: Record<string, { title: string; description: string }> = {
    profile: { title: 'Public Profile', description: 'Manage your display name, avatar, and bio visible across the platform.' },
    security: { title: 'Security', description: 'Configure two-factor authentication, manage sessions, and update your password.' },
    notifications: { title: 'Notifications', description: 'Control how and when you receive workflow completion alerts and system updates.' },
    'plan-billing': { title: 'Plan & Billing', description: 'View your current plan, manage subscriptions, and update payment methods.' },
    usage: { title: 'Token / Credit Usage', description: 'Monitor your API token consumption, credit balance, and usage history.' },
    'api-keys': { title: 'API Keys', description: 'Generate and manage API keys for programmatic access to PrismAI.' },
    integrations: { title: 'Integrations', description: 'Connect third-party services like Slack, GitHub, and cloud storage providers.' },
};

// =============================================================================
// MAIN SETTINGS PAGE
// =============================================================================

export default function SettingsPage() {
    const searchParams = useSearchParams();
    const router = useRouter();

    const validTabs: TabId[] = ['profile', 'security', 'editor-appearance', 'notifications', 'plan-billing', 'usage', 'api-keys', 'integrations'];
    const tabParam = searchParams.get('tab') as TabId | null;
    const activeTab: TabId = tabParam && validTabs.includes(tabParam) ? tabParam : 'editor-appearance';

    const [mobileShowContent, setMobileShowContent] = useState(false);

    const handleTabSelect = (id: TabId) => {
        router.replace(`/settings?tab=${id}`, { scroll: false });
        setMobileShowContent(true);
    };

    const renderContent = () => {
        if (activeTab === 'editor-appearance') {
            return <EditorAppearanceView />;
        }

        const info = comingSoonDescriptions[activeTab];
        if (info) {
            return <ComingSoonView title={info.title} description={info.description} />;
        }

        return null;
    };

    // Find the currently selected nav item for the header
    const activeItem = navSections.flatMap(s => s.items).find(i => i.id === activeTab);

    return (
        <div className="w-full h-full flex bg-surface-secondary">
            {/* Sidebar Navigation — full width on mobile, fixed 264px on desktop */}
            <aside className={`
                md:w-64 md:shrink-0 md:border-r md:border-stroke-subtle md:bg-surface-primary md:overflow-y-auto md:block
                ${mobileShowContent ? 'hidden' : 'w-full bg-surface-primary overflow-y-auto'}
            `}>
                <div className="p-6">
                    <div className="flex items-center gap-3 mb-8">
                        <div className="p-2 rounded-xl bg-gradient-premium text-white shadow-lg">
                            <Settings className="w-5 h-5" />
                        </div>
                        <h1 className="text-lg font-bold text-content-primary">Settings</h1>
                    </div>

                    <nav className="space-y-6">
                        {navSections.map((section) => (
                            <div key={section.title}>
                                <h3 className="text-[11px] font-semibold text-content-tertiary uppercase tracking-wider mb-2 px-3">
                                    {section.title}
                                </h3>
                                <div className="space-y-0.5">
                                    {section.items.map((item) => (
                                        <button
                                            key={item.id}
                                            onClick={() => handleTabSelect(item.id)}
                                            className={`
                                                w-full flex items-center gap-3 px-3 py-2.5 md:py-2 rounded-lg text-sm transition-all duration-150
                                                ${activeTab === item.id
                                                    ? 'bg-accent-primary/10 text-accent-primary font-medium'
                                                    : 'text-content-secondary hover:bg-surface-tertiary hover:text-content-primary'
                                                }
                                            `}
                                        >
                                            <span className={`shrink-0 ${activeTab === item.id ? 'text-accent-primary' : 'text-content-tertiary'}`}>
                                                {item.icon}
                                            </span>
                                            <span className="flex-1 text-left truncate">{item.label}</span>
                                            {item.comingSoon && (
                                                <span className="px-1.5 py-0.5 text-[9px] font-medium bg-surface-tertiary text-content-tertiary rounded-full shrink-0">
                                                    Soon
                                                </span>
                                            )}
                                            <ChevronRight className={`w-3.5 h-3.5 shrink-0 md:hidden text-content-tertiary`} />
                                            {!item.comingSoon && activeTab === item.id && (
                                                <ChevronRight className="w-3.5 h-3.5 text-accent-primary shrink-0 hidden md:block" />
                                            )}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </nav>
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-stroke-subtle mt-4">
                    <p className="text-[11px] text-content-tertiary text-center">
                        PrismAI v1.0.0
                    </p>
                </div>
            </aside>

            {/* Main Content Area — hidden on mobile until a tab is selected */}
            <main className={`
                flex-1 overflow-y-auto
                ${mobileShowContent ? 'block' : 'hidden md:block'}
            `}>
                <div className="max-w-3xl mx-auto py-6 md:py-10 px-4 md:px-8">
                    {/* Mobile Back Button + Header */}
                    {activeItem && (
                        <div className="mb-8">
                            <button
                                onClick={() => setMobileShowContent(false)}
                                className="md:hidden flex items-center gap-2 text-sm text-content-secondary hover:text-content-primary mb-4 transition-colors"
                            >
                                <ArrowLeft className="w-4 h-4" />
                                <span>Back to Settings</span>
                            </button>
                            <h2 className="text-2xl font-bold text-content-primary">{activeItem.label}</h2>
                        </div>
                    )}

                    {/* Dynamic Content */}
                    {renderContent()}
                </div>
            </main>
        </div>
    );
}
