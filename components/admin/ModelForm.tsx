'use client';

import React, { useState, useEffect } from 'react';
import { Save, Layers, Link2, Settings2, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { NumberInput } from '@/components/ui/NumberInput';
import { Checkbox } from '@/components/ui/Checkbox';

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
}

export function ModelForm({
    initialData,
    onSubmit,
    onCancel,
    submitting,
    categories,
    archetypes,
    nodeTypes
}: ModelFormProps) {
    // -------------------------------------------------------------------------
    // STATE
    // -------------------------------------------------------------------------
    const [form, setForm] = useState({
        replicate_model_id: initialData?.replicate_model_id || '',
        display_name: initialData?.display_name || '',
        credit_cost: initialData?.credit_cost || 0,
        is_active: initialData?.is_active ?? true,
        category_id: initialData?.category_id || (categories[0]?.id || ''),
        node_type_id: initialData?.node_type_id || '',
        archetype_id: initialData?.archetype_id || (archetypes[0]?.id || ''),
    });

    // Visual Schema States
    const [visualControls, setVisualControls] = useState<Array<{ id: string, component_id: string, api_key: string, default_value: any }>>([]);
    const [visualInputWires, setVisualInputWires] = useState<Array<{ id: string, name: string, api_key: string, type: string, is_array: boolean }>>([]);
    const [visualOutputWires, setVisualOutputWires] = useState<Array<{ id: string, name: string, type: string, is_array: boolean }>>([]);

    // -------------------------------------------------------------------------
    // INITIALIZATION (EFFECTS)
    // -------------------------------------------------------------------------
    useEffect(() => {
        if (initialData?.inputs_schema) {
            const inputs = initialData.inputs_schema;

            // Map handles
            if (inputs.handles) {
                setVisualInputWires(inputs.handles.map((h: any) => ({
                    id: Math.random().toString(),
                    name: h.name,
                    api_key: h.api_key,
                    type: h.type || 'image',
                    is_array: h.is_array ?? false
                })));
            }

            // Map controls
            if (inputs.controls) {
                setVisualControls(inputs.controls.map((c: any) => ({
                    id: Math.random().toString(),
                    component_id: c.component,
                    api_key: c.name,
                    default_value: c.default_value
                })));
            }
        }

        if (initialData?.outputs_schema?.handles) {
            setVisualOutputWires(initialData.outputs_schema.handles.map((h: any) => ({
                id: Math.random().toString(),
                name: h.name,
                type: h.type || 'image',
                is_array: h.is_array ?? false
            })));
        }
    }, [initialData]);

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
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        const compiledInputs = {
            handles: visualInputWires.map(wire => ({
                name: wire.name,
                api_key: wire.api_key,
                type: wire.type,
                is_array: wire.is_array
            })),
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
            handles: visualOutputWires.map(wire => ({
                name: wire.name,
                type: wire.type,
                is_array: wire.is_array
            }))
        };

        await onSubmit({
            ...form,
            inputs_schema: compiledInputs,
            outputs_schema: compiledOutputs,
            credit_cost: Number(form.credit_cost)
        });
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <FormSection
                title="Model Identification"
                description="Core identifiers for the Replicate mapping."
            >
                <div className="flex flex-col sm:flex-row gap-4">
                    <Input
                        label="Replicate Model ID"
                        name="replicate_model_id"
                        value={form.replicate_model_id}
                        onChange={e => setForm({ ...form, replicate_model_id: e.target.value })}
                        placeholder="stability-ai/sdxl:39ed..."
                        required
                    />
                    <Input
                        label="Display Name"
                        name="display_name"
                        value={form.display_name}
                        onChange={e => setForm({ ...form, display_name: e.target.value })}
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
                        value={form.category_id}
                        options={categories}
                        onChange={e => setForm({ ...form, category_id: e.target.value })}
                    />
                    <Select
                        label="Node Type (Filtered)"
                        value={form.node_type_id}
                        options={filteredNodeTypes}
                        onChange={e => setForm({ ...form, node_type_id: e.target.value })}
                        disabled={!form.category_id || filteredNodeTypes.length === 0}
                    />
                    <Select
                        label="Node Archetype"
                        value={form.archetype_id}
                        options={archetypes.map(a => ({ id: a.id, display_name: a.component_name }))}
                        onChange={e => setForm({ ...form, archetype_id: e.target.value })}
                    />
                </div>
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
                    />
                    <div className="flex items-center gap-3 pt-5">
                        <div className="relative">
                            <input
                                type="checkbox"
                                checked={form.is_active}
                                onChange={() => { }}
                                className="sr-only peer"
                            />
                            <div
                                onClick={() => setForm(prev => ({ ...prev, is_active: !prev.is_active }))}
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
                            onClick={() => setVisualInputWires([...visualInputWires, { id: Math.random().toString(), name: 'input', api_key: '', type: 'image', is_array: false }])}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 border border-blue-500/20 text-blue-400 text-xs font-bold uppercase tracking-wider rounded-xl transition-all hover:scale-[1.02] active:scale-[0.98]"
                        >
                            <Link2 className="w-4 h-4" /> In Wire
                        </button>
                        <button
                            type="button"
                            onClick={() => setVisualOutputWires([...visualOutputWires, { id: Math.random().toString(), name: 'output', type: 'image', is_array: false }])}
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
                                        <Input
                                            label="Replicate API Key"
                                            value={wire.api_key}
                                            onChange={e => {
                                                const newWires = [...visualInputWires];
                                                newWires[idx].api_key = e.target.value;
                                                setVisualInputWires(newWires);
                                            }}
                                            placeholder="e.g. prompt, image"
                                            required
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
                                        <div className="pt-6">
                                            <Checkbox
                                                label="Is Array"
                                                checked={wire.is_array}
                                                onCheckedChange={(checked) => {
                                                    const newWires = [...visualInputWires];
                                                    newWires[idx].is_array = checked;
                                                    setVisualInputWires(newWires);
                                                }}
                                            />
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
                                        <div className="pt-6">
                                            <Checkbox
                                                label="Is Array"
                                                checked={wire.is_array}
                                                onCheckedChange={(checked) => {
                                                    const newWires = [...visualOutputWires];
                                                    newWires[idx].is_array = checked;
                                                    setVisualOutputWires(newWires);
                                                }}
                                            />
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
