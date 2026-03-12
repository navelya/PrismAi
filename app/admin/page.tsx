'use client';

import React, { useState, useEffect } from 'react';
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
    Link2
} from 'lucide-react';
import { modelsAdminApi } from '@/lib/api/admin';

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
        <div className="py-8 border-b border-stroke-subtle last:border-0">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="md:col-span-1">
                    <h3 className="font-medium text-content-primary inline-flex items-center gap-2">
                        {title}
                    </h3>
                    <p className="text-sm mt-1 text-content-secondary">{description}</p>
                </div>
                <div className="md:col-span-2 space-y-4">
                    {children}
                </div>
            </div>
        </div>
    );
}

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label: string;
    error?: string;
}

function Input({ label, error, className = '', ...props }: InputProps) {
    return (
        <div className="space-y-1.5 flex-1">
            <label className="text-xs font-semibold text-content-tertiary uppercase tracking-wider pl-1 flex items-center gap-1.5">
                {label}
                {props.required && <span className="text-red-500">*</span>}
            </label>
            <input
                {...props}
                className={`w-full px-4 py-2.5 bg-surface-tertiary border border-stroke-subtle rounded-lg text-content-primary focus:outline-none focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/20 transition-all ${error ? 'border-red-500' : ''} ${className}`}
            />
            {error && <p className="text-xs text-red-500 pl-1">{error}</p>}
        </div>
    );
}

// =============================================================================
// VISUAL BUILDER DICTIONARY
// =============================================================================

const COMPONENT_DICTIONARY = [
    { id: 'prompt_textarea', label: 'Prompt (Textarea)', type: 'string', default_value: '' },
    { id: 'negative_prompt', label: 'Negative Prompt', type: 'string', default_value: '' },
    { id: 'aspect_ratio', label: 'Aspect Ratio Dropdown', type: 'string', default_value: '1:1' },
    { id: 'seed_input', label: 'Seed Number', type: 'number', default_value: 0 },
    { id: 'resolution', label: 'Image Resolution (W x H)', type: 'string', default_value: '1024x1024' },
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
        <div className="w-full h-full flex flex-col bg-surface-secondary overflow-y-auto">
            {/* Header */}
            <header className="sticky top-0 z-30 bg-surface-primary border-b border-stroke-subtle px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <button
                        onClick={() => router.back()}
                        className="p-2 -ml-2 rounded-lg hover:bg-surface-tertiary transition-colors text-content-secondary"
                    >
                        <ArrowLeft className="w-5 h-5" />
                    </button>
                    <div>
                        <div className="flex items-center gap-2">
                            <Database className="w-5 h-5 text-accent-primary" />
                            <h1 className="text-xl font-bold text-content-primary">Admin Registry</h1>
                        </div>
                        <p className="text-xs text-content-tertiary">Headless CMS for Node Definitions</p>
                    </div>
                </div>

                {/* Segmented Control */}
                <div className="flex items-center bg-surface-tertiary p-1 rounded-xl border border-stroke-subtle shrink-0">
                    <button
                        onClick={() => setActiveTab('models')}
                        className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'models'
                                ? 'bg-surface-primary text-content-primary shadow-sm ring-1 ring-stroke-subtle'
                                : 'text-content-tertiary hover:text-content-secondary'
                            }`}
                    >
                        Manage AI Models
                    </button>
                    <button
                        onClick={() => setActiveTab('nodes')}
                        className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${activeTab === 'nodes'
                                ? 'bg-surface-primary text-content-primary shadow-sm ring-1 ring-stroke-subtle'
                                : 'text-content-tertiary hover:text-content-secondary'
                            }`}
                    >
                        Manage Node Types
                    </button>
                </div>
            </header>

            <main className="flex-1 max-w-5xl mx-auto w-full p-6 md:p-10">
                {status && (
                    <div className={`mb-8 p-4 rounded-xl border flex items-start gap-3 animate-in fade-in slide-in-from-top-4 ${status.type === 'success'
                            ? 'bg-green-500/10 border-green-500/20 text-green-600'
                            : 'bg-red-500/10 border-red-500/20 text-red-600'
                        }`}>
                        {status.type === 'success' ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <AlertCircle className="w-5 h-5 shrink-0" />}
                        <p className="text-sm font-medium">{status.message}</p>
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
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                <div className="space-y-1.5">
                                    <label className="text-xs font-semibold text-content-tertiary uppercase tracking-wider pl-1">Category</label>
                                    <select
                                        value={modelForm.category_id}
                                        onChange={e => setModelForm({ ...modelForm, category_id: e.target.value })}
                                        className="w-full px-4 py-2.5 bg-surface-tertiary border border-stroke-subtle rounded-lg text-content-primary focus:outline-none focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/20 appearance-none"
                                    >
                                        {categories.map(cat => <option key={cat.id} value={cat.id}>{cat.display_name}</option>)}
                                    </select>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-semibold text-content-tertiary uppercase tracking-wider pl-1">Node Type (Filtered)</label>
                                    <select
                                        value={modelForm.node_type_id}
                                        onChange={e => setModelForm({ ...modelForm, node_type_id: e.target.value })}
                                        disabled={!modelForm.category_id || filteredNodeTypes.length === 0}
                                        className="w-full px-4 py-2.5 bg-surface-tertiary border border-stroke-subtle rounded-lg text-content-primary focus:outline-none focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/20 appearance-none disabled:opacity-50"
                                    >
                                        {filteredNodeTypes.length === 0 ? <option value="">No types available</option> : null}
                                        {filteredNodeTypes.map(nt => <option key={nt.id} value={nt.id}>{nt.display_name}</option>)}
                                    </select>
                                </div>
                                <div className="space-y-1.5">
                                    <label className="text-xs font-semibold text-content-tertiary uppercase tracking-wider pl-1">Node Archetype</label>
                                    <select
                                        value={modelForm.archetype_id}
                                        onChange={e => setModelForm({ ...modelForm, archetype_id: e.target.value })}
                                        className="w-full px-4 py-2.5 bg-surface-tertiary border border-stroke-subtle rounded-lg text-content-primary focus:outline-none focus:border-accent-primary focus:ring-1 focus:ring-accent-primary/20 appearance-none"
                                    >
                                        {archetypes.map(arch => <option key={arch.id} value={arch.id}>{arch.component_name}</option>)}
                                    </select>
                                </div>
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
                        <div className="pt-8 border-b border-stroke-subtle pb-8">
                            <div className="mb-6 flex justify-between items-center bg-surface-tertiary p-4 rounded-xl border border-stroke-subtle">
                                <div>
                                    <h3 className="font-semibold text-content-primary text-base inline-flex items-center gap-2 decoration-accent-primary">
                                        <Layers className="w-5 h-5 text-accent-primary" />
                                        Visual Schema Builder
                                    </h3>
                                    <p className="text-sm text-content-secondary mt-1 max-w-lg">
                                        Design the node's UI controls and data flow handles. This automatically compiles to JSON on save.
                                    </p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setVisualControls([...visualControls, { id: Math.random().toString(), component_id: COMPONENT_DICTIONARY[0].id, api_key: '', default_value: COMPONENT_DICTIONARY[0].default_value }])}
                                        className="flex items-center gap-2 px-3 py-1.5 bg-surface-primary hover:bg-interactive-hover border border-stroke-subtle text-content-primary text-sm font-medium rounded-lg transition-colors"
                                    >
                                        <Settings2 className="w-4 h-4" /> Property
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setVisualInputWires([...visualInputWires, { id: Math.random().toString(), name: 'input', type: 'image' }])}
                                        className="flex items-center gap-2 px-3 py-1.5 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 text-blue-600 text-sm font-medium rounded-lg transition-colors"
                                    >
                                        <Link2 className="w-4 h-4" /> In Wire
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setVisualOutputWires([...visualOutputWires, { id: Math.random().toString(), name: 'output', type: 'image' }])}
                                        className="flex items-center gap-2 px-3 py-1.5 bg-green-500/10 hover:bg-green-500/20 border border-green-500/20 text-green-600 text-sm font-medium rounded-lg transition-colors"
                                    >
                                        <Link2 className="w-4 h-4" /> Out Wire
                                    </button>
                                </div>
                            </div>

                            <div className="space-y-4">
                                {/* Input Wires */}
                                {visualInputWires.length > 0 && (
                                    <div className="bg-surface-primary border border-blue-500/20 rounded-xl p-4 shadow-sm relative overflow-hidden">
                                        <div className="absolute top-0 left-0 w-1 h-full bg-blue-500/50"></div>
                                        <h4 className="text-xs font-bold text-blue-500 uppercase tracking-wider mb-4 pl-2">Input Wires (Handles)</h4>
                                        <div className="space-y-3">
                                            {visualInputWires.map((wire, idx) => (
                                                <div key={wire.id} className="flex items-center gap-3 bg-surface-tertiary p-2 rounded-lg border border-stroke-subtle">
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
                                                    <div className="space-y-1.5 flex-1 max-w-[150px]">
                                                        <label className="text-xs font-semibold text-content-tertiary uppercase tracking-wider pl-1">Type</label>
                                                        <select
                                                            value={wire.type}
                                                            onChange={e => {
                                                                const newWires = [...visualInputWires];
                                                                newWires[idx].type = e.target.value;
                                                                setVisualInputWires(newWires);
                                                            }}
                                                            className="w-full px-3 py-2.5 bg-surface-primary border border-stroke-subtle rounded-lg text-sm text-content-primary appearance-none focus:outline-none focus:border-accent-primary"
                                                        >
                                                            {WIRE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                                        </select>
                                                    </div>
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
                                    <div className="bg-surface-primary border border-stroke-subtle rounded-xl p-4 shadow-sm relative overflow-hidden">
                                        <div className="absolute top-0 left-0 w-1 h-full bg-accent-primary/50"></div>
                                        <h4 className="text-xs font-bold text-content-secondary uppercase tracking-wider mb-4 pl-2">UI Properties (Controls)</h4>
                                        <div className="space-y-3">
                                            {visualControls.map((ctrl, idx) => (
                                                <div key={ctrl.id} className="flex flex-col sm:flex-row sm:items-center gap-3 bg-surface-tertiary p-3 rounded-lg border border-stroke-subtle">

                                                    <div className="space-y-1.5 flex-1 min-w-[200px]">
                                                        <label className="text-xs font-semibold text-content-tertiary uppercase tracking-wider pl-1">UI Component</label>
                                                        <select
                                                            value={ctrl.component_id}
                                                            onChange={e => {
                                                                const newCtrls = [...visualControls];
                                                                const dictItem = COMPONENT_DICTIONARY.find(d => d.id === e.target.value);
                                                                newCtrls[idx].component_id = e.target.value;
                                                                newCtrls[idx].default_value = dictItem?.default_value;
                                                                setVisualControls(newCtrls);
                                                            }}
                                                            className="w-full px-3 py-2.5 bg-surface-primary border border-stroke-subtle rounded-lg text-sm text-content-primary appearance-none font-medium focus:outline-none focus:border-accent-primary"
                                                        >
                                                            {COMPONENT_DICTIONARY.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
                                                        </select>
                                                    </div>

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
                                    <div className="bg-surface-primary border border-green-500/20 rounded-xl p-4 shadow-sm relative overflow-hidden">
                                        <div className="absolute top-0 left-0 w-1 h-full bg-green-500/50"></div>
                                        <h4 className="text-xs font-bold text-green-600 uppercase tracking-wider mb-4 pl-2">Output Wires (Handles)</h4>
                                        <div className="space-y-3">
                                            {visualOutputWires.map((wire, idx) => (
                                                <div key={wire.id} className="flex items-center gap-3 bg-surface-tertiary p-2 rounded-lg border border-stroke-subtle">
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
                                                    <div className="space-y-1.5 flex-1 max-w-[150px]">
                                                        <label className="text-xs font-semibold text-content-tertiary uppercase tracking-wider pl-1">Type</label>
                                                        <select
                                                            value={wire.type}
                                                            onChange={e => {
                                                                const newWires = [...visualOutputWires];
                                                                newWires[idx].type = e.target.value;
                                                                setVisualOutputWires(newWires);
                                                            }}
                                                            className="w-full px-3 py-2.5 bg-surface-primary border border-stroke-subtle rounded-lg text-sm text-content-primary appearance-none focus:outline-none focus:border-accent-primary"
                                                        >
                                                            {WIRE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                                        </select>
                                                    </div>
                                                    <button type="button" onClick={() => setVisualOutputWires(visualOutputWires.filter(w => w.id !== wire.id))} className="p-2 text-content-tertiary hover:text-red-500 mt-5">
                                                        <Trash2 className="w-5 h-5" />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {visualControls.length === 0 && visualInputWires.length === 0 && visualOutputWires.length === 0 && (
                                    <div className="text-center py-10 bg-surface-tertiary rounded-xl border border-dashed border-stroke-subtle">
                                        <Layers className="w-10 h-10 text-content-tertiary mx-auto mb-3 opacity-50" />
                                        <p className="text-content-secondary text-sm">No schema defined yet.</p>
                                        <p className="text-content-tertiary text-xs mt-1">Add properties or wires using the buttons above.</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="pt-6 flex justify-end">
                            <button
                                type="submit"
                                disabled={modelSubmitting || loading}
                                className="px-8 py-3 bg-gradient-premium text-white font-bold rounded-xl hover:opacity-90 transition-opacity disabled:opacity-50 shadow-xl shadow-accent-primary/30 flex items-center gap-2"
                            >
                                {modelSubmitting && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                                Compile JSON & Register Model
                            </button>
                        </div>
                    </form>
                )}


                {/* ========================================================= */}
                {/* MANAGE NODE TYPES VIEW */}
                {/* ========================================================= */}
                {activeTab === 'nodes' && (
                    <div className="space-y-6 animate-in fade-in">
                        <div className="bg-surface-primary border border-stroke-subtle rounded-xl p-6 shadow-sm">
                            <div>
                                <h3 className="text-lg font-bold text-content-primary mb-1">Create New Node Type</h3>
                                <p className="text-sm text-content-secondary mb-6">
                                    Node Types define sub-categories (like 'Image to Image') and appear dynamically based on their parent categories.
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
                                    <label className="text-xs font-semibold text-content-tertiary uppercase tracking-wider pl-1 block mb-3">
                                        Parent Categories <span className="text-red-500">*</span>
                                    </label>
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 bg-surface-tertiary p-4 rounded-xl border border-stroke-subtle">
                                        {categories.map(cat => (
                                            <label key={cat.id} className="flex items-center gap-3 cursor-pointer group">
                                                <div className="relative flex items-center justify-center w-5 h-5">
                                                    <input
                                                        type="checkbox"
                                                        className="peer appearance-none w-5 h-5 border-2 border-stroke-subtle rounded bg-surface-primary checked:bg-accent-primary checked:border-accent-primary transition-colors cursor-pointer"
                                                        checked={nodeForm.parent_categories.includes(cat.id)}
                                                        onChange={(e) => {
                                                            if (e.target.checked) {
                                                                setNodeForm(prev => ({ ...prev, parent_categories: [...prev.parent_categories, cat.id] }));
                                                            } else {
                                                                setNodeForm(prev => ({ ...prev, parent_categories: prev.parent_categories.filter(id => id !== cat.id) }));
                                                            }
                                                        }}
                                                    />
                                                    <CheckCircle2 className="w-3.5 h-3.5 text-white absolute opacity-0 peer-checked:opacity-100 pointer-events-none transition-opacity" />
                                                </div>
                                                <span className="text-sm text-content-secondary group-hover:text-content-primary transition-colors">
                                                    {cat.display_name}
                                                </span>
                                            </label>
                                        ))}
                                    </div>
                                    {categories.length === 0 && <p className="text-xs text-red-500 mt-2">No categories available to select.</p>}
                                </div>

                                <div className="pt-4 border-t border-stroke-subtle flex justify-end">
                                    <button
                                        type="submit"
                                        disabled={nodeSubmitting || loading}
                                        className="px-6 py-2.5 bg-content-primary text-surface-primary font-semibold rounded-xl hover:bg-content-secondary transition-colors disabled:opacity-50 flex items-center gap-2"
                                    >
                                        {nodeSubmitting && <div className="w-4 h-4 border-2 border-surface-primary/30 border-t-surface-primary rounded-full animate-spin" />}
                                        Create Type
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
