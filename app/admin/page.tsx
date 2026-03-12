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
    ChevronDown
} from 'lucide-react';
import { modelsAdminApi } from '@/lib/api/admin';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';

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
    { id: 'audio_upload', label: 'Audio File Upload', type: 'string', default_value: '' },
    { id: 'image_upload', label: 'Image File Upload', type: 'string', default_value: '' },
    { id: 'steps', label: 'Inference Steps', type: 'number', default_value: 20 },
    { id: 'guidance', label: 'Guidance Scale', type: 'number', default_value: 7.5 },
];

const WIRE_TYPES = ['image', 'video', 'text', 'audio', 'any'];

// =============================================================================
// MAIN PAGE
// =============================================================================

export default function AdminPage() {
    const router = useRouter();

    // View State
    const [activeTab, setActiveTab] = useState<'models' | 'nodes'>('models');
    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);

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
    const [visualInputWires, setVisualInputWires] = useState<Array<{ id: string, name: string, type: string }>>([]);
    const [visualOutputWires, setVisualOutputWires] = useState<Array<{ id: string, name: string, type: string }>>([]);

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
            const [cats, archs, types] = await Promise.all([
                modelsAdminApi.listCategories(),
                modelsAdminApi.listArchetypes(),
                modelsAdminApi.listNodeTypes()
            ]);
            setCategories(cats);
            setArchetypes(archs);
            setNodeTypes(types);

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

    const handleModelSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setStatus(null);

        // Compile Visual State to JSON
        const compiledInputs = {
            handles: visualInputWires.map(wire => ({ name: wire.name, type: wire.type })),
            controls: visualControls.map(ctrl => {
                const dictItem = COMPONENT_DICTIONARY.find(d => d.id === ctrl.component_id);
                return {
                    name: ctrl.api_key,
                    type: dictItem?.type || 'string',
                    component: ctrl.component_id,
                    default_value: ctrl.default_value
                };
            })
        };

        const compiledOutputs = {
            handles: visualOutputWires.map(wire => ({ name: wire.name, type: wire.type }))
        };

        // Basic sanity check
        if (!modelForm.category_id || !modelForm.node_type_id) {
            setStatus({ type: 'error', message: 'Category and Node Type are required.' });
            return;
        }

        setModelSubmitting(true);
        try {
            await modelsAdminApi.createModel({
                ...modelForm,
                inputs_schema: compiledInputs,
                outputs_schema: compiledOutputs,
                credit_cost: Number(modelForm.credit_cost)
            });
            setStatus({ type: 'success', message: 'AI Model registered successfully!' });

            // Clean up
            setModelForm(prev => ({ ...prev, replicate_model_id: '', display_name: '', credit_cost: 0 }));
            setVisualControls([]);
            setVisualInputWires([]);
            setVisualOutputWires([]);
        } catch (err: any) {
            setStatus({ type: 'error', message: err.message || 'Failed to create AI Model.' });
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
                    <form onSubmit={handleModelSubmit} className="space-y-4">
                        <FormSection
                            title="Model Identification"
                            description="Core identifiers for the Replicate mapping."
                        >
                            <div className="flex flex-col sm:flex-row gap-4">
                                <Input
                                    label="Replicate Model ID"
                                    name="replicate_model_id"
                                    value={modelForm.replicate_model_id}
                                    onChange={e => setModelForm({ ...modelForm, replicate_model_id: e.target.value })}
                                    placeholder="stability-ai/sdxl:39ed..."
                                    required
                                />
                                <Input
                                    label="Display Name"
                                    name="display_name"
                                    value={modelForm.display_name}
                                    onChange={e => setModelForm({ ...modelForm, display_name: e.target.value })}
                                    placeholder="SDXL Base"
                                    required
                                />
                            </div>
                        </FormSection>

                        <FormSection
                            title="Classification"
                            description="Determines where this model sits in the library."
                        >
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                                <Select
                                    label="Category"
                                    value={modelForm.category_id}
                                    options={categories}
                                    onChange={e => setModelForm({ ...modelForm, category_id: e.target.value })}
                                />
                                <Select
                                    label="Node Type (Filtered)"
                                    value={modelForm.node_type_id}
                                    options={filteredNodeTypes}
                                    onChange={e => setModelForm({ ...modelForm, node_type_id: e.target.value })}
                                    disabled={!modelForm.category_id || filteredNodeTypes.length === 0}
                                />
                                <Select
                                    label="Node Archetype"
                                    value={modelForm.archetype_id}
                                    options={archetypes.map(a => ({ id: a.id, display_name: a.component_name }))}
                                    onChange={e => setModelForm({ ...modelForm, archetype_id: e.target.value })}
                                />
                            </div>
                        </FormSection>

                        <FormSection
                            title="Cost & Status"
                            description="Economy and visibility."
                        >
                            <div className="flex items-center gap-8">
                                <Input
                                    label="Credit Cost"
                                    name="credit_cost"
                                    type="number"
                                    value={modelForm.credit_cost}
                                    onChange={e => setModelForm({ ...modelForm, credit_cost: Number(e.target.value) })}
                                    className="max-w-[150px]"
                                />
                                <div className="flex items-center gap-3 pt-5">
                                    <div className="relative">
                                        <input
                                            type="checkbox"
                                            checked={modelForm.is_active}
                                            onChange={() => { }}
                                            className="sr-only peer"
                                        />
                                        <div
                                            onClick={() => setModelForm(prev => ({ ...prev, is_active: !prev.is_active }))}
                                            className="w-11 h-6 bg-surface-tertiary peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-accent-primary/20 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-content-tertiary after:border-stroke-subtle after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-500 after:peer-checked:bg-white cursor-pointer"
                                        ></div>
                                    </div>
                                    <label className="text-sm font-medium text-content-primary select-none">Is Active</label>
                                </div>
                            </div>
                        </FormSection>

                        {/* VISUAL SCHEMA BUILDER */}
                        <div className="pt-12 border-b border-white/5 pb-12">
                            <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between bg-white/5 p-6 rounded-3xl border border-white/10 backdrop-blur-md shadow-2xl gap-6">
                                <div>
                                    <h3 className="font-black text-content-primary text-base inline-flex items-center gap-3 uppercase tracking-tighter">
                                        <div className="w-8 h-8 rounded-xl bg-accent-primary/10 flex items-center justify-center border border-accent-primary/30">
                                            <Layers className="w-4 h-4 text-accent-primary" />
                                        </div>
                                        Visual Schema Builder
                                    </h3>
                                    <p className="text-xs text-content-tertiary mt-2 max-w-lg leading-relaxed font-medium">
                                        Design the node's UI controls and data flow handles. This automatically compiles to JSON on save.
                                    </p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setVisualControls([...visualControls, { id: Math.random().toString(), component_id: COMPONENT_DICTIONARY[0].id, api_key: '', default_value: COMPONENT_DICTIONARY[0].default_value }])}
                                        className="flex items-center gap-2 px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-content-primary text-xs font-bold uppercase tracking-wider rounded-xl transition-all hover:scale-[1.02] active:scale-[0.98]"
                                    >
                                        <Settings2 className="w-4 h-4" /> Property
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setVisualInputWires([...visualInputWires, { id: Math.random().toString(), name: 'input', type: 'image' }])}
                                        className="flex items-center gap-2 px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 text-blue-400 text-xs font-bold uppercase tracking-wider rounded-xl transition-all hover:scale-[1.02] active:scale-[0.98]"
                                    >
                                        <Link2 className="w-4 h-4" /> In Wire
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setVisualOutputWires([...visualOutputWires, { id: Math.random().toString(), name: 'output', type: 'image' }])}
                                        className="flex items-center gap-2 px-4 py-2 bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 text-green-400 text-xs font-bold uppercase tracking-wider rounded-xl transition-all hover:scale-[1.02] active:scale-[0.98]"
                                    >
                                        <Link2 className="w-4 h-4" /> Out Wire
                                    </button>
                                </div>
                            </div>

                            <div className="space-y-4">
                                {/* Input Wires */}
                                {visualInputWires.length > 0 && (
                                    <div className="bg-surface-primary border border-blue-500/20 rounded-xl p-4 shadow-sm relative">
                                        <div className="absolute top-0 left-0 w-1 h-full bg-blue-500/50"></div>
                                        <h4 className="text-[10px] font-black text-blue-400 uppercase tracking-[0.2em] mb-6 pl-2">Input Wires (Handles)</h4>
                                        <div className="space-y-4">
                                            {visualInputWires.map((wire, idx) => (
                                                <div key={wire.id} className="flex items-start gap-5 bg-white/5 p-4 rounded-2xl border border-white/5 group transition-all hover:bg-white/10">
                                                    <Input
                                                        label="Handle Name"
                                                        value={wire.name}
                                                        onChange={e => {
                                                            const newWires = [...visualInputWires];
                                                            newWires[idx].name = e.target.value;
                                                            setVisualInputWires(newWires);
                                                        }}
                                                        placeholder="e.g. image"
                                                    />
                                                    <Select
                                                        label="Type"
                                                        value={wire.type}
                                                        className="max-w-[150px]"
                                                        options={WIRE_TYPES.map(t => ({ id: t, display_name: t }))}
                                                        onChange={e => {
                                                            const newWires = [...visualInputWires];
                                                            newWires[idx].type = e.target.value;
                                                            setVisualInputWires(newWires);
                                                        }}
                                                    />
                                                    <button type="button" onClick={() => setVisualInputWires(visualInputWires.filter(w => w.id !== wire.id))} className="p-2 text-content-tertiary hover:text-red-500 mt-5">
                                                        <Trash2 className="w-5 h-5" />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* UI Controls */}
                                {visualControls.length > 0 && (
                                    <div className="bg-surface-primary border border-stroke-subtle rounded-xl p-4 shadow-sm relative">
                                        <div className="absolute top-0 left-0 w-1 h-full bg-accent-primary/50"></div>
                                        <h4 className="text-[10px] font-black text-content-tertiary uppercase tracking-[0.2em] mb-6 pl-2">UI Properties (Controls)</h4>
                                        <div className="space-y-4">
                                            {visualControls.map((ctrl, idx) => (
                                                <div key={ctrl.id} className="flex flex-col md:flex-row items-start gap-5 bg-white/5 p-4 rounded-2xl border border-white/5 group transition-all hover:bg-white/10">

                                                    <Select
                                                        label="UI Component"
                                                        value={ctrl.component_id}
                                                        className="min-w-[200px]"
                                                        options={COMPONENT_DICTIONARY.map(c => ({ id: c.id, display_name: c.label }))}
                                                        onChange={e => {
                                                            const newCtrls = [...visualControls];
                                                            const dictItem = COMPONENT_DICTIONARY.find(d => d.id === e.target.value);
                                                            newCtrls[idx].component_id = e.target.value;
                                                            newCtrls[idx].default_value = dictItem?.default_value;
                                                            setVisualControls(newCtrls);
                                                        }}
                                                    />

                                                    <Input
                                                        label="Replicate API Key"
                                                        value={ctrl.api_key}
                                                        onChange={e => {
                                                            const newCtrls = [...visualControls];
                                                            newCtrls[idx].api_key = e.target.value;
                                                            setVisualControls(newCtrls);
                                                        }}
                                                        placeholder="e.g. prompt, aspect_ratio"
                                                        required
                                                    />

                                                    <Input
                                                        label="Default Value"
                                                        value={ctrl.default_value}
                                                        onChange={e => {
                                                            const newCtrls = [...visualControls];
                                                            // attempt number parse if needed, skip for now.
                                                            newCtrls[idx].default_value = e.target.value;
                                                            setVisualControls(newCtrls);
                                                        }}
                                                        className="font-mono text-xs max-w-[150px]"
                                                    />

                                                    <button type="button" onClick={() => setVisualControls(visualControls.filter(c => c.id !== ctrl.id))} className="p-2 text-content-tertiary hover:text-red-500 sm:mt-5 self-end sm:self-auto">
                                                        <Trash2 className="w-5 h-5" />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Output Wires */}
                                {visualOutputWires.length > 0 && (
                                    <div className="bg-surface-primary border border-green-500/20 rounded-xl p-4 shadow-sm relative">
                                        <div className="absolute top-0 left-0 w-1 h-full bg-green-500/50"></div>
                                        <h4 className="text-[10px] font-black text-green-500 uppercase tracking-[0.2em] mb-6 pl-2">Output Wires (Handles)</h4>
                                        <div className="space-y-4">
                                            {visualOutputWires.map((wire, idx) => (
                                                <div key={wire.id} className="flex items-start gap-5 bg-white/5 p-4 rounded-2xl border border-white/5 group transition-all hover:bg-white/10">
                                                    <Input
                                                        label="Handle Name"
                                                        value={wire.name}
                                                        onChange={e => {
                                                            const newWires = [...visualOutputWires];
                                                            newWires[idx].name = e.target.value;
                                                            setVisualOutputWires(newWires);
                                                        }}
                                                        placeholder="e.g. output"
                                                    />
                                                    <Select
                                                        label="Type"
                                                        value={wire.type}
                                                        className="max-w-[150px]"
                                                        options={WIRE_TYPES.map(t => ({ id: t, display_name: t }))}
                                                        onChange={e => {
                                                            const newWires = [...visualOutputWires];
                                                            newWires[idx].type = e.target.value;
                                                            setVisualOutputWires(newWires);
                                                        }}
                                                    />
                                                    <button type="button" onClick={() => setVisualOutputWires(visualOutputWires.filter(w => w.id !== wire.id))} className="p-2 text-content-tertiary hover:text-red-500 mt-5">
                                                        <Trash2 className="w-5 h-5" />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {visualControls.length === 0 && visualInputWires.length === 0 && visualOutputWires.length === 0 && (
                                    <div className="text-center py-16 bg-white/5 rounded-3xl border border-dashed border-white/10 backdrop-blur-sm">
                                        <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mx-auto mb-6 border border-white/10 shadow-2xl">
                                            <Layers className="w-8 h-8 text-content-tertiary opacity-40" />
                                        </div>
                                        <p className="text-content-primary text-sm font-bold uppercase tracking-tight">No schema defined yet</p>
                                        <p className="text-content-tertiary text-[10px] mt-2 max-w-[200px] mx-auto leading-relaxed font-medium opacity-60">Add properties or wires using the action bar above to start building.</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="pt-12 flex justify-end">
                            <button
                                type="submit"
                                disabled={modelSubmitting || loading}
                                className="px-10 py-4 bg-gradient-premium text-white font-black uppercase tracking-widest text-xs rounded-2xl hover:opacity-90 transition-all disabled:opacity-50 shadow-2xl shadow-accent-primary/40 flex items-center gap-3 hover:scale-[1.02] active:scale-[0.98]"
                            >
                                {modelSubmitting && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                                <Save className="w-4 h-4" />
                                Register Asset
                            </button>
                        </div>
                    </form>
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
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
        </div>
    );
}
