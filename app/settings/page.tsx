'use client';

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
    Moon
} from 'lucide-react';

// =============================================================================
// SETTING COMPONENTS
// =============================================================================

interface SettingCardProps {
    icon: React.ReactNode;
    title: string;
    description: string;
    children: React.ReactNode;
    disabled?: boolean;
}

function SettingCard({ icon, title, description, children, disabled = false }: SettingCardProps) {
    return (
        <div className={`
            p-5 rounded-xl border transition-all duration-200
            ${disabled
                ? 'bg-surface-secondary border-stroke-subtle opacity-60 cursor-not-allowed'
                : 'bg-surface-primary border-stroke-subtle hover:border-accent-primary/30 hover:shadow-md'
            }
        `}>
            <div className="flex items-start gap-4">
                <div className={`
                    p-3 rounded-lg shrink-0
                    ${disabled ? 'bg-surface-tertiary text-content-tertiary' : 'bg-surface-tertiary text-accent-primary'}
                `}>
                    {icon}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <h3 className={`font-semibold ${disabled ? 'text-content-tertiary' : 'text-content-primary'}`}>
                            {title}
                        </h3>
                        {disabled && (
                            <span className="px-2 py-0.5 text-[10px] font-medium bg-surface-tertiary text-content-tertiary rounded-full">
                                Coming Soon
                            </span>
                        )}
                    </div>
                    <p className={`text-sm mt-1 ${disabled ? 'text-content-tertiary' : 'text-content-secondary'}`}>
                        {description}
                    </p>
                    <div className="mt-4">
                        {children}
                    </div>
                </div>
            </div>
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
                w-full p-3 rounded-lg border-2 text-left transition-all duration-200 flex items-center justify-between
                ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
                ${selected
                    ? 'border-accent-primary bg-accent-primary/5'
                    : 'border-stroke-subtle hover:border-stroke-strong bg-surface-primary'
                }
            `}
        >
            <div className="flex items-center gap-3">
                {icon && (
                    <div className={`${selected ? 'text-accent-primary' : 'text-content-secondary'}`}>
                        {icon}
                    </div>
                )}
                <div>
                    <div className={`font-medium text-sm ${selected ? 'text-accent-primary' : 'text-content-primary'}`}>
                        {label}
                    </div>
                    {description && (
                        <div className={`text-xs mt-0.5 ${selected ? 'text-accent-primary/80' : 'text-content-secondary'}`}>
                            {description}
                        </div>
                    )}
                </div>
            </div>
            {selected && (
                <div className="w-5 h-5 rounded-full bg-accent-primary flex items-center justify-center">
                    <Check className="w-3 h-3 text-content-inverted" />
                </div>
            )}
        </button>
    );
}

// =============================================================================
// MAIN SETTINGS PAGE
// =============================================================================

export default function SettingsPage() {
    // Theme State
    const { theme, setTheme } = useTheme();

    // Store State
    const layoutEngine = useAppStore((state) => state.layoutEngine);
    const setLayoutEngine = useAppStore((state) => state.setLayoutEngine);

    const layoutEngines = [
        {
            value: 'elk' as LayoutEngine,
            label: 'ELK',
            description: 'Best for minimizing edge crossings'
        },
        {
            value: 'dagre' as LayoutEngine,
            label: 'Dagre',
            description: 'Fast horizontal layouts'
        },
        {
            value: 'd3-hierarchy' as LayoutEngine,
            label: 'D3 Tree',
            description: 'Tree-based hierarchical layouts'
        },
    ];

    const themes = [
        { id: 'light', name: 'Light', icon: <Sun className="w-4 h-4" /> },
        { id: 'dark', name: 'Dark', icon: <Moon className="w-4 h-4" /> },
        { id: 'system', name: 'System', icon: <Monitor className="w-4 h-4" /> }
    ];

    return (
        <div className="w-full h-full overflow-auto bg-surface-secondary">
            <div className="max-w-3xl mx-auto py-12 px-6">
                {/* Header */}
                <div className="mb-10">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2.5 rounded-xl bg-gradient-premium text-white shadow-lg">
                            <Settings className="w-6 h-6" />
                        </div>
                        <h1 className="text-3xl font-bold text-content-primary">Settings</h1>
                    </div>
                    <p className="text-content-secondary ml-14">Configure your PrismAI preferences</p>
                </div>

                {/* Settings Sections */}
                <div className="space-y-6">
                    {/* Editor Section */}
                    <div>
                        <h2 className="text-sm font-semibold text-content-tertiary uppercase tracking-wider mb-4 flex items-center gap-2">
                            <span className="w-6 h-px bg-stroke-subtle"></span>
                            Editor
                            <span className="flex-1 h-px bg-stroke-subtle"></span>
                        </h2>
                        <div className="space-y-4">
                            {/* Layout Engine - ACTIVE */}
                            <SettingCard
                                icon={<Network className="w-5 h-5" />}
                                title="Layout Engine"
                                description="Choose the algorithm used for auto-arranging workflow nodes."
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

                            {/* Auto-save - DISABLED */}
                            <SettingCard
                                icon={<Database className="w-5 h-5" />}
                                title="Auto-save"
                                description="Automatically save your workflow changes."
                                disabled
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-11 h-6 bg-surface-tertiary rounded-full relative">
                                        <div className="w-5 h-5 bg-content-tertiary rounded-full absolute left-0.5 top-0.5"></div>
                                    </div>
                                    <span className="text-sm text-content-tertiary">Disabled</span>
                                </div>
                            </SettingCard>
                        </div>
                    </div>

                    {/* Appearance Section */}
                    <div>
                        <h2 className="text-sm font-semibold text-content-tertiary uppercase tracking-wider mb-4 flex items-center gap-2">
                            <span className="w-6 h-px bg-stroke-subtle"></span>
                            Appearance
                            <span className="flex-1 h-px bg-stroke-subtle"></span>
                        </h2>
                        <div className="space-y-4">
                            {/* Theme - ACTIVE */}
                            <SettingCard
                                icon={<Palette className="w-5 h-5" />}
                                title="Theme"
                                description="Choose between light and dark mode."
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
                        <h2 className="text-sm font-semibold text-content-tertiary uppercase tracking-wider mb-4 flex items-center gap-2">
                            <span className="w-6 h-px bg-stroke-subtle"></span>
                            Performance
                            <span className="flex-1 h-px bg-stroke-subtle"></span>
                        </h2>
                        <div className="space-y-4">
                            {/* Hardware Acceleration - DISABLED */}
                            <SettingCard
                                icon={<Zap className="w-5 h-5" />}
                                title="Hardware Acceleration"
                                description="Use GPU acceleration for image processing tasks."
                                disabled
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-11 h-6 bg-surface-tertiary rounded-full relative">
                                        <div className="w-5 h-5 bg-content-tertiary rounded-full absolute left-0.5 top-0.5"></div>
                                    </div>
                                    <span className="text-sm text-content-tertiary">Disabled</span>
                                </div>
                            </SettingCard>
                        </div>
                    </div>

                    {/* Notifications Section */}
                    <div>
                        <h2 className="text-sm font-semibold text-content-tertiary uppercase tracking-wider mb-4 flex items-center gap-2">
                            <span className="w-6 h-px bg-stroke-subtle"></span>
                            Notifications
                            <span className="flex-1 h-px bg-stroke-subtle"></span>
                        </h2>
                        <div className="space-y-4">
                            {/* Workflow Notifications - DISABLED */}
                            <SettingCard
                                icon={<Bell className="w-5 h-5" />}
                                title="Workflow Notifications"
                                description="Get notified when workflow execution completes."
                                disabled
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-11 h-6 bg-surface-tertiary rounded-full relative">
                                        <div className="w-5 h-5 bg-content-tertiary rounded-full absolute left-0.5 top-0.5"></div>
                                    </div>
                                    <span className="text-sm text-content-tertiary">Disabled</span>
                                </div>
                            </SettingCard>
                        </div>
                    </div>

                    {/* Privacy Section */}
                    <div>
                        <h2 className="text-sm font-semibold text-content-tertiary uppercase tracking-wider mb-4 flex items-center gap-2">
                            <span className="w-6 h-px bg-stroke-subtle"></span>
                            Privacy & Data
                            <span className="flex-1 h-px bg-stroke-subtle"></span>
                        </h2>
                        <div className="space-y-4">
                            {/* Analytics - DISABLED */}
                            <SettingCard
                                icon={<Shield className="w-5 h-5" />}
                                title="Usage Analytics"
                                description="Help improve PrismAI by sharing anonymous usage data."
                                disabled
                            >
                                <div className="flex items-center gap-3">
                                    <div className="w-11 h-6 bg-surface-tertiary rounded-full relative">
                                        <div className="w-5 h-5 bg-content-tertiary rounded-full absolute left-0.5 top-0.5"></div>
                                    </div>
                                    <span className="text-sm text-content-tertiary">Disabled</span>
                                </div>
                            </SettingCard>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="mt-12 pt-6 border-t border-stroke-subtle text-center">
                    <p className="text-sm text-content-tertiary">
                        PrismAI v1.0.0 • More settings coming soon
                    </p>
                </div>
            </div>
        </div>
    );
}
