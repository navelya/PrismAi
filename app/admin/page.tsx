'use client';

import React, { useState, useEffect, useRef, Suspense } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import * as LucideIcons from 'lucide-react';
import {
    Boxes,
    ArrowLeft,
    Plus,
    Save,
    AlertCircle,
    AlertTriangle,
    CheckCircle2,
    Database,
    Type,
    Layers,
    Code,
    Activity,
    Trash2,
    Settings2,
    Link2,
    ChevronDown,
    ChevronRight,
    Info,
    ExternalLink,
    Building2,
    Image as ImageIcon,
    X,
    Search,
    Download,
    Edit2,
    Users,
    Calculator,
    BarChart3,
    Video,
    Settings,
    ArrowDownUp,
    RotateCcw,
    Minus,
    Maximize2,
    GripVertical,
    LayoutTemplate
} from 'lucide-react';
import { modelsAdminApi } from '@/lib/api/admin';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { NumberInput } from '@/components/ui/NumberInput';
import { formatDisplayName, parseIconName } from '@/lib/utils/schema-parser';
import { cn } from '@/lib/utils';
import { ConfirmationModal } from '@/components/ui/ConfirmationModal';
import { ModelForm } from '@/components/admin/ModelForm';
import { ContextMenuBuilder } from '@/components/admin/ContextMenuBuilder';
import { UsersAdminContent } from '@/components/admin/UsersAdminContent';
import { PricingAdminContent } from '@/components/admin/PricingAdminContent';
import { StatisticsAdminContent } from '@/components/admin/StatisticsAdminContent';
import { FailuresAdminContent } from '@/components/admin/FailuresAdminContent';
import { TemplatesAdminContent } from '@/components/admin/TemplatesAdminContent';
import { computeAiNodeCost, formatCredits } from '@/lib/billing/cost';

// =============================================================================
// SECTION NAVIGATION CONFIG
// =============================================================================

type SectionId = 'models' | 'users' | 'pricing' | 'statistics' | 'failures' | 'templates';

interface SectionNavItem {
    id: SectionId;
    label: string;
    icon: React.ReactNode;
    comingSoon?: boolean;
}

const sectionNavItems: SectionNavItem[] = [
    { id: 'models', label: 'Models', icon: <Database className="w-4 h-4" /> },
    { id: 'users', label: 'Users', icon: <Users className="w-4 h-4" /> },
    { id: 'pricing', label: 'Pricing', icon: <Calculator className="w-4 h-4" /> },
    { id: 'statistics', label: 'Statistics', icon: <BarChart3 className="w-4 h-4" /> },
    { id: 'failures', label: 'Failures', icon: <AlertTriangle className="w-4 h-4" /> },
    { id: 'templates', label: 'Templates', icon: <LayoutTemplate className="w-4 h-4" /> },
];

// =============================================================================
// ADMIN SHELL (sidebar + section routing)
// =============================================================================

export default function AdminPage() {
    return (
        <Suspense fallback={
            <div className="w-full h-full flex flex-col items-center justify-center bg-surface-primary py-40 gap-6">
                <div className="w-12 h-12 border-4 border-accent-primary/20 border-t-accent-primary rounded-full animate-spin" />
                <p className="text-[10px] font-black uppercase tracking-[0.3em] text-content-tertiary">Initializing Admin...</p>
            </div>
        }>
            <AdminShell />
        </Suspense>
    );
}

function AdminShell() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const pathname = usePathname();

    const sectionParam = searchParams.get('section') as SectionId | null;
    const activeSection: SectionId =
        sectionParam === 'users' ? 'users'
        : sectionParam === 'pricing' ? 'pricing'
        : sectionParam === 'statistics' ? 'statistics'
        : sectionParam === 'failures' ? 'failures'
        : sectionParam === 'templates' ? 'templates'
        : 'models';

    const [mobileShowContent, setMobileShowContent] = useState(false);
    const [sidebarHovered, setSidebarHovered] = useState(false);

    const handleSectionSelect = (id: SectionId) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set('section', id);
        if (id !== 'models') params.delete('tab');
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
        setMobileShowContent(true);
    };

    return (
        <div className="w-full h-full flex bg-surface-primary mesh-gradient overflow-hidden relative">
            {/* Spacer reserves the collapsed-rail width on desktop so main content doesn't shift on hover */}
            <div className="hidden md:block md:w-14 md:shrink-0" aria-hidden="true" />

            {/* Sidebar Navigation — full width on mobile, hover-expanding overlay rail on desktop */}
            <aside
                onMouseEnter={() => setSidebarHovered(true)}
                onMouseLeave={() => setSidebarHovered(false)}
                className={`
                    md:absolute md:left-0 md:top-0 md:bottom-0 md:z-50
                    md:border-r md:border-stroke-subtle/60 bg-surface-primary/70 backdrop-blur-3xl md:overflow-hidden md:block shadow-xl
                    transition-[width] duration-150 ease-out
                    ${sidebarHovered ? 'md:w-60 md:shadow-2xl' : 'md:w-14'}
                    ${mobileShowContent ? 'hidden' : 'w-full bg-surface-primary overflow-y-auto z-20'}
                `}
            >
                <div className={`md:h-full md:flex md:flex-col ${sidebarHovered ? 'md:overflow-y-auto' : 'md:overflow-hidden'}`}>
                    <div className="py-3 px-4 md:py-3 md:px-2">
                        <nav className="space-y-0.5">
                            {sectionNavItems.map((item) => (
                                <button
                                    key={item.id}
                                    onClick={() => handleSectionSelect(item.id)}
                                    title={item.label}
                                    className={`
                                        w-full flex items-center gap-2.5 py-1.5 px-2 rounded-lg text-[11px] font-semibold transition-colors duration-150
                                        ${activeSection === item.id
                                            ? 'bg-white/8 text-content-primary'
                                            : 'text-content-tertiary hover:bg-white/5 hover:text-content-secondary'
                                        }
                                    `}
                                >
                                    <span className={`w-5 h-5 flex items-center justify-center shrink-0 transition-colors ${activeSection === item.id ? 'text-accent-primary' : ''}`}>
                                        {item.icon}
                                    </span>
                                    <span className={`
                                        flex-1 text-left truncate whitespace-nowrap transition-opacity duration-100
                                        ${sidebarHovered ? 'md:opacity-100' : 'md:opacity-0'}
                                    `}>
                                        {item.label}
                                    </span>
                                    {item.comingSoon && (
                                        <span className={`
                                            px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider bg-white/5 text-content-tertiary rounded-md shrink-0 border border-white/10 transition-opacity duration-100
                                            ${sidebarHovered ? 'md:opacity-100' : 'md:opacity-0'}
                                        `}>
                                            Soon
                                        </span>
                                    )}
                                    <ChevronRight className={`
                                        w-3 h-3 shrink-0 transition-opacity duration-100
                                        ${sidebarHovered ? 'md:opacity-100' : 'md:opacity-0'}
                                        ${activeSection === item.id ? 'opacity-100 text-accent-primary' : 'opacity-0'}
                                    `} />
                                </button>
                            ))}
                        </nav>
                    </div>

                    {/* Footer */}
                    <div className={`
                        px-3 py-2 border-t border-stroke-subtle/60 mt-auto
                        transition-opacity duration-100
                        ${sidebarHovered ? 'md:opacity-100' : 'md:opacity-0 md:pointer-events-none'}
                    `}>
                        <div className="flex items-center gap-1.5 opacity-50">
                            <div className="w-1 h-1 rounded-full bg-green-500" />
                            <p className="text-[9px] font-bold text-content-tertiary uppercase tracking-widest">
                                Admin Console
                            </p>
                        </div>
                    </div>
                </div>
            </aside>

            {/* Main Content Area — hidden on mobile until a section is selected */}
            <main className={`
                flex-1 overflow-y-auto custom-scrollbar relative
                ${mobileShowContent ? 'block' : 'hidden md:block'}
            `}>
                {activeSection === 'models' && <ModelsAdminContent onMobileBack={() => setMobileShowContent(false)} />}
                {activeSection === 'users' && <UsersAdminContent onMobileBack={() => setMobileShowContent(false)} />}
                {activeSection === 'pricing' && <PricingAdminContent onMobileBack={() => setMobileShowContent(false)} />}
                {activeSection === 'statistics' && <StatisticsAdminContent onMobileBack={() => setMobileShowContent(false)} />}
                {activeSection === 'failures' && <FailuresAdminContent onMobileBack={() => setMobileShowContent(false)} />}
                {activeSection === 'templates' && <TemplatesAdminContent onMobileBack={() => setMobileShowContent(false)} />}
            </main>
        </div>
    );
}

// =============================================================================
// COST CALCULATOR (sticky right rail)
// =============================================================================

const CALC_STORAGE_KEY = 'prismai-admin-cost-calculator';
const CALC_WINDOW_STORAGE_KEY = 'prismai-admin-cost-calculator-window';
const CALC_WIDTH = 288; // w-72
const DEFAULT_IMAGE_MULTIPLIER = 4;
const DEFAULT_VIDEO_MULTIPLIER = 3;

interface CalcConfig {
    imageMultiplier: number;
    videoMultiplier: number;
    mode: 'image' | 'video';
    direction: 'cents-to-tokens' | 'tokens-to-cents';
}

const DEFAULT_CALC_CONFIG: CalcConfig = {
    imageMultiplier: DEFAULT_IMAGE_MULTIPLIER,
    videoMultiplier: DEFAULT_VIDEO_MULTIPLIER,
    mode: 'image',
    direction: 'cents-to-tokens',
};

function CostCalculator() {
    const [config, setConfig] = useState<CalcConfig>(DEFAULT_CALC_CONFIG);
    const [hydrated, setHydrated] = useState(false);
    const [input, setInput] = useState<string>('');
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [draftImage, setDraftImage] = useState<string>(String(DEFAULT_IMAGE_MULTIPLIER));
    const [draftVideo, setDraftVideo] = useState<string>(String(DEFAULT_VIDEO_MULTIPLIER));

    // Floating-window state
    const [minimized, setMinimized] = useState(false);
    const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 128 });
    const [dragging, setDragging] = useState(false);
    const dragOffset = useRef<{ dx: number; dy: number }>({ dx: 0, dy: 0 });

    // Hydrate from localStorage on mount
    useEffect(() => {
        try {
            const stored = localStorage.getItem(CALC_STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored) as Partial<CalcConfig>;
                setConfig(prev => ({ ...prev, ...parsed }));
            }
        } catch { /* ignore corrupt storage */ }

        // Restore window position / minimized state, defaulting to top-right.
        try {
            const storedWin = localStorage.getItem(CALC_WINDOW_STORAGE_KEY);
            if (storedWin) {
                const w = JSON.parse(storedWin) as { x?: number; y?: number; minimized?: boolean };
                if (typeof w.minimized === 'boolean') setMinimized(w.minimized);
                if (typeof w.x === 'number' && typeof w.y === 'number') {
                    setPos({
                        x: Math.min(Math.max(0, w.x), window.innerWidth - CALC_WIDTH),
                        y: Math.min(Math.max(0, w.y), window.innerHeight - 60),
                    });
                } else {
                    setPos({ x: window.innerWidth - CALC_WIDTH - 24, y: 128 });
                }
            } else {
                setPos({ x: window.innerWidth - CALC_WIDTH - 24, y: 128 });
            }
        } catch {
            setPos({ x: window.innerWidth - CALC_WIDTH - 24, y: 128 });
        }
        setHydrated(true);
    }, []);

    // Persist on change (skip first render before hydration)
    useEffect(() => {
        if (!hydrated) return;
        try {
            localStorage.setItem(CALC_STORAGE_KEY, JSON.stringify(config));
        } catch { /* ignore quota errors */ }
    }, [config, hydrated]);

    // Persist window position / minimized state
    useEffect(() => {
        if (!hydrated) return;
        try {
            localStorage.setItem(CALC_WINDOW_STORAGE_KEY, JSON.stringify({ ...pos, minimized }));
        } catch { /* ignore quota errors */ }
    }, [pos, minimized, hydrated]);

    // Drag handling via window-level pointer listeners
    useEffect(() => {
        if (!dragging) return;
        const onMove = (e: PointerEvent) => {
            const x = Math.min(Math.max(0, e.clientX - dragOffset.current.dx), window.innerWidth - CALC_WIDTH);
            const y = Math.min(Math.max(0, e.clientY - dragOffset.current.dy), window.innerHeight - 60);
            setPos({ x, y });
        };
        const onUp = () => setDragging(false);
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        return () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
    }, [dragging]);

    const startDrag = (e: React.PointerEvent) => {
        dragOffset.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
        setDragging(true);
    };

    const reverseMode = config.direction === 'tokens-to-cents';
    const multiplier = config.mode === 'image' ? config.imageMultiplier : config.videoMultiplier;
    const numInput = parseFloat(input);
    const hasInput = !isNaN(numInput) && input.trim() !== '';
    const result = hasInput
        ? (reverseMode ? numInput / multiplier : numInput * multiplier)
        : 0;

    const inputLabel = reverseMode ? 'Tokens' : 'Cost (Cents)';
    const inputSuffix = reverseMode ? undefined : '¢';
    const resultLabel = reverseMode ? 'Cents' : 'Tokens';
    const formula = reverseMode ? `${numInput} ÷ ${multiplier}` : `${numInput} × ${multiplier}`;

    const swap = () => {
        setConfig(prev => ({ ...prev, direction: reverseMode ? 'cents-to-tokens' : 'tokens-to-cents' }));
        setInput('');
    };

    const openSettings = () => {
        setDraftImage(String(config.imageMultiplier));
        setDraftVideo(String(config.videoMultiplier));
        setSettingsOpen(true);
    };

    const saveSettings = () => {
        const img = parseFloat(draftImage);
        const vid = parseFloat(draftVideo);
        setConfig(prev => ({
            ...prev,
            imageMultiplier: !isNaN(img) && img > 0 ? img : prev.imageMultiplier,
            videoMultiplier: !isNaN(vid) && vid > 0 ? vid : prev.videoMultiplier,
        }));
        setSettingsOpen(false);
    };

    const resetDrafts = () => {
        setDraftImage(String(DEFAULT_IMAGE_MULTIPLIER));
        setDraftVideo(String(DEFAULT_VIDEO_MULTIPLIER));
    };

    return (
        <div
            className={`hidden xl:block fixed z-20 w-72 ${dragging ? 'select-none cursor-grabbing' : ''}`}
            style={{ left: pos.x, top: pos.y }}
        >
            <div className={`glassmorphism rounded-2xl shadow-2xl border border-white/10 backdrop-blur-3xl bg-surface-primary/70 ${minimized ? 'p-3' : 'p-5'}`}>
                {/* Header (drag handle) */}
                <div
                    onPointerDown={startDrag}
                    className={`flex items-start justify-between ${minimized ? '' : 'mb-5'} cursor-grab active:cursor-grabbing`}
                >
                    <div className="flex items-center gap-2.5 min-w-0">
                        <GripVertical className="w-3.5 h-3.5 text-content-tertiary opacity-40 shrink-0" />
                        <div className="w-7 h-7 rounded-lg bg-accent-primary/10 flex items-center justify-center border border-accent-primary/20 shrink-0">
                            {settingsOpen && !minimized
                                ? <Settings className="w-3.5 h-3.5 text-accent-primary" />
                                : <Calculator className="w-3.5 h-3.5 text-accent-primary" />}
                        </div>
                        <div className="min-w-0">
                            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-content-primary truncate">
                                {settingsOpen && !minimized ? 'Multipliers' : 'Cost Calculator'}
                            </h3>
                            {!minimized && (
                                <p className="text-[8px] font-bold uppercase tracking-widest text-content-tertiary opacity-60 mt-0.5 truncate">
                                    {settingsOpen
                                        ? 'Configure margins'
                                        : (reverseMode ? 'Tokens → Cents' : 'Cents → Tokens')}
                                </p>
                            )}
                        </div>
                    </div>
                    {/* Window controls (don't start a drag) */}
                    <div className="flex items-center gap-0.5 shrink-0" onPointerDown={e => e.stopPropagation()}>
                        {!minimized && (
                            <button
                                onClick={() => settingsOpen ? setSettingsOpen(false) : openSettings()}
                                title={settingsOpen ? 'Close' : 'Edit multipliers'}
                                className="p-1.5 text-content-tertiary hover:text-content-primary hover:bg-white/5 rounded-lg transition-all"
                            >
                                {settingsOpen ? <X className="w-3.5 h-3.5" /> : <Settings className="w-3.5 h-3.5" />}
                            </button>
                        )}
                        <button
                            onClick={() => setMinimized(m => !m)}
                            title={minimized ? 'Expand' : 'Minimize'}
                            className="p-1.5 text-content-tertiary hover:text-content-primary hover:bg-white/5 rounded-lg transition-all"
                        >
                            {minimized ? <Maximize2 className="w-3.5 h-3.5" /> : <Minus className="w-3.5 h-3.5" />}
                        </button>
                    </div>
                </div>

                {minimized ? null : settingsOpen ? (
                    <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
                        <NumberInput
                            label="Image Multiplier"
                            value={draftImage}
                            onChange={e => setDraftImage(e.target.value)}
                            min={0.01}
                            step={0.5}
                        />
                        <NumberInput
                            label="Video Multiplier"
                            value={draftVideo}
                            onChange={e => setDraftVideo(e.target.value)}
                            min={0.01}
                            step={0.5}
                        />
                        <div className="flex gap-2 pt-3 border-t border-white/10">
                            <button
                                onClick={resetDrafts}
                                title="Reset to defaults"
                                className="flex items-center gap-1.5 px-3 py-2 text-[9px] font-black uppercase tracking-widest text-content-tertiary hover:text-content-primary bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-all"
                            >
                                <RotateCcw className="w-3 h-3" />
                                Reset
                            </button>
                            <button
                                onClick={saveSettings}
                                className="flex-1 px-3 py-2 text-[9px] font-black uppercase tracking-widest bg-accent-primary text-white rounded-lg transition-all hover:opacity-90 active:scale-[0.98]"
                            >
                                Save
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="animate-in fade-in slide-in-from-top-2 duration-200">
                        {/* Mode Toggle */}
                        <div className="flex items-center bg-white/5 p-1 rounded-xl border border-white/10 mb-4">
                            <button
                                onClick={() => setConfig(prev => ({ ...prev, mode: 'image' }))}
                                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${config.mode === 'image'
                                    ? 'bg-white/10 text-content-primary shadow-premium ring-1 ring-white/20'
                                    : 'text-content-tertiary hover:text-content-secondary'
                                    }`}
                            >
                                <ImageIcon className="w-3 h-3" />
                                Image ×{config.imageMultiplier}
                            </button>
                            <button
                                onClick={() => setConfig(prev => ({ ...prev, mode: 'video' }))}
                                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${config.mode === 'video'
                                    ? 'bg-white/10 text-content-primary shadow-premium ring-1 ring-white/20'
                                    : 'text-content-tertiary hover:text-content-secondary'
                                    }`}
                            >
                                <Video className="w-3 h-3" />
                                Video ×{config.videoMultiplier}
                            </button>
                        </div>

                        {/* Input header with swap */}
                        <div className="flex items-center justify-between px-1 mb-2 h-5">
                            <span className="text-[10px] font-bold text-content-tertiary uppercase tracking-[0.1em] opacity-80 leading-none">
                                {inputLabel}
                            </span>
                            <button
                                onClick={swap}
                                title="Swap direction"
                                className="flex items-center gap-1 text-[8px] font-black uppercase tracking-widest text-content-tertiary hover:text-accent-primary transition-all leading-none"
                            >
                                <ArrowDownUp className="w-2.5 h-2.5" />
                                Swap
                            </button>
                        </div>
                        <NumberInput
                            suffix={inputSuffix}
                            min={0}
                            step={1}
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            placeholder="0"
                        />

                        {/* Result */}
                        <div className="mt-5 pt-5 border-t border-white/10">
                            <div className="flex items-baseline justify-between mb-1">
                                <span className="text-[9px] font-black text-content-tertiary uppercase tracking-[0.2em]">{resultLabel}</span>
                                {hasInput && (
                                    <span className="text-[9px] font-mono text-content-tertiary opacity-50">
                                        {formula}
                                    </span>
                                )}
                            </div>
                            <p className={`text-3xl font-black tracking-tighter ${hasInput ? 'text-accent-primary' : 'text-content-tertiary opacity-30'}`}>
                                {hasInput ? result.toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—'}
                                {hasInput && reverseMode && <span className="text-base ml-1 opacity-60">¢</span>}
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

// =============================================================================
// MODELS ADMIN CONTENT (existing admin functionality)
// =============================================================================

function ModelsAdminContent({ onMobileBack }: { onMobileBack: () => void }) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const pathname = usePathname();

    // View State
    const initialTab = searchParams.get('tab') as any;
    const [activeTab, setActiveTab] = useState<'models' | 'nodes' | 'providers' | 'management' | 'menu_builder'>(
        (initialTab && ['models', 'nodes', 'providers', 'management', 'menu_builder'].includes(initialTab)) 
        ? initialTab 
        : 'models'
    );

    const handleTabChange = (tab: typeof activeTab) => {
        setActiveTab(tab);
        const params = new URLSearchParams(searchParams.toString());
        params.set('tab', tab);
        router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    };

    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);

    // Management State
    const [allModels, setAllModels] = useState<any[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('all');
    const [activeFilter, setActiveFilter] = useState('all');

    // Selection/Edit State
    const [editingModel, setEditingModel] = useState<any | null>(null);
    const [editingProvider, setEditingProvider] = useState<any | null>(null);
    const [editingNodeType, setEditingNodeType] = useState<any | null>(null);
    const [providerToDelete, setProviderToDelete] = useState<any | null>(null);
    const [modelToDelete, setModelToDelete] = useState<any | null>(null);
    const [nodeTypeToDelete, setNodeTypeToDelete] = useState<any | null>(null);

    // Dynamic Data
    const [categories, setCategories] = useState<any[]>([]);
    const [archetypes, setArchetypes] = useState<any[]>([]);
    const [nodeTypes, setNodeTypes] = useState<any[]>([]);
    const [providers, setProviders] = useState<any[]>([]);
    const [subCategorySearch, setSubCategorySearch] = useState('');
    const [subCategoryParentFilter, setSubCategoryParentFilter] = useState('all');

    // -------------------------------------------------------------------------
    // FORM STATES
    // -------------------------------------------------------------------------
    const [modelSubmitting, setModelSubmitting] = useState(false);

    const [nodeForm, setNodeForm] = useState({
        id: '',
        display_name: '',
        icon_reference: 'Boxes',
        parent_categories: [] as string[]
    });
    const [nodeSubmitting, setNodeSubmitting] = useState(false);

    const [providerForm, setProviderForm] = useState({
        name: '',
        logo: null as File | null
    });
    const [providerSubmitting, setProviderSubmitting] = useState(false);

    // =========================================================================

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        setLoading(true);
        try {
            const [cats, archs, types, mods, provs] = await Promise.all([
                modelsAdminApi.listCategories(),
                modelsAdminApi.listArchetypes(),
                modelsAdminApi.listNodeTypes(),
                modelsAdminApi.listModels(),
                modelsAdminApi.listProviders()
            ]);
            setCategories(cats);
            setArchetypes(archs);
            setNodeTypes(types);
            setAllModels(mods);
            setProviders(provs);
        } catch (err) {
            console.error('Failed to load initial data:', err);
            setStatus({ type: 'error', message: 'Failed to load database items.' });
        } finally {
            setLoading(false);
        }
    }

    // -------------------------------------------------------------------------
    // HANDLERS
    // -------------------------------------------------------------------------

    const handleModelSubmit = async (data: any) => {
        setStatus(null);
        setModelSubmitting(true);
        try {
            if (editingModel) {
                await modelsAdminApi.updateModel(editingModel.id, data);
                setStatus({ type: 'success', message: 'AI Model updated successfully!' });
                // We stay in editing mode as requested
                const updatedMod = { ...editingModel, ...data };
                setEditingModel(updatedMod);
            } else {
                const newModel = await modelsAdminApi.createModel(data);
                setStatus({ type: 'success', message: 'AI Model registered successfully!' });
                // Optionally switch to edit mode for the new model if needed, 
                // but for now we just keep the status message visible.
            }
            await loadData();
        } catch (err: any) {
            setStatus({ type: 'error', message: err.message || 'Failed to process AI Model.' });
        } finally {
            setModelSubmitting(false);
        }
    };

    const handleNodeTypeSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setStatus(null);

        if (nodeForm.parent_categories.length === 0) {
            setStatus({ type: 'error', message: 'Select at least one parent category.' });
            return;
        }

        setNodeSubmitting(true);
        try {
            const finalNodeForm = {
                ...nodeForm,
                icon_reference: parseIconName(nodeForm.icon_reference)
            };

            if (editingNodeType) {
                await modelsAdminApi.updateNodeType(editingNodeType.id, finalNodeForm);
                setStatus({ type: 'success', message: 'Sub Category updated successfully!' });
                setEditingNodeType(null);
            } else {
                await modelsAdminApi.createNodeType(finalNodeForm);
                setStatus({ type: 'success', message: 'Sub Category created successfully!' });
            }
            setNodeForm({ id: '', display_name: '', icon_reference: 'Boxes', parent_categories: [] });
            await loadData();
        } catch (err: any) {
            setStatus({ type: 'error', message: err.message || 'Failed to process Sub Category.' });
        } finally {
            setNodeSubmitting(false);
        }
    };

    const handleNodeTypeDelete = async () => {
        if (!nodeTypeToDelete) return;
        setStatus(null);
        try {
            await modelsAdminApi.deleteNodeType(nodeTypeToDelete.id);
            setStatus({ type: 'success', message: `Sub Category "${nodeTypeToDelete.display_name}" deleted.` });
            await loadData();
        } catch (err: any) {
            setStatus({ type: 'error', message: err.message || 'Failed to delete Sub Category.' });
        } finally {
            setNodeTypeToDelete(null);
        }
    };

    const handleProviderSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setStatus(null);
        setProviderSubmitting(true);

        try {
            const formData = new FormData();
            formData.append('name', providerForm.name);
            if (providerForm.logo) {
                formData.append('logo', providerForm.logo);
            }

            if (editingProvider) {
                await modelsAdminApi.updateProvider(editingProvider.id, formData);
                setStatus({ type: 'success', message: 'Provider updated successfully!' });
                setEditingProvider(null);
            } else {
                await modelsAdminApi.createProvider(formData);
                setStatus({ type: 'success', message: 'Provider created successfully!' });
            }

            setProviderForm({ name: '', logo: null });
            await loadData();
        } catch (err: any) {
            setStatus({ type: 'error', message: err.message || 'Failed to process provider.' });
        } finally {
            setProviderSubmitting(false);
        }
    };

    const handleProviderDelete = async () => {
        if (!providerToDelete) return;
        setStatus(null);
        try {
            await modelsAdminApi.deleteProvider(providerToDelete.id);
            setStatus({ type: 'success', message: `Provider "${providerToDelete.name}" deleted.` });
            await loadData();
        } catch (err: any) {
            setStatus({ type: 'error', message: err.message || 'Failed to delete provider.' });
        } finally {
            setProviderToDelete(null);
        }
    };

    const handleModelDelete = async () => {
        if (!modelToDelete) return;
        setStatus(null);
        try {
            await modelsAdminApi.deleteModel(modelToDelete.id);
            setStatus({ type: 'success', message: `Model "${modelToDelete.display_name}" deleted.` });
            await loadData();
        } catch (err: any) {
            setStatus({ type: 'error', message: err.message || 'Failed to delete model.' });
        } finally {
            setModelToDelete(null);
        }
    };

    return (
        <div className="min-h-full flex flex-col">
            {/* Mobile back-to-sidebar */}
            <div className="md:hidden px-8 pt-6">
                <button
                    onClick={onMobileBack}
                    className="flex items-center gap-3 text-[10px] font-black uppercase tracking-widest text-content-tertiary hover:text-content-primary transition-all"
                >
                    <ArrowLeft className="w-4 h-4" />
                    <span>Return to Admin</span>
                </button>
            </div>

            {/* Header */}
            <header className="sticky top-0 z-30 bg-surface-primary/60 backdrop-blur-xl border-b border-white/5 px-8 py-5 flex flex-col md:flex-row md:items-center justify-between gap-6 shadow-2xl">
                <div className="flex items-center gap-5">
                    <button
                        onClick={() => router.back()}
                        className="p-2.5 -ml-2 rounded-xl hover:bg-white/5 transition-all text-content-secondary hover:text-content-primary border border-transparent hover:border-white/10"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                    <div>
                        <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-xl bg-accent-primary/10 flex items-center justify-center border border-accent-primary/20 shadow-inner">
                                <Database className="w-4 h-4 text-accent-primary" />
                            </div>
                            <h1 className="text-xl font-black text-content-primary uppercase tracking-tighter">Admin Registry</h1>
                        </div>
                        <p className="text-[10px] font-bold text-content-tertiary uppercase tracking-widest mt-0.5 opacity-60">System Model Controller</p>
                    </div>
                </div>

                {/* Segmented Control */}
                <div className="flex items-center bg-white/5 p-1 rounded-2xl border border-white/10 shrink-0 backdrop-blur-md">
                    <button
                        onClick={() => handleTabChange('models')}
                        className={`px-5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${activeTab === 'models'
                            ? 'bg-white/10 text-content-primary shadow-premium ring-1 ring-white/20'
                            : 'text-content-tertiary hover:text-content-secondary'
                            }`}
                    >
                        Registry
                    </button>
                    <button
                        onClick={() => handleTabChange('management')}
                        className={`px-5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${activeTab === 'management'
                            ? 'bg-white/10 text-content-primary shadow-premium ring-1 ring-white/20'
                            : 'text-content-tertiary hover:text-content-secondary'
                            }`}
                    >
                        Management
                    </button>
                    <button
                        onClick={() => handleTabChange('providers')}
                        className={`px-5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${activeTab === 'providers'
                            ? 'bg-white/10 text-content-primary shadow-premium ring-1 ring-white/20'
                            : 'text-content-tertiary hover:text-content-secondary'
                            }`}
                    >
                        Providers
                    </button>
                    <button
                        onClick={() => handleTabChange('nodes')}
                        className={`px-5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${activeTab === 'nodes'
                            ? 'bg-white/10 text-content-primary shadow-premium ring-1 ring-white/20'
                            : 'text-content-tertiary hover:text-content-secondary'
                            }`}
                    >
                        Sub Categories
                    </button>
                    <button
                        onClick={() => handleTabChange('menu_builder')}
                        className={`px-5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${activeTab === 'menu_builder'
                            ? 'bg-white/10 text-content-primary shadow-premium ring-1 ring-white/20'
                            : 'text-content-tertiary hover:text-content-secondary'
                            }`}
                    >
                        Menu Builder
                    </button>
                </div>
            </header>

            <main className="flex-1 max-w-6xl mx-auto w-full p-8 md:p-12">
                {loading ? (
                    <div className="flex flex-col items-center justify-center py-40 gap-6 animate-pulse">
                        <div className="w-12 h-12 border-4 border-accent-primary/20 border-t-accent-primary rounded-full animate-spin" />
                        <p className="text-[10px] font-black uppercase tracking-[0.3em] text-content-tertiary">Synchronizing Registry...</p>
                    </div>
                ) : (
                    <div className="animate-in fade-in duration-700">
                        {status && (
                            <div className={cn(
                                "mb-10 p-5 rounded-2xl border backdrop-blur-md flex items-start gap-4 animate-in fade-in slide-in-from-top-4 shadow-xl",
                                status.type === 'success'
                                    ? 'bg-green-500/5 border-green-500/20 text-green-400'
                                    : 'bg-red-500/5 border-red-500/20 text-red-400'
                            )}>
                                {status.type === 'success' ? <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" /> : <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />}
                                <div className="flex-1">
                                    <p className="text-sm font-bold tracking-tight">{status.type === 'success' ? 'Success' : 'Action Required'}</p>
                                    <p className="text-xs opacity-80 mt-1 leading-relaxed font-medium">{status.message}</p>
                                </div>
                            </div>
                        )}

                        {/* Registry View */}
                        {activeTab === 'models' && (
                            <ModelForm
                                onSubmit={handleModelSubmit}
                                submitting={modelSubmitting}
                                categories={categories}
                                archetypes={archetypes}
                                nodeTypes={nodeTypes}
                                providers={providers}
                            />
                        )}

                        {/* Management View */}
                        {activeTab === 'management' && !editingModel && (
                            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                {/* Filters */}
                                <div className="flex flex-col md:flex-row gap-4 bg-white/5 p-6 rounded-3xl border border-white/10 backdrop-blur-md shadow-xl">
                                    <div className="relative flex-1">
                                        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-content-tertiary" />
                                        <input
                                            type="text"
                                            placeholder="Search models..."
                                            value={searchQuery}
                                            onChange={e => setSearchQuery(e.target.value)}
                                            className="w-full pl-11 pr-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-xs font-medium focus:outline-none focus:border-accent-primary/50 transition-all"
                                        />
                                    </div>
                                    <div className="flex gap-4">
                                        <Select
                                            value={categoryFilter}
                                            className="min-w-[150px]"
                                            options={[{ id: 'all', display_name: 'All Categories' }, ...categories]}
                                            onChange={e => setCategoryFilter(e.target.value)}
                                        />
                                        <Select
                                            value={activeFilter}
                                            className="min-w-[150px]"
                                            options={[
                                                { id: 'all', display_name: 'All Status' },
                                                { id: 'active', display_name: 'Active Only' },
                                                { id: 'inactive', display_name: 'Inactive Only' }
                                            ]}
                                            onChange={e => setActiveFilter(e.target.value)}
                                        />
                                    </div>
                                </div>

                                {/* Models Grid */}
                                <div className="grid grid-cols-1 gap-4">
                                    {allModels
                                        .filter(m => {
                                            const matchesSearch = m.display_name.toLowerCase().includes(searchQuery.toLowerCase()) || m.replicate_model_id.toLowerCase().includes(searchQuery.toLowerCase());
                                            const matchesCat = categoryFilter === 'all' || m.category_id === categoryFilter;
                                            const matchesActive = activeFilter === 'all' || (activeFilter === 'active' ? m.is_active : !m.is_active);
                                            return matchesSearch && matchesCat && matchesActive;
                                        })
                                        .map(model => {
                                            const provider = providers.find(p => p.id === model.provider_id);
                                            const subCategory = nodeTypes.find(t => t.id === model.node_type_id);
                                            const IconComponent = (subCategory?.icon_reference && (LucideIcons as any)[subCategory.icon_reference]) || Boxes;

                                            return (
                                                <div key={model.id} className="group bg-white/5 hover:bg-white/10 border border-white/5 rounded-2xl p-6 transition-all flex flex-col md:flex-row md:items-center justify-between gap-6">
                                                    <div className="flex items-center gap-5">
                                                        <div className="relative">
                                                            <div className={cn(
                                                                "w-12 h-12 rounded-xl flex items-center justify-center border shadow-inner transition-all group-hover:scale-110 overflow-hidden",
                                                                model.is_active ? "bg-green-500/10 border-green-500/20" : "bg-red-500/10 border-red-500/20"
                                                            )}>
                                                                {provider?.logo_url ? (
                                                                    <img src={provider.logo_url} alt={provider.name} className="w-full h-full object-contain" />
                                                                ) : (
                                                                    <Building2 className={cn("w-6 h-6", model.is_active ? "text-green-400" : "text-red-400")} />
                                                                )}
                                                            </div>
                                                            <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-surface-primary border border-white/10 rounded-lg flex items-center justify-center overflow-hidden shadow-lg p-1">
                                                                <IconComponent className="w-3.5 h-3.5 text-content-primary" />
                                                            </div>
                                                        </div>
                                                        <div>
                                                            <h4 className="font-bold text-content-primary uppercase tracking-tight text-sm">{model.display_name}</h4>
                                                            <p className="text-[10px] text-content-tertiary font-mono mt-1 opacity-60">{model.replicate_model_id}</p>
                                                            <div className="flex flex-wrap gap-2 mt-2">
                                                                <span className="px-2 py-0.5 bg-white/5 border border-white/10 rounded-lg text-content-tertiary text-[8px] font-black uppercase tracking-widest">{model.category_id}</span>
                                                                {subCategory && (
                                                                    <span className="px-2 py-0.5 bg-accent-primary/5 border border-accent-primary/20 rounded-lg text-accent-primary text-[8px] font-black uppercase tracking-widest">
                                                                        {subCategory.display_name}
                                                                    </span>
                                                                )}
                                                                {provider && (
                                                                    <span className="px-2 py-0.5 bg-white/10 border border-white/20 rounded-lg text-content-secondary text-[8px] font-black uppercase tracking-widest">
                                                                        {provider.name}
                                                                    </span>
                                                                )}
                                                                <span className="px-2 py-0.5 bg-white/5 border border-white/10 rounded-lg text-content-tertiary text-[8px] font-black uppercase tracking-widest" title="Base credit cost">
                                                                    Base {formatCredits(model.credit_cost)}
                                                                </span>
                                                                {(() => {
                                                                    const calculated = computeAiNodeCost(undefined, model);
                                                                    return (
                                                                        <span
                                                                            className="px-2 py-0.5 bg-accent-primary/10 border border-accent-primary/30 rounded-lg text-accent-primary text-[8px] font-black uppercase tracking-widest inline-flex items-center gap-1"
                                                                            title="Total cost using control default values (base + cost modifiers + per-unit costs)"
                                                                        >
                                                                            {formatCredits(calculated)} Tokens
                                                                        </span>
                                                                    );
                                                                })()}
                                                            </div>
                                                        </div>
                                                    </div>

                                                    <div className="flex items-center gap-3">
                                                        <button
                                                            onClick={() => {
                                                                const blob = new Blob([JSON.stringify(model, null, 2)], { type: 'application/json' });
                                                                const url = URL.createObjectURL(blob);
                                                                const a = document.createElement('a');
                                                                a.href = url;
                                                                a.download = `${model.display_name.replace(/\s+/g, '_')}_config.json`;
                                                                a.click();
                                                                URL.revokeObjectURL(url);
                                                            }}
                                                            className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-content-tertiary hover:text-content-primary text-[10px] font-bold uppercase tracking-widest rounded-xl transition-all"
                                                        >
                                                            <Download className="w-3.5 h-3.5" /> JSON
                                                        </button>
                                                        <button
                                                            onClick={() => setEditingModel(model)}
                                                            className="flex items-center gap-2 px-4 py-2 bg-accent-primary/10 hover:bg-accent-primary/20 border border-accent-primary/20 text-accent-primary text-[10px] font-bold uppercase tracking-widest rounded-xl transition-all"
                                                        >
                                                            <Edit2 className="w-3.5 h-3.5" /> Edit
                                                        </button>
                                                        <button
                                                            onClick={() => setModelToDelete(model)}
                                                            className="p-2 text-content-tertiary hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all"
                                                        >
                                                            <Trash2 className="w-4 h-4" />
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })
                                    }
                                    {allModels.length === 0 && (
                                        <div className="text-center py-20 bg-white/5 rounded-3xl border border-dashed border-white/10">
                                            <p className="text-content-tertiary text-xs font-bold uppercase tracking-widest">No models found in the database.</p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Edit Mode */}
                        {editingModel && activeTab === 'management' && (
                            <div className="animate-in fade-in slide-in-from-right-4 duration-500">
                                <div className="mb-10 flex items-center justify-between">
                                    <button
                                        onClick={() => setEditingModel(null)}
                                        className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-content-tertiary hover:text-content-primary transition-all"
                                    >
                                        <ArrowLeft className="w-4 h-4" /> Back to list
                                    </button>
                                    <h3 className="text-xl font-black text-content-primary uppercase tracking-tighter">Editing: {editingModel.display_name}</h3>
                                </div>
                                <ModelForm
                                    initialData={editingModel}
                                    onSubmit={handleModelSubmit}
                                    onCancel={() => setEditingModel(null)}
                                    submitting={modelSubmitting}
                                    categories={categories}
                                    archetypes={archetypes}
                                    nodeTypes={nodeTypes}
                                    providers={providers}
                                />
                            </div>
                        )}

                        {/* Providers View */}
                        {activeTab === 'providers' && (
                            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                <div className="glassmorphism rounded-3xl p-10 shadow-2xl relative overflow-hidden group">
                                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-premium opacity-50 group-hover:opacity-100 transition-opacity"></div>
                                    <div className="mb-10 flex items-center justify-between">
                                        <div>
                                            <h3 className="text-2xl font-black text-content-primary uppercase tracking-tighter mb-2">
                                                {editingProvider ? `Edit: ${editingProvider.name}` : 'Register Provider'}
                                            </h3>
                                            <p className="text-xs text-content-tertiary font-medium opacity-80 leading-relaxed max-w-xl">
                                                Providers represent AI companies (e.g. OpenAI, Anthropic). Assigning models to providers enables better organization in the Node Library.
                                            </p>
                                        </div>
                                        {editingProvider && (
                                            <button
                                                onClick={() => {
                                                    setEditingProvider(null);
                                                    setProviderForm({ name: '', logo: null });
                                                }}
                                                className="p-2 text-content-tertiary hover:text-content-primary rounded-xl transition-all border border-white/5"
                                            >
                                                <X className="w-5 h-5" />
                                            </button>
                                        )}
                                    </div>

                                    <form onSubmit={handleProviderSubmit} className="space-y-6">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                                            <Input
                                                label="Provider Name"
                                                value={providerForm.name}
                                                onChange={e => setProviderForm({ ...providerForm, name: e.target.value })}
                                                placeholder="e.g. Anthropic"
                                                required
                                            />
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-bold text-content-tertiary uppercase tracking-[0.1em] pl-1 flex items-center gap-1.5 opacity-80 h-5 leading-none cursor-pointer">
                                                    Logo Image
                                                </label>
                                                <div className="flex items-center gap-4">
                                                    <label className="flex-1 h-11 px-4 flex items-center gap-3 bg-white/5 border border-white/10 rounded-xl cursor-pointer hover:border-white/20 transition-all text-xs font-medium text-content-tertiary focus-within:ring-4 focus-within:ring-accent-primary/10">
                                                        <ImageIcon className="w-4 h-4" />
                                                        <span className="truncate">{providerForm.logo ? providerForm.logo.name : 'Select JPG/PNG logo...'}</span>
                                                        <input
                                                            type="file"
                                                            className="hidden"
                                                            accept="image/*"
                                                            onChange={e => setProviderForm({ ...providerForm, logo: e.target.files?.[0] || null })}
                                                        />
                                                    </label>
                                                    {(providerForm.logo || (editingProvider && editingProvider.logo_url)) && (
                                                        <div className="w-11 h-11 bg-white/5 border border-white/10 rounded-xl flex items-center justify-center overflow-hidden shadow-inner">
                                                            <img
                                                                src={providerForm.logo ? URL.createObjectURL(providerForm.logo) : editingProvider.logo_url}
                                                                alt="Logo preview"
                                                                className="w-full h-full object-contain p-1"
                                                            />
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        <div className="pt-8 border-t border-white/5 flex justify-end">
                                            <button
                                                type="submit"
                                                disabled={providerSubmitting || loading}
                                                className="px-8 py-3 bg-content-primary text-surface-primary font-black uppercase tracking-widest text-[10px] rounded-2xl hover:bg-content-secondary transition-all disabled:opacity-50 flex items-center gap-2 hover:scale-[1.02] active:scale-[0.98] shadow-xl"
                                            >
                                                {providerSubmitting && <div className="w-4 h-4 border-2 border-surface-primary/30 border-t-surface-primary rounded-full animate-spin" />}
                                                <Save className="w-4 h-4" />
                                                {editingProvider ? 'Update Provider' : 'Initialize Provider'}
                                            </button>
                                        </div>
                                    </form>
                                </div>

                                {/* List */}
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {providers.map(prov => (
                                        <div key={prov.id} className="group bg-white/5 hover:bg-white/10 border border-white/5 rounded-3xl p-6 transition-all flex flex-col justify-between gap-6 shadow-lg hover:shadow-2xl">
                                            <div className="flex items-start justify-between">
                                                <div className="flex items-center gap-4">
                                                    <div className="w-14 h-14 bg-white/5 rounded-2xl flex items-center justify-center border border-white/10 overflow-hidden shadow-inner p-2">
                                                        {prov.logo_url ? (
                                                            <img src={prov.logo_url} alt={prov.name} className="w-full h-full object-contain" />
                                                        ) : (
                                                            <Building2 className="w-6 h-6 text-content-tertiary" />
                                                        )}
                                                    </div>
                                                    <div>
                                                        <h4 className="font-bold text-content-primary uppercase tracking-tight text-sm">{prov.name}</h4>
                                                        <p className="text-[10px] text-content-tertiary font-mono mt-0.5 opacity-60">ID: {prov.id}</p>
                                                    </div>
                                                </div>
                                                <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button
                                                        onClick={() => {
                                                            setEditingProvider(prov);
                                                            setProviderForm({ name: prov.name, logo: null });
                                                            window.scrollTo({ top: 0, behavior: 'smooth' });
                                                        }}
                                                        className="p-2 text-content-tertiary hover:text-accent-primary bg-white/10 rounded-xl transition-all border border-white/10 shadow-sm"
                                                    >
                                                        <Edit2 className="w-3.5 h-3.5" />
                                                    </button>
                                                    <button
                                                        onClick={() => setProviderToDelete(prov)}
                                                        className="p-2 text-content-tertiary hover:text-red-500 bg-white/10 rounded-xl transition-all border border-white/10 shadow-sm"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            </div>
                                            <div className="pt-4 border-t border-white/5">
                                                <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-content-tertiary opacity-60">
                                                    <span>Active Models</span>
                                                    <span className="text-content-primary">{allModels.filter(m => m.provider_id === prov.id).length}</span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                    {providers.length === 0 && (
                                        <div className="col-span-full text-center py-20 bg-white/5 rounded-3xl border border-dashed border-white/10">
                                            <Building2 className="w-12 h-12 text-content-tertiary opacity-20 mx-auto mb-4" />
                                            <p className="text-content-tertiary text-xs font-bold uppercase tracking-widest leading-relaxed">
                                                No providers initialized.<br />Register your first AI company above.
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* Sub Categories View */}
                        {activeTab === 'nodes' && (
                            <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                                <div className="glassmorphism rounded-3xl p-10 shadow-2xl relative overflow-hidden group">
                                    <div className="absolute top-0 left-0 w-full h-1 bg-gradient-premium opacity-50 group-hover:opacity-100 transition-opacity"></div>
                                    <div className="mb-10 flex items-center justify-between">
                                        <div>
                                            <h3 className="text-2xl font-black text-content-primary uppercase tracking-tighter mb-2">
                                                {editingNodeType ? `Edit: ${editingNodeType.display_name}` : 'Initialize Sub Category'}
                                            </h3>
                                            <p className="text-xs text-content-tertiary font-medium opacity-80 leading-relaxed max-w-xl">
                                                Sub categories (Node Types) group models by their functional purpose (e.g. Image Generation, Video Processing).
                                            </p>
                                        </div>
                                        {editingNodeType && (
                                            <button
                                                onClick={() => {
                                                    setEditingNodeType(null);
                                                    setNodeForm({ id: '', display_name: '', icon_reference: 'Boxes', parent_categories: [] });
                                                }}
                                                className="p-2 text-content-tertiary hover:text-content-primary rounded-xl transition-all border border-white/5"
                                            >
                                                <X className="w-5 h-5" />
                                            </button>
                                        )}
                                    </div>

                                    <form onSubmit={handleNodeTypeSubmit} className="space-y-6">
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                            <Input
                                                label="Sub Category ID"
                                                value={nodeForm.id}
                                                onChange={e => !editingNodeType && setNodeForm({ ...nodeForm, id: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
                                                placeholder="e.g. video_upscale"
                                                required
                                                disabled={!!editingNodeType}
                                            />
                                            <Input
                                                label="Display Name"
                                                value={nodeForm.display_name}
                                                onChange={e => setNodeForm({ ...nodeForm, display_name: e.target.value })}
                                                placeholder="e.g. Video Upscaler"
                                                required
                                            />
                                            <div className="space-y-2">
                                                <Input
                                                    label="Icon Name"
                                                    value={nodeForm.icon_reference}
                                                    onChange={e => setNodeForm({ ...nodeForm, icon_reference: e.target.value })}
                                                    placeholder="e.g. Sparkles, Zap, Image..."
                                                />
                                                <p className="text-[10px] text-content-tertiary px-1 flex items-center gap-1.5 leading-relaxed font-medium">
                                                    <Info className="w-3 h-3 text-accent-primary" />
                                                    <span>Find icon names in the <a href="https://lucide.dev/icons" target="_blank" rel="noopener noreferrer" className="text-accent-primary hover:underline underline-offset-2 font-bold inline-flex items-center gap-0.5">Lucide Directory <ExternalLink className="w-2.5 h-2.5" /></a></span>
                                                </p>
                                            </div>
                                        </div>

                                        <div>
                                            <label className="text-[10px] font-black text-content-tertiary uppercase tracking-[0.2em] pl-1 block mb-4">
                                                Parent Categories <span className="text-accent-primary">*</span>
                                            </label>
                                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-white/5 p-6 rounded-2xl border border-white/5 backdrop-blur-sm shadow-inner">
                                                {categories.map(cat => (
                                                    <label key={cat.id} className="flex items-center gap-3 cursor-pointer group select-none">
                                                        <div className="relative flex items-center justify-center w-5 h-5 transition-transform group-active:scale-95">
                                                            <input
                                                                type="checkbox"
                                                                className="peer appearance-none w-5 h-5 border-2 border-white/10 rounded-lg bg-white/5 checked:bg-accent-primary checked:border-accent-primary transition-all cursor-pointer group-hover:border-white/20"
                                                                checked={nodeForm.parent_categories.includes(cat.id)}
                                                                onChange={(e) => {
                                                                    if (e.target.checked) {
                                                                        setNodeForm(prev => ({ ...prev, parent_categories: [...prev.parent_categories, cat.id] }));
                                                                    } else {
                                                                        setNodeForm(prev => ({ ...prev, parent_categories: prev.parent_categories.filter(id => id !== cat.id) }));
                                                                    }
                                                                }}
                                                            />
                                                            <CheckCircle2 className="w-3 h-3 text-white absolute opacity-0 peer-checked:opacity-100 pointer-events-none transition-all scale-50 peer-checked:scale-100" />
                                                        </div>
                                                        <span className="text-xs font-bold text-content-tertiary group-hover:text-content-primary transition-colors uppercase tracking-tight">
                                                            {cat.display_name}
                                                        </span>
                                                    </label>
                                                ))}
                                            </div>
                                            {categories.length === 0 && (
                                                <div className="flex items-center gap-2 mt-4 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-xl">
                                                    <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                                                    <p className="text-[10px] text-red-400 font-bold uppercase tracking-wider">No categories available to select.</p>
                                                </div>
                                            )}
                                        </div>

                                        <div className="pt-8 border-t border-white/5 flex justify-end">
                                            <button
                                                type="submit"
                                                disabled={nodeSubmitting || loading}
                                                className="px-8 py-3 bg-content-primary text-surface-primary font-black uppercase tracking-widest text-[10px] rounded-2xl hover:bg-content-secondary transition-all disabled:opacity-50 flex items-center gap-2 hover:scale-[1.02] active:scale-[0.98] shadow-xl"
                                            >
                                                {nodeSubmitting && <div className="w-4 h-4 border-2 border-surface-primary/30 border-t-surface-primary rounded-full animate-spin" />}
                                                {editingNodeType ? 'Update Category' : 'Initialize Category'}
                                            </button>
                                        </div>
                                    </form>
                                </div>

                                {/* Filters & Search */}
                                <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
                                    <div className="flex flex-1 w-full md:w-auto items-center gap-4">
                                        <div className="relative flex-1 max-w-sm group">
                                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-content-tertiary transition-colors group-focus-within:text-accent-primary" />
                                            <input
                                                type="text"
                                                placeholder="Search sub categories..."
                                                value={subCategorySearch}
                                                onChange={e => setSubCategorySearch(e.target.value)}
                                                className="w-full h-11 pl-12 pr-4 bg-white/5 border border-white/10 rounded-2xl text-xs font-medium text-content-primary focus:outline-none focus:ring-4 focus:ring-accent-primary/10 focus:border-accent-primary/30 transition-all placeholder:text-content-tertiary/50"
                                            />
                                        </div>
                                        <div className="w-px h-6 bg-white/10 hidden md:block" />
                                        <div className="flex items-center gap-2 min-w-[200px]">
                                            <Select
                                                label="Parent Category"
                                                value={subCategoryParentFilter}
                                                onChange={e => setSubCategoryParentFilter(e.target.value)}
                                                options={[
                                                    { id: 'all', display_name: 'All Categories' },
                                                    ...categories.map(cat => ({
                                                        id: cat.id,
                                                        display_name: cat.display_name
                                                    }))
                                                ]}
                                            />
                                        </div>
                                    </div>
                                    <div className="text-[10px] font-black uppercase tracking-[0.2em] text-content-tertiary opacity-40">
                                        Showing {nodeTypes.filter(type => {
                                            const matchesSearch = type.display_name.toLowerCase().includes(subCategorySearch.toLowerCase()) || type.id.toLowerCase().includes(subCategorySearch.toLowerCase());
                                            const matchesParent = subCategoryParentFilter === 'all' || type.parent_categories?.includes(subCategoryParentFilter);
                                            return matchesSearch && matchesParent;
                                        }).length} Results
                                    </div>
                                </div>

                                {/* List */}
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                    {nodeTypes
                                        .filter(type => {
                                            const matchesSearch = type.display_name.toLowerCase().includes(subCategorySearch.toLowerCase()) || type.id.toLowerCase().includes(subCategorySearch.toLowerCase());
                                            const matchesParent = subCategoryParentFilter === 'all' || type.parent_categories?.includes(subCategoryParentFilter);
                                            return matchesSearch && matchesParent;
                                        })
                                        .map(type => {
                                            const IconComponent = (LucideIcons[type.icon_reference as keyof typeof LucideIcons] as React.ComponentType<any>) || Activity;
                                            return (
                                                <div key={type.id} className="group bg-white/5 hover:bg-white/10 border border-white/5 rounded-3xl p-6 transition-all flex flex-col justify-between gap-6 shadow-lg hover:shadow-2xl">
                                                    <div className="flex items-start justify-between">
                                                        <div className="flex items-center gap-4">
                                                            <div className="w-14 h-14 bg-white/5 rounded-2xl flex items-center justify-center border border-white/10 shadow-inner group-hover:bg-accent-primary/10 group-hover:border-accent-primary/20 transition-all">
                                                                <IconComponent className="w-6 h-6 text-accent-primary" />
                                                            </div>
                                                            <div>
                                                                <h4 className="font-bold text-content-primary uppercase tracking-tight text-sm">{type.display_name}</h4>
                                                                <p className="text-[10px] text-content-tertiary font-mono mt-0.5 opacity-60">ID: {type.id}</p>
                                                            </div>
                                                        </div>
                                                        <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                                            <button
                                                                onClick={() => {
                                                                    setEditingNodeType(type);
                                                                    setNodeForm({
                                                                        id: type.id,
                                                                        display_name: type.display_name,
                                                                        icon_reference: type.icon_reference,
                                                                        parent_categories: type.parent_categories || []
                                                                    });
                                                                    window.scrollTo({ top: 0, behavior: 'smooth' });
                                                                }}
                                                                className="p-2 text-content-tertiary hover:text-accent-primary bg-white/10 rounded-xl transition-all border border-white/10 shadow-sm"
                                                            >
                                                                <LucideIcons.Edit2 className="w-3.5 h-3.5" />
                                                            </button>
                                                            <button
                                                                onClick={() => setNodeTypeToDelete(type)}
                                                                className="p-2 text-content-tertiary hover:text-red-500 bg-white/10 rounded-xl transition-all border border-white/10 shadow-sm"
                                                            >
                                                                <LucideIcons.Trash2 className="w-3.5 h-3.5" />
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <div className="pt-4 border-t border-white/5">
                                                        <div className="flex flex-wrap gap-2">
                                                            {type.parent_categories?.map((catId: string) => (
                                                                <span key={catId} className="px-2 py-0.5 bg-white/5 border border-white/10 rounded-lg text-content-tertiary text-[8px] font-black uppercase tracking-widest">
                                                                    {catId}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    {nodeTypes.length === 0 && (
                                        <div className="col-span-full text-center py-20 bg-white/5 rounded-3xl border border-dashed border-white/10">
                                            <Boxes className="w-12 h-12 text-content-tertiary opacity-20 mx-auto mb-4" />
                                            <p className="text-content-tertiary text-xs font-bold uppercase tracking-widest leading-relaxed">
                                                No sub categories initialized.<br />Create your first one above.
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}
                
                {activeTab === 'menu_builder' && (
                    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <ContextMenuBuilder />
                    </div>
                )}
            </main>

            {/* Confirmation Modals */}
            <ConfirmationModal
                isOpen={!!providerToDelete}
                onConfirm={handleProviderDelete}
                onClose={() => setProviderToDelete(null)}
                title="Remove Provider?"
                message={`Are you sure you want to delete "${providerToDelete?.name}"? This will detach it from all associated models but won't delete the models themselves.`}
                variant="danger"
            />

            <ConfirmationModal
                isOpen={!!modelToDelete}
                onConfirm={handleModelDelete}
                onClose={() => setModelToDelete(null)}
                title="Remove Neural Model?"
                message={`Are you sure you want to delete this model? This action is irreversible and will remove it from all existing workflows.`}
                variant="danger"
            />

            <ConfirmationModal
                isOpen={!!nodeTypeToDelete}
                onConfirm={handleNodeTypeDelete}
                onClose={() => setNodeTypeToDelete(null)}
                title="Remove Sub Category?"
                message={`Are you sure you want to delete "${nodeTypeToDelete?.display_name}"? This may affect models associated with this category.`}
                variant="danger"
            />

            {(activeTab === 'models' || activeTab === 'management') && <CostCalculator />}
        </div>
    );
}
