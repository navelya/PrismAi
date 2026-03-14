'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
    Boxes,
    ArrowLeft,
    Plus,
    Save,
    AlertCircle,
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
    Info,
    ExternalLink
} from 'lucide-react';
import { modelsAdminApi } from '@/lib/api/admin';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { NumberInput } from '@/components/ui/NumberInput';
import { Checkbox } from '@/components/ui/Checkbox';
import { ConfirmationModal } from '@/components/ui/ConfirmationModal';
import { ModelForm } from '@/components/admin/ModelForm';
import { Download, Edit2, Search, Filter } from 'lucide-react';

// =============================================================================
// UI COMPONENTS
// =============================================================================

interface FormSectionProps {
    title: string;
    description: string;
    children: React.ReactNode;
}

function FormSection({ title, description, children }: FormSectionProps) {
    return (
        <div className="py-8 border-b border-white/5 last:border-0">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                <div className="md:col-span-1">
                    <h3 className="font-bold text-content-primary inline-flex items-center gap-2 text-sm tracking-tight uppercase">
                        {title}
                    </h3>
                    <p className="text-xs mt-2 text-content-tertiary leading-relaxed opacity-70">{description}</p>
                </div>
                <div className="md:col-span-2 space-y-5">
                    {children}
                </div>
            </div>
        </div>
    );
}


// =============================================================================
// VISUAL BUILDER DICTIONARY
// =============================================================================

const COMPONENT_DICTIONARY = [
    { id: 'prompt_textarea', label: 'Prompt (Textarea)', type: 'string', default_value: '' },
    { id: 'negative_prompt', label: 'Negative Prompt', type: 'string', default_value: '' },
    { id: 'aspect_ratio', label: 'Aspect Ratio', type: 'string', default_value: '1:1' },
    { id: 'resolution', label: 'Resolution', type: 'string', default_value: '1024x1024' },
    { id: 'format', label: 'Format', type: 'string', default_value: '' },
    { id: 'reverse', label: 'Reverse', type: 'string', default_value: '' },
    { id: 'threshold', label: 'Threshold', type: 'number', default_value: 0 },
];

const WIRE_TYPES = ['image', 'video', 'text', 'audio', 'any'];

// =============================================================================
// MAIN PAGE
// =============================================================================

export default function AdminPage() {
    const router = useRouter();

    // View State
    const [activeTab, setActiveTab] = useState<'models' | 'nodes' | 'management'>('models');
    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);

    // Management State
    const [allModels, setAllModels] = useState<any[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [categoryFilter, setCategoryFilter] = useState('all');
    const [activeFilter, setActiveFilter] = useState('all');
    const [editingModel, setEditingModel] = useState<any | null>(null);
    const [modelToDelete, setModelToDelete] = useState<any | null>(null);

    // Dynamic Data
    const [categories, setCategories] = useState<any[]>([]);
    const [archetypes, setArchetypes] = useState<any[]>([]);
    const [nodeTypes, setNodeTypes] = useState<any[]>([]);

    // -------------------------------------------------------------------------
    // AI MODEL FORM STATE (Visual Builder)
    // -------------------------------------------------------------------------
    const [modelForm, setModelForm] = useState({
        replicate_model_id: '',
        display_name: '',
        credit_cost: 0,
        is_active: true,
        category_id: '',
        node_type_id: '',
        archetype_id: '',
    });

    // Visual Schema States
    const [visualControls, setVisualControls] = useState<Array<{ id: string, component_id: string, api_key: string, default_value: any }>>([]);
    const [visualInputWires, setVisualInputWires] = useState<Array<{ id: string, name: string, api_key: string, type: string, is_array: boolean }>>([]);
    const [visualOutputWires, setVisualOutputWires] = useState<Array<{ id: string, name: string, type: string, is_array: boolean }>>([]);

    const [modelSubmitting, setModelSubmitting] = useState(false);

    // -------------------------------------------------------------------------
    // NODE TYPE FORM STATE
    // -------------------------------------------------------------------------
    const [nodeForm, setNodeForm] = useState({
        id: '',
        display_name: '',
        icon_reference: 'Boxes',
        parent_categories: [] as string[]
    });
    const [nodeSubmitting, setNodeSubmitting] = useState(false);

    // =========================================================================

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        setLoading(true);
        try {
            const [cats, archs, types, mods] = await Promise.all([
                modelsAdminApi.listCategories(),
                modelsAdminApi.listArchetypes(),
                modelsAdminApi.listNodeTypes(),
                modelsAdminApi.listModels()
            ]);
            setCategories(cats);
            setArchetypes(archs);
            setNodeTypes(types);
            setAllModels(mods);

            // Set defaults if data exists for models form
            if (cats.length > 0) setModelForm(prev => ({ ...prev, category_id: cats[0].id }));
            if (archs.length > 0) setModelForm(prev => ({ ...prev, archetype_id: archs[0].id }));
        } catch (err) {
            console.error('Failed to load initial data:', err);
            setStatus({ type: 'error', message: 'Failed to load database items.' });
        } finally {
            setLoading(false);
        }
    }

    // -------------------------------------------------------------------------
    // HANDLE SUBMITS
    // -------------------------------------------------------------------------

    const handleModelSubmit = async (data: any) => {
        setStatus(null);
        setModelSubmitting(true);
        try {
            if (editingModel) {
                await modelsAdminApi.updateModel(editingModel.id, data);
                setStatus({ type: 'success', message: 'AI Model updated successfully!' });
                setEditingModel(null);
            } else {
                await modelsAdminApi.createModel(data);
                setStatus({ type: 'success', message: 'AI Model registered successfully!' });
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
            await modelsAdminApi.createNodeType(nodeForm);
            setStatus({ type: 'success', message: 'Node Type created successfully!' });

            // Clean up & Reload
            setNodeForm({ id: '', display_name: '', icon_reference: 'Boxes', parent_categories: [] });
            await loadData(); // refresh the dropdowns
        } catch (err: any) {
            setStatus({ type: 'error', message: err.message || 'Failed to create Node Type.' });
        } finally {
            setNodeSubmitting(false);
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

    // -------------------------------------------------------------------------
    // RENDER HELPERS
    // -------------------------------------------------------------------------

    // Dynamic filtering for Node Types based on selected Category
    const filteredNodeTypes = nodeTypes.filter(nt =>
        nt.parent_categories?.includes(modelForm.category_id)
    );

    useEffect(() => {
        // Auto-select first available node type when category changes, or clear it
        if (filteredNodeTypes.length > 0 && !filteredNodeTypes.find(nt => nt.id === modelForm.node_type_id)) {
            setModelForm(prev => ({ ...prev, node_type_id: filteredNodeTypes[0].id }));
        } else if (filteredNodeTypes.length === 0) {
            setModelForm(prev => ({ ...prev, node_type_id: '' }));
        }
    }, [modelForm.category_id, filteredNodeTypes.length]);


    return (
        <div className="w-full h-full flex flex-col bg-surface-primary mesh-gradient overflow-y-auto custom-scrollbar">
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
                        onClick={() => setActiveTab('models')}
                        className={`px-5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${activeTab === 'models'
                            ? 'bg-white/10 text-content-primary shadow-premium ring-1 ring-white/20'
                            : 'text-content-tertiary hover:text-content-secondary'
                            }`}
                    >
                        Registry
                    </button>
                    <button
                        onClick={() => setActiveTab('management')}
                        className={`px-5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${activeTab === 'management'
                            ? 'bg-white/10 text-content-primary shadow-premium ring-1 ring-white/20'
                            : 'text-content-tertiary hover:text-content-secondary'
                            }`}
                    >
                        Management
                    </button>
                    <button
                        onClick={() => setActiveTab('nodes')}
                        className={`px-5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${activeTab === 'nodes'
                            ? 'bg-white/10 text-content-primary shadow-premium ring-1 ring-white/20'
                            : 'text-content-tertiary hover:text-content-secondary'
                            }`}
                    >
                        Definitions
                    </button>
                </div>
            </header>

            <main className="flex-1 max-w-6xl mx-auto w-full p-8 md:p-12">
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

                {/* ========================================================= */}
                {/* MANAGE AI MODELS VIEW */}
                {/* ========================================================= */}
                {activeTab === 'models' && (
                    <ModelForm
                        onSubmit={handleModelSubmit}
                        submitting={modelSubmitting}
                        categories={categories}
                        archetypes={archetypes}
                        nodeTypes={nodeTypes}
                    />
                )}

                {/* ========================================================= */}
                {/* MODEL MANAGEMENT VIEW */}
                {/* ========================================================= */}
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
                                .map(model => (
                                    <div key={model.id} className="group bg-white/5 hover:bg-white/10 border border-white/5 rounded-2xl p-6 transition-all flex flex-col md:flex-row md:items-center justify-between gap-6">
                                        <div className="flex items-center gap-5">
                                            <div className={cn(
                                                "w-12 h-12 rounded-xl flex items-center justify-center border shadow-inner",
                                                model.is_active ? "bg-green-500/10 border-green-500/20 text-green-400" : "bg-red-500/10 border-red-500/20 text-red-400"
                                            )}>
                                                <Activity className="w-6 h-6" />
                                            </div>
                                            <div>
                                                <h4 className="font-bold text-content-primary uppercase tracking-tight text-sm">{model.display_name}</h4>
                                                <p className="text-[10px] text-content-tertiary font-mono mt-1 opacity-60">{model.replicate_model_id}</p>
                                                <div className="flex gap-3 mt-2">
                                                    <span className="px-2 py-0.5 bg-white/5 border border-white/10 rounded-lg text-content-tertiary text-[8px] font-black uppercase tracking-widest">{model.category_id}</span>
                                                    <span className="px-2 py-0.5 bg-accent-primary/5 border border-accent-primary/20 rounded-lg text-accent-primary text-[8px] font-black uppercase tracking-widest">{model.credit_cost} Credits</span>
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
                                ))
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
                        />
                    </div>
                )}


                {/* ========================================================= */}
                {/* MANAGE NODE TYPES VIEW */}
                {/* ========================================================= */}
                {activeTab === 'nodes' && (
                    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="glassmorphism rounded-3xl p-10 shadow-2xl relative overflow-hidden group">
                            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-premium opacity-50 group-hover:opacity-100 transition-opacity"></div>
                            <div className="mb-10">
                                <h3 className="text-2xl font-black text-content-primary uppercase tracking-tighter mb-2">New Type Definition</h3>
                                <p className="text-xs text-content-tertiary font-medium opacity-80 leading-relaxed max-w-xl">
                                    Node Types define sub-categories and appear dynamically based on their parent categories. Use these to organize models into logical functional groups.
                                </p>
                            </div>

                            <form onSubmit={handleNodeTypeSubmit} className="space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <Input
                                        label="Type ID"
                                        value={nodeForm.id}
                                        onChange={e => setNodeForm({ ...nodeForm, id: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
                                        placeholder="e.g. video_upscale"
                                        required
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
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 bg-white/5 p-6 rounded-2xl border border-white/5 backdrop-blur-sm">
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
                                        Initialize Type
                                    </button>
                                </div>
                            </form>
                        </div>
                    </div>
                )}
            </main>

            <ConfirmationModal
                isOpen={!!modelToDelete}
                onClose={() => setModelToDelete(null)}
                onConfirm={handleModelDelete}
                title="Delete Model"
                message={`Are you sure you want to delete "${modelToDelete?.display_name}"? This action cannot be undone and will permanently remove all associated data.`}
                confirmText="Delete Model"
                variant="danger"
            />
        </div>
    );
}
