'use client';

import React, { useState, useEffect } from 'react';
import { Reorder } from 'framer-motion';
import { Save, Layers, Link2, Settings2, Trash2, X, Eye, EyeOff, GripVertical, ChevronUp, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { NumberInput } from '@/components/ui/NumberInput';
import { Checkbox } from '@/components/ui/Checkbox';
import { Textarea } from '@/components/ui/Textarea';
import { Switch } from '@/components/ui/Switch';
import { parseReplicateSchema, formatDisplayName } from '@/lib/utils/schema-parser';
import AIGeneratorProperties from '@/lib/nodes/plugins/ai_generator/properties';
import { VoicePickerControl } from '@/lib/nodes/plugins/ai_generator/VoicePickerControl';
import { Control, isSeedControl } from '@/lib/nodes/types';

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

interface ReorderArrowsProps {
    canMoveUp: boolean;
    canMoveDown: boolean;
    onMoveUp: () => void;
    onMoveDown: () => void;
}

function ReorderArrows({ canMoveUp, canMoveDown, onMoveUp, onMoveDown }: ReorderArrowsProps) {
    const stopProp = (e: React.PointerEvent) => e.stopPropagation();
    return (
        <div className="flex items-center select-none" onPointerDown={stopProp}>
            <button
                type="button"
                onClick={onMoveUp}
                disabled={!canMoveUp}
                className="p-1.5 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-white/5 disabled:opacity-20 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
                title="Move up"
            >
                <ChevronUp className="w-4 h-4" />
            </button>
            <button
                type="button"
                onClick={onMoveDown}
                disabled={!canMoveDown}
                className="p-1.5 rounded-lg text-content-tertiary hover:text-content-primary hover:bg-white/5 disabled:opacity-20 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
                title="Move down"
            >
                <ChevronDown className="w-4 h-4" />
            </button>
        </div>
    );
}

function arrayShift<T extends { id: string }>(list: T[], id: string, direction: -1 | 1): T[] {
    const idx = list.findIndex(i => i.id === id);
    if (idx === -1) return list;
    const target = idx + direction;
    if (target < 0 || target >= list.length) return list;
    const next = list.slice();
    [next[idx], next[target]] = [next[target], next[idx]];
    return next;
}

const stopPointerProp = (e: React.PointerEvent) => e.stopPropagation();

// =============================================================================
// CONSTANTS
// =============================================================================

const COMPONENT_DICTIONARY = [
    { id: 'prompt_textarea', label: 'Prompt (Textarea)', type: 'string', default_value: '' },
    { id: 'negative_prompt', label: 'Negative Prompt', type: 'string', default_value: '' },
    { id: 'aspect_ratio', label: 'Aspect Ratio', type: 'string', default_value: '1:1' },
    { id: 'resolution', label: 'Resolution', type: 'string', default_value: '1024x1024' },
    { id: 'format', label: 'Format', type: 'string', default_value: '' },
    { id: 'reverse', label: 'Reverse', type: 'string', default_value: '' },
    { id: 'threshold', label: 'Threshold', type: 'number', default_value: 0 },
    { id: 'voice_picker', label: 'Voice Picker (ElevenLabs)', type: 'string', default_value: '' },
];

const WIRE_TYPES = ['image', 'video', 'text', 'audio', 'any'];

// =============================================================================
// COMPONENT
// =============================================================================

interface ModelFormProps {
    initialData?: any;
    onSubmit: (data: any) => Promise<void>;
    onCancel?: () => void;
    submitting: boolean;
    categories: any[];
    archetypes: any[];
    nodeTypes: any[];
    providers: any[];
}

export function ModelForm({
    initialData,
    onSubmit,
    onCancel,
    submitting,
    categories,
    archetypes,
    nodeTypes,
    providers
}: ModelFormProps) {
    // -------------------------------------------------------------------------
    // STATE
    // -------------------------------------------------------------------------
    const [form, setForm] = useState({
        replicate_model_id: initialData?.replicate_model_id || '',
        display_name: initialData?.display_name || '',
        credit_cost: initialData?.credit_cost || 0,
        is_per_second: initialData?.is_per_second ?? false,
        is_active: initialData?.is_active ?? true,
        archetype_id: initialData?.archetype_id || '',
        provider_id: initialData?.provider_id || '',
        provider_model_id: initialData?.provider_model_id || '',
        category_id: initialData?.category_id || '',
        node_type_id: initialData?.node_type_id || '',
        description: initialData?.inputs_schema?.description || '',
    });

    const [isFetchingSchema, setIsFetchingSchema] = useState(false);
    const [previewConfig, setPreviewConfig] = useState<any>({
        control_values: {}
    });

    // Visual Schema States
    const [visualControls, setVisualControls] = useState<Array<Control & { id: string }>>([]);
    const [visualInputWires, setVisualInputWires] = useState<Array<{ id: string, name: string, api_mapping_key: string, type: string, is_array: boolean, is_mandatory: boolean, is_visible: boolean, cost_per_item?: number, max_items?: number }>>([]);
    const [visualOutputWires, setVisualOutputWires] = useState<Array<{ id: string, name: string, api_mapping_key: string, type: string, is_array: boolean, is_visible: boolean }>>([]);
    const [jsonDefaultDrafts, setJsonDefaultDrafts] = useState<Record<string, string>>({});

    // -------------------------------------------------------------------------
    // INITIALIZATION (EFFECTS)
    // -------------------------------------------------------------------------

    // Handle initialData changes (Edit Mode)
    useEffect(() => {
        if (initialData) {
            setForm({
                replicate_model_id: initialData.replicate_model_id || '',
                display_name: initialData.display_name || '',
                credit_cost: initialData.credit_cost || 0,
                is_per_second: initialData.is_per_second ?? false,
                is_active: initialData.is_active ?? true,
                archetype_id: initialData.archetype_id || '',
                provider_id: initialData.provider_id || '',
                provider_model_id: initialData.provider_model_id || '',
                category_id: initialData.category_id || '',
                node_type_id: initialData.node_type_id || '',
                description: initialData.inputs_schema?.description || '',
            });
        }
    }, [initialData]);

    // Handle default selections when data arrives
    useEffect(() => {
        if (!form.archetype_id && archetypes.length > 0) {
            setForm(prev => ({ ...prev, archetype_id: archetypes[0].id }));
        }
    }, [archetypes, form.archetype_id]);

    useEffect(() => {
        if (initialData?.inputs_schema) {
            const inputs = initialData.inputs_schema;

            // Map handles
            if (inputs.handles) {
                setVisualInputWires(inputs.handles.map((h: any) => ({
                    id: Math.random().toString(),
                    name: h.name,
                    api_mapping_key: h.api_mapping_key,
                    type: h.type || 'image',
                    is_array: h.is_array ?? false,
                    is_mandatory: h.is_mandatory ?? false,
                    is_visible: h.is_visible ?? true,
                    cost_per_item: h.cost_per_item ?? 0,
                    max_items: h.max_items ?? 0
                })));
            }

            // Map controls
            if (inputs.controls) {
                setVisualControls(inputs.controls.map((c: any) => ({
                    ...c,
                    id: Math.random().toString(),
                    is_visible: c.is_visible ?? true
                })));
            }
        }

        if (initialData?.outputs_schema?.handles) {
            setVisualOutputWires(initialData.outputs_schema.handles.map((h: any) => ({
                id: Math.random().toString(),
                name: h.name,
                api_mapping_key: h.api_mapping_key || '',
                type: h.type || 'image',
                is_array: h.is_array ?? false,
                is_visible: h.is_visible ?? true
            })));
        }
    }, [initialData]);

    // Update preview config when controls change
    useEffect(() => {
        setPreviewConfig({
            control_values: visualControls.reduce((acc, ctrl) => ({
                ...acc,
                [ctrl.api_mapping_key]: ctrl.default_value
            }), {})
        });
    }, [visualControls]);

    // -------------------------------------------------------------------------
    // DYNAMIC FILTERING
    // -------------------------------------------------------------------------
    const filteredNodeTypes = nodeTypes.filter(nt =>
        nt.parent_categories?.includes(form.category_id)
    );

    useEffect(() => {
        // Auto-select first available node type when category changes, or clear it
        if (filteredNodeTypes.length > 0 && !filteredNodeTypes.find(nt => nt.id === form.node_type_id)) {
            setForm(prev => ({ ...prev, node_type_id: filteredNodeTypes[0].id }));
        } else if (filteredNodeTypes.length === 0) {
            setForm(prev => ({ ...prev, node_type_id: '' }));
        }
    }, [form.category_id, filteredNodeTypes.length]);

    // -------------------------------------------------------------------------
    // HANDLERS
    // -------------------------------------------------------------------------
    const fetchSchema = async () => {
        if (!form.replicate_model_id) return;
        setIsFetchingSchema(true);
        try {
            const response = await fetch(`/api/replicate/schema?model_id=${form.replicate_model_id}`);
            if (!response.ok) throw new Error('Failed to fetch schema');
            const data = await response.json();
            
            const parsed = parseReplicateSchema(data.openapi_schema);
            
            // Map parsed to state
            setVisualInputWires(parsed.inputs.handles.map((h: any) => ({ ...h, id: Math.random().toString() })));
            setVisualControls(parsed.inputs.controls.map((c: any) => ({ ...c, id: Math.random().toString() })));
            setVisualOutputWires(parsed.outputs.handles.map((h: any) => ({ ...h, id: Math.random().toString() })));

            // Auto-match provider
            const ownerName = data.owner || '';
            const matchedProvider = providers.find(p => p.name.toLowerCase().includes(ownerName.toLowerCase()));
            
            if (matchedProvider) {
                setForm(prev => ({ ...prev, provider_id: matchedProvider.id }));
            } else if (ownerName) {
                // Prompt to add provider if it doesn't exist
                const confirmAdd = window.confirm(`AI Provider "${ownerName}" not found. Would you like to add it automatically?`);
                if (confirmAdd) {
                    try {
                        const createRes = await fetch('/api/admin/providers', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ name: ownerName, is_active: true })
                        });
                        if (createRes.ok) {
                            const newProvider = await createRes.json();
                            // Note: In a real app, we might need to refresh the providers list from the parent
                            // or optimismically add it here. For now, we assume the user might need to re-fetch 
                            // or the parent handles the update.
                            setForm(prev => ({ ...prev, provider_id: newProvider.id }));
                            alert(`Provider "${ownerName}" added successfully.`);
                        }
                    } catch (e) {
                         console.error("Failed to create provider", e);
                    }
                }
            }
            
            if (!form.display_name) {
                const rawName = form.replicate_model_id.split('/')[1]?.split(':')[0] || form.replicate_model_id;
                setForm(prev => ({ ...prev, display_name: formatDisplayName(rawName) }));
            }

            if (data.description) {
                setForm(prev => ({ ...prev, description: data.description }));
            }
        } catch (error) {
            console.error(error);
            alert('Error fetching schema. Please check the Model ID and try again.');
        } finally {
            setIsFetchingSchema(false);
        }
    };

    const handlePreviewUpdate = (newConfig: any) => {
        setPreviewConfig(newConfig);
        // Update default values in visualControls based on preview interaction
        const newControls = visualControls.map(ctrl => ({
            ...ctrl,
            default_value: newConfig.control_values[ctrl.api_mapping_key] ?? ctrl.default_value
        }));
        setVisualControls(newControls);
    };

    const handleToggleVisibility = (key: string, type: 'control' | 'input-handle' | 'output-handle') => {
        if (type === 'control') {
            setVisualControls(prev => prev.map(c => 
                c.api_mapping_key === key ? { ...c, is_visible: !c.is_visible } : c
            ));
        } else if (type === 'input-handle') {
            setVisualInputWires(prev => prev.map(w => 
                w.api_mapping_key === key ? { ...w, is_visible: !w.is_visible } : w
            ));
        } else if (type === 'output-handle') {
            setVisualOutputWires(prev => prev.map(w => 
                w.api_mapping_key === key ? { ...w, is_visible: !w.is_visible } : w
            ));
        }
    };

    const setControlPatch = (controlId: string, patch: Partial<Control>) => {
        setVisualControls(prev => prev.map(c => c.id === controlId ? { ...c, ...patch } : c));
    };

    const parseSelectDefault = (rawValue: string, controlType?: string) => {
        const normalizedType = (controlType || '').toLowerCase();
        if (normalizedType === 'number' || normalizedType === 'integer') {
            const parsed = Number(rawValue);
            return Number.isFinite(parsed) ? parsed : 0;
        }
        if (normalizedType === 'boolean') {
            return rawValue === 'true';
        }
        return rawValue;
    };

    const normalizeDefaultForComponent = (ctrl: Control, nextComponent: Control['component']) => {
        const currentValue = ctrl.default_value;
        // Seed keeps its auto (null) / pinned (number) value regardless of component type.
        if (isSeedControl(ctrl)) return currentValue ?? null;
        const normalizedType = (ctrl.type || '').toLowerCase();
        const isSelect = nextComponent === 'select' || nextComponent === 'aspect_ratio' || nextComponent === 'resolution' || nextComponent === 'format';
        const isBoolean = nextComponent === 'checkbox' || nextComponent === 'reverse' || normalizedType === 'boolean';
        const isNumber = nextComponent === 'slider' || nextComponent === 'number_input' || nextComponent === 'threshold' || normalizedType === 'number' || normalizedType === 'integer';

        if (isSelect && Array.isArray(ctrl.options) && ctrl.options.length > 0) {
            const asStrings = ctrl.options.map(opt => String(opt));
            const currentAsString = currentValue === undefined || currentValue === null ? '' : String(currentValue);
            const selected = asStrings.includes(currentAsString) ? currentAsString : asStrings[0];
            return parseSelectDefault(selected, ctrl.type);
        }

        if (isBoolean) {
            return typeof currentValue === 'boolean' ? currentValue : String(currentValue).toLowerCase() === 'true';
        }

        if (isNumber) {
            const parsed = Number(currentValue);
            return Number.isFinite(parsed) ? parsed : (ctrl.min ?? 0);
        }

        return currentValue ?? '';
    };

    const normalizedControlType = (ctrl: Control) => (ctrl.type || '').toLowerCase();
    const isSelectControl = (ctrl: Control) =>
        ctrl.component === 'select' || ctrl.component === 'aspect_ratio' || ctrl.component === 'resolution' || ctrl.component === 'format';
    const isBooleanControl = (ctrl: Control) =>
        ctrl.component === 'checkbox' || ctrl.component === 'reverse' || (!isSelectControl(ctrl) && normalizedControlType(ctrl) === 'boolean');
    const isNumericControl = (ctrl: Control) =>
        ctrl.component === 'slider' || ctrl.component === 'number_input' || ctrl.component === 'threshold' || (!isSelectControl(ctrl) && (normalizedControlType(ctrl) === 'number' || normalizedControlType(ctrl) === 'integer'));
    const isJsonControl = (ctrl: Control) => normalizedControlType(ctrl) === 'array' || normalizedControlType(ctrl) === 'object';

    const getJsonDraftValue = (ctrl: Control & { id: string }) => {
        if (jsonDefaultDrafts[ctrl.id] !== undefined) {
            return jsonDefaultDrafts[ctrl.id];
        }
        if (typeof ctrl.default_value === 'string') {
            return ctrl.default_value;
        }
        return JSON.stringify(ctrl.default_value ?? (normalizedControlType(ctrl) === 'array' ? [] : {}), null, 2);
    };

    const selectedProvider = providers.find((p: any) => p.id === form.provider_id);
    const isExternalProvider = !!selectedProvider?.adapter_key;

    const applyElevenLabsPreset = () => {
        // Wholesale overwrite — guard against clobbering hand-built controls/inputs.
        if ((visualControls.length > 0 || visualInputWires.length > 0) && !window.confirm('Replace the current controls and inputs with the ElevenLabs speech preset?')) {
            return;
        }
        // Text is an INPUT (wire it from a Prompt/text node), NOT a typed property.
        // The adapter reads inputs['text'] from this handle's api_mapping_key.
        setVisualInputWires([
            { id: 'h_text', name: 'Text', api_mapping_key: 'text', type: 'text', is_array: false, is_mandatory: true, is_visible: true, cost_per_item: 0, max_items: 0 },
        ] as any);
        setVisualControls([
            { id: 'c_voice', api_mapping_key: 'voice_id', label: 'Voice', type: 'string', component: 'voice_picker', default_value: '', is_visible: true },
            { id: 'c_stability', api_mapping_key: 'stability', label: 'Stability', type: 'number', component: 'slider', default_value: 0.5, is_visible: true, min: 0, max: 1, step: 0.01 },
            { id: 'c_similarity', api_mapping_key: 'similarity_boost', label: 'Similarity', type: 'number', component: 'slider', default_value: 0.75, is_visible: true, min: 0, max: 1, step: 0.01 },
            { id: 'c_style', api_mapping_key: 'style', label: 'Style', type: 'number', component: 'slider', default_value: 0, is_visible: true, min: 0, max: 1, step: 0.01 },
            { id: 'c_format', api_mapping_key: 'output_format', label: 'Output format', type: 'string', component: 'select', default_value: 'mp3_44100_128', is_visible: false, options: ['mp3_44100_128', 'mp3_44100_64'] },
        ] as any);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        const compiledInputs = {
            description: form.description,
            handles: visualInputWires.map(wire => ({
                name: wire.name,
                api_mapping_key: wire.api_mapping_key,
                type: wire.type,
                is_array: wire.is_array,
                is_mandatory: wire.is_mandatory,
                is_visible: wire.is_visible,
                cost_per_item: Number(wire.cost_per_item) || 0,
                // max_items only applies to array-capable handles
                max_items: wire.is_array ? (Number(wire.max_items) || 0) : 0
            })),
            controls: visualControls.map(ctrl => {
                const { id, ...rest } = ctrl;
                return rest;
            })
        };

        const compiledOutputs = {
            handles: visualOutputWires.map(wire => ({
                name: wire.name,
                api_mapping_key: wire.api_mapping_key,
                type: wire.type,
                is_array: wire.is_array,
                is_visible: wire.is_visible
            }))
        };

        await onSubmit({
            ...form,
            // External (adapter) models have no Replicate id; clear any stale one
            // left over from switching a Replicate model to an external provider.
            replicate_model_id: isExternalProvider ? null : (form.replicate_model_id || null),
            // Normalize blank → null so the column is never an empty string.
            provider_model_id: form.provider_model_id || null,
            inputs_schema: compiledInputs,
            outputs_schema: compiledOutputs,
            credit_cost: Number(form.credit_cost),
            description: form.description // Pass at top level too for API processing
        });
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <FormSection
                title="Model Identification"
                description="Core identifiers for the Replicate mapping."
            >
                <div className="flex flex-col sm:flex-row gap-4 items-end">
                    <div className="flex-1">
                        <Input
                            label="Replicate Model ID"
                            name="replicate_model_id"
                            value={form.replicate_model_id}
                            onChange={e => setForm({ ...form, replicate_model_id: e.target.value })}
                            placeholder="stability-ai/sdxl:39ed..."
                            required={!isExternalProvider}
                        />
                    </div>
                    <button
                        type="button"
                        onClick={fetchSchema}
                        disabled={isFetchingSchema || !form.replicate_model_id || isExternalProvider}
                        className="mb-0.5 px-4 py-3 bg-accent-primary/10 hover:bg-accent-primary/20 text-accent-primary border border-accent-primary/30 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all disabled:opacity-50 h-[48px]"
                    >
                        {isFetchingSchema ? 'Fetching...' : 'Fetch Schema'}
                    </button>
                    <div className="flex-1">
                        <Input
                            label="Display Name"
                            name="display_name"
                            value={form.display_name}
                            onChange={e => setForm({ ...form, display_name: e.target.value })}
                            placeholder="SDXL Base"
                            required
                        />
                    </div>
                </div>
                <div className="mt-4">
                    <Textarea 
                        label="Model Description"
                        name="description"
                        value={form.description}
                        onChange={e => setForm({ ...form, description: e.target.value })}
                        placeholder="Describe what this model does..."
                        className="max-w-2xl"
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
                        value={form.category_id}
                        options={categories}
                        onChange={e => setForm({ ...form, category_id: e.target.value })}
                    />
                    <Select
                        label="Sub Category (Filtered)"
                        value={form.node_type_id}
                        options={filteredNodeTypes}
                        onChange={e => setForm({ ...form, node_type_id: e.target.value })}
                        disabled={!form.category_id || filteredNodeTypes.length === 0}
                    />
                    <Select
                        label="Node Archetype"
                        value={form.archetype_id || 'none'}
                        options={[
                            { id: 'none', display_name: 'Select Archetype...' },
                            ...archetypes.map(a => ({ id: a.id, display_name: a.component_name }))
                        ]}
                        onChange={e => setForm({ ...form, archetype_id: e.target.value === 'none' ? '' : e.target.value })}
                    />
                    <Select
                        label="AI Provider"
                        value={form.provider_id || 'none'}
                        options={[
                            { id: 'none', display_name: 'None (Default)' },
                            ...providers.map(p => ({ id: p.id, display_name: p.name }))
                        ]}
                        onChange={e => setForm({ ...form, provider_id: e.target.value === 'none' ? '' : e.target.value })}
                    />
                    {isExternalProvider && (
                        <Input
                            label="Provider model id (e.g. eleven_v3)"
                            name="provider_model_id"
                            value={form.provider_model_id}
                            onChange={e => setForm({ ...form, provider_model_id: e.target.value })}
                            placeholder="eleven_v3"
                            required
                        />
                    )}
                </div>
                {isExternalProvider && (
                    <div className="mt-3">
                        <button type="button" onClick={applyElevenLabsPreset} className="text-[10px] font-black uppercase tracking-widest px-3 py-2 rounded-lg bg-accent-primary/10 text-accent-primary border border-accent-primary/30 hover:bg-accent-primary/20 transition-all">
                            Apply ElevenLabs speech preset
                        </button>
                    </div>
                )}
            </FormSection>

            <FormSection
                title="Cost & Status"
                description="Economy and visibility."
            >
                <div className="flex items-center gap-8">
                    <NumberInput
                        label="Credit Cost"
                        name="credit_cost"
                        value={form.credit_cost}
                        onChange={e => setForm({ ...form, credit_cost: Number(e.target.value) })}
                        className="max-w-[150px]"
                        suffix={form.is_per_second ? "/s" : ""}
                    />
                    <div className="pt-5 flex items-center gap-6">
                        <Checkbox
                            label="Bill Per Second"
                            checked={form.is_per_second}
                            onCheckedChange={(checked) => setForm(prev => ({ ...prev, is_per_second: checked as boolean }))}
                        />
                        <div className="w-px h-8 bg-white/10 mx-2" />
                        <Switch
                            label="Is Active"
                            checked={form.is_active}
                            onCheckedChange={(checked) => setForm(prev => ({ ...prev, is_active: checked }))}
                        />
                    </div>
                </div>
            </FormSection>

            <FormSection
                title="UI Properties"
                description="Refine the visual interface and set dynamic pricing rules."
            >
                <Reorder.Group
                    axis="y"
                    values={visualControls}
                    onReorder={setVisualControls}
                    className="space-y-6"
                >
                    {visualControls.map((ctrl, index) => (
                        <Reorder.Item
                            key={ctrl.id}
                            value={ctrl}
                            transition={{ type: 'spring', stiffness: 500, damping: 40, mass: 0.6 }}
                            whileDrag={{ scale: 1.02, zIndex: 50, boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}
                            className="group relative bg-white/5 border border-white/10 rounded-[2rem] p-6 space-y-6 cursor-grab active:cursor-grabbing"
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="text-content-tertiary opacity-0 group-hover:opacity-60 transition-opacity pointer-events-none">
                                        <GripVertical className="w-4 h-4" />
                                    </div>
                                    <div className="w-10 h-10 rounded-xl bg-accent-primary/10 border border-accent-primary/20 flex items-center justify-center text-accent-primary">
                                        <Settings2 className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <h4 className="font-black text-content-primary text-xs uppercase tracking-tight">{ctrl.label || formatDisplayName(ctrl.api_mapping_key)}</h4>
                                        <p className="text-[10px] text-content-tertiary font-mono opacity-60">{ctrl.api_mapping_key}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2" onPointerDown={stopPointerProp}>
                                    <ReorderArrows
                                        canMoveUp={index > 0}
                                        canMoveDown={index < visualControls.length - 1}
                                        onMoveUp={() => setVisualControls(prev => arrayShift(prev, ctrl.id, -1))}
                                        onMoveDown={() => setVisualControls(prev => arrayShift(prev, ctrl.id, 1))}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => handleToggleVisibility(ctrl.api_mapping_key, 'control')}
                                        className={cn(
                                            "flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[9px] font-black uppercase transition-all",
                                            ctrl.is_visible ? "bg-green-500/10 border-green-500/20 text-green-500" : "bg-white/5 border-white/10 text-content-tertiary opacity-40"
                                        )}
                                    >
                                        {ctrl.is_visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                                        {ctrl.is_visible ? 'Visible' : 'Hidden'}
                                    </button>
                                </div>
                            </div>
                            <div onPointerDown={stopPointerProp} className="space-y-6 cursor-default">

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <Input
                                    label="Override Label"
                                    value={ctrl.label || ''}
                                    onChange={e => {
                                        const label = e.target.value;
                                        setVisualControls(prev => prev.map(c => c.id === ctrl.id ? { ...c, label } : c));
                                    }}
                                    placeholder={formatDisplayName(ctrl.api_mapping_key)}
                                />
                                <Select
                                    label="Component Type"
                                    value={ctrl.component}
                                    options={[
                                        { id: 'text_input', display_name: 'Text Input' },
                                        { id: 'textarea', display_name: 'Textarea' },
                                        { id: 'slider', display_name: 'Slider' },
                                        { id: 'number_input', display_name: 'Number Input' },
                                        { id: 'checkbox', display_name: 'Checkbox' },
                                        { id: 'select', display_name: 'Select' },
                                        { id: 'aspect_ratio', display_name: 'Aspect Ratio' },
                                        { id: 'prompt_textarea', display_name: 'Prompt' },
                                        { id: 'negative_prompt', display_name: 'Negative Prompt' },
                                        { id: 'reverse', display_name: 'Reverse Switch' },
                                        { id: 'threshold', display_name: 'Threshold Slider' },
                                        { id: 'voice_picker', display_name: 'Voice Picker (ElevenLabs)' },
                                    ]}
                                    onChange={e => {
                                        const component = e.target.value as any;
                                        setControlPatch(ctrl.id, {
                                            component,
                                            default_value: normalizeDefaultForComponent(ctrl, component)
                                        });
                                    }}
                                />
                            </div>

                            <div className="pt-1">
                                {isBooleanControl(ctrl) && (
                                    <div className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/10">
                                        <p className="text-[10px] font-black uppercase tracking-wider text-content-tertiary">Default Value</p>
                                        <Switch
                                            checked={Boolean(ctrl.default_value)}
                                            onCheckedChange={(checked) => setControlPatch(ctrl.id, { default_value: checked })}
                                            label={Boolean(ctrl.default_value) ? 'Enabled' : 'Disabled'}
                                        />
                                    </div>
                                )}

                                {isSeedControl(ctrl) && (() => {
                                    const isAuto = ctrl.default_value === null || ctrl.default_value === undefined || ctrl.default_value === '';
                                    const step = ctrl.step ?? 1;
                                    const numericDefault = Number.isFinite(Number(ctrl.default_value)) ? Number(ctrl.default_value) : (ctrl.min ?? 0);
                                    return (
                                        <div className="space-y-3">
                                            <div className="flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/10">
                                                <div>
                                                    <p className="text-[10px] font-black uppercase tracking-wider text-content-tertiary">Auto (random seed)</p>
                                                    <p className="text-[9px] text-content-tertiary/60 mt-1 leading-snug">On = sent empty, randomized every run. Turn off to pin a default seed.</p>
                                                </div>
                                                <Switch
                                                    checked={isAuto}
                                                    onCheckedChange={(checked) => setControlPatch(ctrl.id, { default_value: checked ? null : (ctrl.min ?? 0) })}
                                                    label={isAuto ? 'Auto' : 'Fixed'}
                                                />
                                            </div>
                                            {!isAuto && (
                                                <NumberInput
                                                    label="Default Seed"
                                                    min={ctrl.min}
                                                    max={ctrl.max}
                                                    step={step}
                                                    value={numericDefault}
                                                    onChange={e => {
                                                        const val = Number(e.target.value);
                                                        setControlPatch(ctrl.id, { default_value: Number.isFinite(val) ? val : (ctrl.min ?? 0) });
                                                    }}
                                                />
                                            )}
                                        </div>
                                    );
                                })()}

                                {isNumericControl(ctrl) && !isBooleanControl(ctrl) && !isSeedControl(ctrl) && (() => {
                                    const step = ctrl.step ?? (normalizedControlType(ctrl) === 'integer' ? 1 : 0.01);
                                    const fallback = ctrl.min ?? 0;
                                    const current = Number.isFinite(Number(ctrl.default_value)) ? Number(ctrl.default_value) : fallback;
                                    const isRanged = (ctrl.component === 'slider' || ctrl.component === 'threshold')
                                        && typeof ctrl.min === 'number'
                                        && typeof ctrl.max === 'number';

                                    const renderRangeFields = () => (
                                        <div className="grid grid-cols-2 gap-3">
                                            <NumberInput
                                                label="Min"
                                                step={step}
                                                value={typeof ctrl.min === 'number' ? ctrl.min : ''}
                                                onChange={e => {
                                                    const raw = e.target.value;
                                                    const next = raw === '' ? undefined : Number(raw);
                                                    setVisualControls(prev => prev.map(c => {
                                                        if (c.id !== ctrl.id) return c;
                                                        const updated: Control & { id: string } = { ...c, min: Number.isFinite(next as number) ? (next as number) : undefined };
                                                        if (typeof updated.min === 'number' && typeof updated.default_value === 'number' && updated.default_value < updated.min) {
                                                            updated.default_value = updated.min;
                                                        }
                                                        return updated;
                                                    }));
                                                }}
                                            />
                                            <NumberInput
                                                label="Max"
                                                step={step}
                                                value={typeof ctrl.max === 'number' ? ctrl.max : ''}
                                                onChange={e => {
                                                    const raw = e.target.value;
                                                    const next = raw === '' ? undefined : Number(raw);
                                                    setVisualControls(prev => prev.map(c => {
                                                        if (c.id !== ctrl.id) return c;
                                                        const updated: Control & { id: string } = { ...c, max: Number.isFinite(next as number) ? (next as number) : undefined };
                                                        if (typeof updated.max === 'number' && typeof updated.default_value === 'number' && updated.default_value > updated.max) {
                                                            updated.default_value = updated.max;
                                                        }
                                                        return updated;
                                                    }));
                                                }}
                                            />
                                        </div>
                                    );

                                    if (!isRanged) {
                                        return (
                                            <div className="space-y-3">
                                                {renderRangeFields()}
                                                <NumberInput
                                                    label="Default Value"
                                                    min={ctrl.min}
                                                    max={ctrl.max}
                                                    step={step}
                                                    value={current}
                                                    onChange={e => {
                                                        const val = Number(e.target.value);
                                                        setControlPatch(ctrl.id, { default_value: Number.isFinite(val) ? val : fallback });
                                                    }}
                                                />
                                            </div>
                                        );
                                    }

                                    const min = ctrl.min as number;
                                    const max = ctrl.max as number;
                                    const clamp = (v: number) => Math.min(max, Math.max(min, v));
                                    const display = clamp(current);

                                    return (
                                        <div className="space-y-3">
                                            {renderRangeFields()}
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-bold text-content-tertiary uppercase tracking-[0.1em] pl-1 opacity-80 block">
                                                    Default Value
                                                </label>
                                                <div className="flex items-center gap-4">
                                                    <div className="flex-1 space-y-1.5">
                                                        <input
                                                            type="range"
                                                            min={min}
                                                            max={max}
                                                            step={step}
                                                            value={display}
                                                            onChange={e => {
                                                                const val = parseFloat(e.target.value);
                                                                setControlPatch(ctrl.id, { default_value: Number.isFinite(val) ? clamp(val) : min });
                                                            }}
                                                            className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-accent-primary"
                                                        />
                                                        <div className="flex justify-between text-[9px] font-mono text-content-tertiary/50 px-0.5 tabular-nums">
                                                            <span>{min}</span>
                                                            <span>{max}</span>
                                                        </div>
                                                    </div>
                                                    <div className="w-28 shrink-0">
                                                        <NumberInput
                                                            min={min}
                                                            max={max}
                                                            step={step}
                                                            value={display}
                                                            onChange={e => {
                                                                const raw = Number(e.target.value);
                                                                if (!Number.isFinite(raw)) return;
                                                                setControlPatch(ctrl.id, { default_value: clamp(raw) });
                                                            }}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })()}

                                {isSelectControl(ctrl) && !isBooleanControl(ctrl) && !isNumericControl(ctrl) && !isSeedControl(ctrl) && (
                                    Array.isArray(ctrl.options) && ctrl.options.length > 0 ? (
                                        <Select
                                            label="Default Value"
                                            value={String(ctrl.default_value ?? '')}
                                            options={ctrl.options.map(opt => ({
                                                id: String(opt),
                                                display_name: formatDisplayName(String(opt))
                                            }))}
                                            onChange={e => setControlPatch(ctrl.id, {
                                                default_value: parseSelectDefault(e.target.value, ctrl.type)
                                            })}
                                        />
                                    ) : (
                                        <Input
                                            label="Default Value"
                                            value={String(ctrl.default_value ?? '')}
                                            onChange={e => setControlPatch(ctrl.id, { default_value: e.target.value })}
                                            placeholder="No schema enum options available"
                                        />
                                    )
                                )}

                                {ctrl.component === 'voice_picker' && (
                                    <div className="space-y-2">
                                        <p className="text-[10px] font-black uppercase tracking-wider text-content-tertiary">Default Voice</p>
                                        <VoicePickerControl
                                            label=""
                                            value={ctrl.default_value}
                                            onChange={(val) => setControlPatch(ctrl.id, { default_value: val })}
                                        />
                                    </div>
                                )}

                                {ctrl.component !== 'voice_picker' && !isBooleanControl(ctrl) && !isNumericControl(ctrl) && !isSelectControl(ctrl) && !isJsonControl(ctrl) && !isSeedControl(ctrl) && (
                                    (ctrl.component === 'textarea' || ctrl.component === 'prompt_textarea' || ctrl.component === 'negative_prompt') ? (
                                        <Textarea
                                            label="Default Value"
                                            value={String(ctrl.default_value ?? '')}
                                            onChange={e => setControlPatch(ctrl.id, { default_value: e.target.value })}
                                            rows={3}
                                        />
                                    ) : (
                                        <Input
                                            label="Default Value"
                                            value={String(ctrl.default_value ?? '')}
                                            onChange={e => setControlPatch(ctrl.id, { default_value: e.target.value })}
                                        />
                                    )
                                )}

                                {isJsonControl(ctrl) && (
                                    <Textarea
                                        label="Default Value (JSON)"
                                        value={getJsonDraftValue(ctrl)}
                                        onChange={e => {
                                            const raw = e.target.value;
                                            setJsonDefaultDrafts(prev => ({ ...prev, [ctrl.id]: raw }));
                                            try {
                                                const parsed = JSON.parse(raw);
                                                const isValidArray = normalizedControlType(ctrl) === 'array' && Array.isArray(parsed);
                                                const isValidObject = normalizedControlType(ctrl) === 'object' && parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
                                                if (isValidArray || isValidObject) {
                                                    setControlPatch(ctrl.id, { default_value: parsed });
                                                }
                                            } catch {
                                                // Keep draft text while JSON is being edited.
                                            }
                                        }}
                                        rows={4}
                                    />
                                )}
                            </div>

                            {/* Dynamic Pricing Section */}
                            <div className="pt-4 mt-4 border-t border-white/5">
                                <p className="text-[10px] font-black uppercase tracking-widest text-accent-primary mb-4 opacity-80">Pricing Modifiers</p>
                                
                                {ctrl.component === 'select' && ctrl.options && (
                                    <div className="space-y-2">
                                        {ctrl.options.map(opt => {
                                            const isHidden = (ctrl.disabled_options ?? []).includes(opt);
                                            return (
                                                <div
                                                    key={opt}
                                                    className={cn(
                                                        "flex items-center gap-3 p-2 rounded-xl bg-white/5 border border-white/10 transition-all",
                                                        isHidden && "opacity-50"
                                                    )}
                                                >
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setVisualControls(prev => prev.map(c => {
                                                                if (c.id !== ctrl.id) return c;
                                                                const current = c.disabled_options ?? [];
                                                                const next = isHidden ? current.filter(x => x !== opt) : [...current, opt];
                                                                return { ...c, disabled_options: next };
                                                            }));
                                                        }}
                                                        title={isHidden ? "Click to show this option to users" : "Click to hide this option from users"}
                                                        className={cn(
                                                            "shrink-0 w-7 h-7 rounded-lg flex items-center justify-center border transition-colors",
                                                            isHidden
                                                                ? "bg-white/5 border-white/10 text-content-tertiary"
                                                                : "bg-green-500/10 border-green-500/30 text-green-500"
                                                        )}
                                                    >
                                                        {isHidden ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                                    </button>
                                                    <div className="flex-1 min-w-0">
                                                        <NumberInput
                                                            label={`Cost for "${opt}"`}
                                                            value={ctrl.cost_modifiers?.[opt] || 0}
                                                            onChange={e => {
                                                                const val = Number(e.target.value);
                                                                setVisualControls(prev => prev.map(c =>
                                                                    c.id === ctrl.id ? {
                                                                        ...c,
                                                                        cost_modifiers: { ...(c.cost_modifiers || {}), [opt]: val }
                                                                    } : c
                                                                ));
                                                            }}
                                                            suffix="CR"
                                                        />
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}

                                {(ctrl.component === 'checkbox' || ctrl.component === 'reverse') && (
                                    <div className="grid grid-cols-2 gap-4">
                                        <NumberInput
                                            label="Cost for TRUE"
                                            value={ctrl.cost_modifiers?.['true'] || 0}
                                            onChange={e => {
                                                const val = Number(e.target.value);
                                                setVisualControls(prev => prev.map(c => 
                                                    c.id === ctrl.id ? { 
                                                        ...c, 
                                                        cost_modifiers: { ...(c.cost_modifiers || {}), ['true']: val } 
                                                    } : c
                                                ));
                                            }}
                                            suffix="CR"
                                        />
                                        <NumberInput
                                            label="Cost for FALSE"
                                            value={ctrl.cost_modifiers?.['false'] || 0}
                                            onChange={e => {
                                                const val = Number(e.target.value);
                                                setVisualControls(prev => prev.map(c => 
                                                    c.id === ctrl.id ? { 
                                                        ...c, 
                                                        cost_modifiers: { ...(c.cost_modifiers || {}), ['false']: val } 
                                                    } : c
                                                ));
                                            }}
                                            suffix="CR"
                                        />
                                    </div>
                                )}

                                {(ctrl.component === 'slider' || ctrl.component === 'number_input' || ctrl.component === 'threshold') && (
                                    <div className="space-y-3">
                                        <div className="max-w-[200px]">
                                            <NumberInput
                                                label="Cost Per Unit"
                                                value={ctrl.cost_per_unit || 0}
                                                onChange={e => {
                                                    const val = Number(e.target.value);
                                                    setVisualControls(prev => prev.map(c =>
                                                        c.id === ctrl.id ? { ...c, cost_per_unit: val } : c
                                                    ));
                                                }}
                                                suffix="CR"
                                            />
                                        </div>
                                        <div className="flex items-start justify-between gap-4 p-3 rounded-xl bg-white/5 border border-white/10">
                                            <div className="min-w-0">
                                                <p className="text-[10px] font-black uppercase tracking-wider text-content-secondary">
                                                    Multiply Total by Value
                                                </p>
                                                <p className="text-[10px] text-content-tertiary opacity-70 mt-1 leading-relaxed">
                                                    e.g. video duration — total cost × this control&apos;s value. Empty / zero / non-numeric values are treated as 1.
                                                </p>
                                            </div>
                                            <Switch
                                                checked={Boolean(ctrl.is_cost_multiplier)}
                                                onCheckedChange={(checked) => {
                                                    setVisualControls(prev => prev.map(c =>
                                                        c.id === ctrl.id ? { ...c, is_cost_multiplier: Boolean(checked) } : c
                                                    ));
                                                }}
                                            />
                                        </div>
                                    </div>
                                )}
                            </div>
                            </div>
                        </Reorder.Item>
                    ))}
                </Reorder.Group>
            </FormSection>

            <FormSection
                title="Input Handles"
                description="Customize how external data flows into this model."
            >
                {visualInputWires.length === 0 && (
                    <div className="text-center py-6 opacity-40 italic text-[10px] uppercase font-bold tracking-widest border-2 border-dashed border-white/5 rounded-3xl">
                        No input handles found in schema
                    </div>
                )}
                <Reorder.Group
                    axis="y"
                    values={visualInputWires}
                    onReorder={setVisualInputWires}
                    className="space-y-6"
                >
                    {visualInputWires.map((wire, index) => (
                        <Reorder.Item
                            key={wire.id}
                            value={wire}
                            transition={{ type: 'spring', stiffness: 500, damping: 40, mass: 0.6 }}
                            whileDrag={{ scale: 1.02, zIndex: 50, boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}
                            className="group relative bg-white/5 border border-white/10 rounded-[2rem] p-6 space-y-4 cursor-grab active:cursor-grabbing"
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="text-content-tertiary opacity-0 group-hover:opacity-60 transition-opacity pointer-events-none">
                                        <GripVertical className="w-4 h-4" />
                                    </div>
                                    <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                                        <Link2 className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <h4 className="font-black text-content-primary text-xs uppercase tracking-tight">{wire.name || formatDisplayName(wire.api_mapping_key)}</h4>
                                        <p className="text-[10px] text-content-tertiary font-mono opacity-60">{wire.api_mapping_key}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2" onPointerDown={stopPointerProp}>
                                    <ReorderArrows
                                        canMoveUp={index > 0}
                                        canMoveDown={index < visualInputWires.length - 1}
                                        onMoveUp={() => setVisualInputWires(prev => arrayShift(prev, wire.id, -1))}
                                        onMoveDown={() => setVisualInputWires(prev => arrayShift(prev, wire.id, 1))}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => handleToggleVisibility(wire.api_mapping_key, 'input-handle')}
                                        className={cn(
                                            "flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[9px] font-black uppercase transition-all",
                                            wire.is_visible ? "bg-green-500/10 border-green-500/20 text-green-500" : "bg-white/5 border-white/10 text-content-tertiary opacity-40"
                                        )}
                                    >
                                        {wire.is_visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                                        {wire.is_visible ? 'Visible' : 'Hidden'}
                                    </button>
                                </div>
                            </div>

                            <div onPointerDown={stopPointerProp} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end cursor-default">
                                <Input
                                    label="Custom Label"
                                    value={wire.name}
                                    onChange={e => setVisualInputWires(prev => prev.map(w => w.id === wire.id ? { ...w, name: e.target.value } : w))}
                                />
                                <Select
                                    label="Wire Type"
                                    value={wire.type}
                                    options={WIRE_TYPES.map(t => ({ id: t, display_name: formatDisplayName(t) }))}
                                    onChange={e => setVisualInputWires(prev => prev.map(w => w.id === wire.id ? { ...w, type: e.target.value } : w))}
                                />
                                <div className="flex gap-4 pb-2">
                                    <Checkbox
                                        label="Array"
                                        checked={wire.is_array}
                                        onCheckedChange={(checked) => setVisualInputWires(prev => prev.map(w => w.id === wire.id ? { ...w, is_array: checked as boolean } : w))}
                                    />
                                    <Checkbox
                                        label="Required"
                                        checked={wire.is_mandatory}
                                        onCheckedChange={(checked) => setVisualInputWires(prev => prev.map(w => w.id === wire.id ? { ...w, is_mandatory: checked as boolean } : w))}
                                    />
                                </div>
                                {['image', 'video'].some(t => (wire.type || '').toLowerCase().includes(t)) && (
                                    <NumberInput
                                        label="Cost / connected item"
                                        value={wire.cost_per_item ?? 0}
                                        onChange={e => setVisualInputWires(prev => prev.map(w => w.id === wire.id ? { ...w, cost_per_item: Number(e.target.value) } : w))}
                                        suffix="CR"
                                    />
                                )}
                                {wire.is_array && (
                                    <NumberInput
                                        label="Max items (0 = unlimited)"
                                        value={wire.max_items ?? 0}
                                        onChange={e => setVisualInputWires(prev => prev.map(w => w.id === wire.id ? { ...w, max_items: Number(e.target.value) } : w))}
                                    />
                                )}
                            </div>
                        </Reorder.Item>
                    ))}
                </Reorder.Group>
            </FormSection>

            <FormSection
                title="Output Handles"
                description="Customize how this model exports data."
            >
                {visualOutputWires.length === 0 && (
                    <div className="text-center py-6 opacity-40 italic text-[10px] uppercase font-bold tracking-widest border-2 border-dashed border-white/5 rounded-3xl">
                        No output handles found in schema
                    </div>
                )}
                <Reorder.Group
                    axis="y"
                    values={visualOutputWires}
                    onReorder={setVisualOutputWires}
                    className="space-y-6"
                >
                    {visualOutputWires.map((wire, index) => (
                        <Reorder.Item
                            key={wire.id}
                            value={wire}
                            transition={{ type: 'spring', stiffness: 500, damping: 40, mass: 0.6 }}
                            whileDrag={{ scale: 1.02, zIndex: 50, boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)' }}
                            className="group relative bg-white/5 border border-white/10 rounded-[2rem] p-6 space-y-4 cursor-grab active:cursor-grabbing"
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="text-content-tertiary opacity-0 group-hover:opacity-60 transition-opacity pointer-events-none">
                                        <GripVertical className="w-4 h-4" />
                                    </div>
                                    <div className="w-10 h-10 rounded-xl bg-accent-primary/10 border border-accent-primary/20 flex items-center justify-center text-accent-primary">
                                        <Layers className="w-5 h-5" />
                                    </div>
                                    <div>
                                        <h4 className="font-black text-content-primary text-xs uppercase tracking-tight">{wire.name || formatDisplayName(wire.api_mapping_key)}</h4>
                                        <p className="text-[10px] text-content-tertiary font-mono opacity-60">{wire.api_mapping_key}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2" onPointerDown={stopPointerProp}>
                                    <ReorderArrows
                                        canMoveUp={index > 0}
                                        canMoveDown={index < visualOutputWires.length - 1}
                                        onMoveUp={() => setVisualOutputWires(prev => arrayShift(prev, wire.id, -1))}
                                        onMoveDown={() => setVisualOutputWires(prev => arrayShift(prev, wire.id, 1))}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => handleToggleVisibility(wire.api_mapping_key, 'output-handle')}
                                        className={cn(
                                            "flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[9px] font-black uppercase transition-all",
                                            wire.is_visible ? "bg-green-500/10 border-green-500/20 text-green-500" : "bg-white/5 border-white/10 text-content-tertiary opacity-40"
                                        )}
                                    >
                                        {wire.is_visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                                        {wire.is_visible ? 'Visible' : 'Hidden'}
                                    </button>
                                </div>
                            </div>

                            <div onPointerDown={stopPointerProp} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-end cursor-default">
                                <Input
                                    label="Custom Label"
                                    value={wire.name}
                                    onChange={e => setVisualOutputWires(prev => prev.map(w => w.id === wire.id ? { ...w, name: e.target.value } : w))}
                                />
                                <Select
                                    label="Wire Type"
                                    value={wire.type}
                                    options={WIRE_TYPES.map(t => ({ id: t, display_name: formatDisplayName(t) }))}
                                    onChange={e => setVisualOutputWires(prev => prev.map(w => w.id === wire.id ? { ...w, type: e.target.value } : w))}
                                />
                                <div className="pb-2">
                                    <Checkbox
                                        label="Array"
                                        checked={wire.is_array}
                                        onCheckedChange={(checked) => setVisualOutputWires(prev => prev.map(w => w.id === wire.id ? { ...w, is_array: checked as boolean } : w))}
                                    />
                                </div>
                            </div>
                        </Reorder.Item>
                    ))}
                </Reorder.Group>
            </FormSection>

            {/* LIVE PREVIEW SECTION */}
            <div className="pt-12 border-b border-white/5 pb-12">
                <div className="mb-8 bg-black/40 p-8 rounded-[2.5rem] border border-white/5 shadow-inner">
                    <div className="flex items-center justify-between mb-8">
                        <div>
                            <h3 className="font-black text-content-primary text-base inline-flex items-center gap-3 uppercase tracking-tighter">
                                Live Visual Preview
                            </h3>
                            <p className="text-[10px] text-content-tertiary mt-1 uppercase tracking-widest font-bold opacity-60">
                                Real-time interface testing & default curator
                            </p>
                        </div>
                        <div className="px-3 py-1 bg-green-500/10 border border-green-500/20 rounded-full flex items-center gap-2">
                            <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                            <span className="text-[9px] font-black text-green-500 uppercase tracking-widest">Interactive</span>
                        </div>
                    </div>
                    
                    <div className="bg-white/5 border border-white/10 rounded-3xl p-8 backdrop-blur-xl">
                         <AIGeneratorProperties 
                            config={{
                                model_id: 1, // Dummy ID for preview
                                control_values: previewConfig.control_values
                            }}
                             selectedModelOverride={{
                                 inputs_schema: {
                                     controls: visualControls,
                                     handles: visualInputWires
                                 },
                                 outputs_schema: {
                                     handles: visualOutputWires
                                 }
                             }}
                             editMode={true}
                             hideSelector={true}
                             onToggleVisibility={handleToggleVisibility as any}
                            onUpdate={handlePreviewUpdate}
                         />

                         {visualControls.length === 0 && (
                            <div className="text-center py-8 opacity-40">
                                <p className="text-[10px] font-bold uppercase tracking-widest">Preview inactive - empty schema</p>
                            </div>
                         )}
                    </div>
                </div>
            </div>

            <div className="pt-12 flex justify-end gap-4">
                {onCancel && (
                    <button
                        type="button"
                        onClick={onCancel}
                        className="px-8 py-3 bg-white/5 hover:bg-white/10 text-content-tertiary font-bold uppercase tracking-widest text-[10px] rounded-2xl transition-all border border-white/5"
                    >
                        Cancel
                    </button>
                )}
                <button
                    type="submit"
                    disabled={submitting}
                    className="px-10 py-4 bg-gradient-premium text-white font-black uppercase tracking-widest text-xs rounded-2xl hover:opacity-90 transition-all disabled:opacity-50 shadow-2xl shadow-accent-primary/40 flex items-center gap-3 hover:scale-[1.02] active:scale-[0.98]"
                >
                    {submitting && <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                    <Save className="w-4 h-4" />
                    {initialData ? 'Update Asset' : 'Register Asset'}
                </button>
            </div>
        </form>
    );
}
