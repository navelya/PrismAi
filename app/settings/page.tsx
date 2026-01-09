'use client';

import { useAppStore } from '@/lib/store/app-store';
import { LayoutEngine } from '@/lib/utils/graph-layout';
import {
    Settings,
    Network,
    Palette,
    Bell,
    Shield,
    Database,
    Zap,
    ChevronRight,
    Check
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
                ? 'bg-gray-50 border-gray-200 opacity-60 cursor-not-allowed'
                : 'bg-white border-gray-200 hover:border-purple-200 hover:shadow-md'
            }
        `}>
            <div className="flex items-start gap-4">
                <div className={`
                    p-3 rounded-lg shrink-0
                    ${disabled ? 'bg-gray-100 text-gray-400' : 'bg-purple-50 text-purple-600'}
                `}>
                    {icon}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                        <h3 className={`font-semibold ${disabled ? 'text-gray-400' : 'text-gray-900'}`}>
                            {title}
                        </h3>
                        {disabled && (
                            <span className="px-2 py-0.5 text-[10px] font-medium bg-gray-200 text-gray-500 rounded-full">
                                Coming Soon
                            </span>
                        )}
                    </div>
                    <p className={`text-sm mt-1 ${disabled ? 'text-gray-400' : 'text-gray-600'}`}>
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
    value: string;
    label: string;
    description: string;
    selected: boolean;
    disabled?: boolean;
    onSelect: () => void;
}

function SelectOption({ value, label, description, selected, disabled, onSelect }: SelectOptionProps) {
    return (
        <button
            onClick={onSelect}
            disabled={disabled}
            className={`
                w-full p-3 rounded-lg border-2 text-left transition-all duration-200
                ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}
                ${selected
                    ? 'border-purple-500 bg-purple-50'
                    : 'border-gray-200 hover:border-gray-300 bg-white'
                }
            `}
        >
            <div className="flex items-center justify-between">
                <div>
                    <div className={`font-medium text-sm ${selected ? 'text-purple-700' : 'text-gray-900'}`}>
                        {label}
                    </div>
                    <div className={`text-xs mt-0.5 ${selected ? 'text-purple-600' : 'text-gray-500'}`}>
                        {description}
                    </div>
                </div>
                {selected && (
                    <div className="w-5 h-5 rounded-full bg-purple-500 flex items-center justify-center">
                        <Check className="w-3 h-3 text-white" />
                    </div>
                )}
            </div>
        </button>
    );
}

// =============================================================================
// MAIN SETTINGS PAGE
// =============================================================================

export default function SettingsPage() {
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

    return (
        <div className="w-full h-full overflow-auto bg-gradient-to-br from-gray-50 to-gray-100">
            <div className="max-w-3xl mx-auto py-12 px-6">
                {/* Header */}
                <div className="mb-10">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="p-2.5 rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 text-white shadow-lg">
                            <Settings className="w-6 h-6" />
                        </div>
                        <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
                    </div>
                    <p className="text-gray-600 ml-14">Configure your PrismAI preferences</p>
                </div>

                {/* Settings Sections */}
                <div className="space-y-6">
                    {/* Editor Section */}
                    <div>
                        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                            <span className="w-6 h-px bg-gray-300"></span>
                            Editor
                            <span className="flex-1 h-px bg-gray-300"></span>
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
                                    <div className="w-11 h-6 bg-gray-200 rounded-full relative">
                                        <div className="w-5 h-5 bg-gray-400 rounded-full absolute left-0.5 top-0.5"></div>
                                    </div>
                                    <span className="text-sm text-gray-400">Disabled</span>
                                </div>
                            </SettingCard>
                        </div>
                    </div>

                    {/* Appearance Section */}
                    <div>
                        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                            <span className="w-6 h-px bg-gray-300"></span>
                            Appearance
                            <span className="flex-1 h-px bg-gray-300"></span>
                        </h2>
                        <div className="space-y-4">
                            {/* Theme - DISABLED */}
                            <SettingCard
                                icon={<Palette className="w-5 h-5" />}
                                title="Theme"
                                description="Choose between light and dark mode."
                                disabled
                            >
                                <div className="flex gap-3">
                                    <div className="px-4 py-2 rounded-lg bg-gray-100 text-gray-400 text-sm font-medium">
                                        Light
                                    </div>
                                    <div className="px-4 py-2 rounded-lg bg-gray-100 text-gray-400 text-sm font-medium">
                                        Dark
                                    </div>
                                    <div className="px-4 py-2 rounded-lg bg-gray-100 text-gray-400 text-sm font-medium">
                                        System
                                    </div>
                                </div>
                            </SettingCard>
                        </div>
                    </div>

                    {/* Performance Section */}
                    <div>
                        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                            <span className="w-6 h-px bg-gray-300"></span>
                            Performance
                            <span className="flex-1 h-px bg-gray-300"></span>
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
                                    <div className="w-11 h-6 bg-gray-200 rounded-full relative">
                                        <div className="w-5 h-5 bg-gray-400 rounded-full absolute left-0.5 top-0.5"></div>
                                    </div>
                                    <span className="text-sm text-gray-400">Disabled</span>
                                </div>
                            </SettingCard>
                        </div>
                    </div>

                    {/* Notifications Section */}
                    <div>
                        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                            <span className="w-6 h-px bg-gray-300"></span>
                            Notifications
                            <span className="flex-1 h-px bg-gray-300"></span>
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
                                    <div className="w-11 h-6 bg-gray-200 rounded-full relative">
                                        <div className="w-5 h-5 bg-gray-400 rounded-full absolute left-0.5 top-0.5"></div>
                                    </div>
                                    <span className="text-sm text-gray-400">Disabled</span>
                                </div>
                            </SettingCard>
                        </div>
                    </div>

                    {/* Privacy Section */}
                    <div>
                        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                            <span className="w-6 h-px bg-gray-300"></span>
                            Privacy & Data
                            <span className="flex-1 h-px bg-gray-300"></span>
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
                                    <div className="w-11 h-6 bg-gray-200 rounded-full relative">
                                        <div className="w-5 h-5 bg-gray-400 rounded-full absolute left-0.5 top-0.5"></div>
                                    </div>
                                    <span className="text-sm text-gray-400">Disabled</span>
                                </div>
                            </SettingCard>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="mt-12 pt-6 border-t border-gray-200 text-center">
                    <p className="text-sm text-gray-500">
                        PrismAI v1.0.0 • More settings coming soon
                    </p>
                </div>
            </div>
        </div>
    );
}
