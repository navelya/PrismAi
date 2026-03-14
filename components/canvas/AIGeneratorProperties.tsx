'use client';

import React, { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { Select } from '@/components/ui/Select';
import { cn } from '@/lib/utils';

// =============================================================================
// TYPES (Synced with AIGeneratorNode)
// =============================================================================

// =============================================================================
// TYPES - MOVED TO lib/nodes/types.ts
// =============================================================================
import { AiModel, InputsSchema, OutputsSchema } from '@/lib/nodes/types';
import { useAppStore } from '@/lib/store/app-store';

interface Control {
    api_mapping_key: string;
    type: string;
    component: string;
    default_value: any;
}

// =============================================================================
// COMPONENT
// =============================================================================

interface AIGeneratorPropertiesProps {
    config: {
        node_type_id?: string;
        model_id?: number;
        control_values?: Record<string, any>;
    };
    onUpdate: (config: any) => void;
}

export default function AIGeneratorProperties({ config, onUpdate }: AIGeneratorPropertiesProps) {
    const models = useAppStore(state => state.models);
    const isModelsLoading = useAppStore(state => state.isModelsLoading);

    const filteredModels = config.node_type_id 
        ? models.filter(m => m.node_type_id === config.node_type_id)
        : models;

    useEffect(() => {
        // Default model selection if none exists (and models have loaded)
        if (!isModelsLoading && filteredModels.length > 0 && !config.model_id) {
            const firstActive = filteredModels.find(mod => mod.is_active) || filteredModels[0];
            onUpdate({ ...config, model_id: firstActive.id, control_values: {} });
        }
    }, [isModelsLoading, filteredModels, config.model_id, onUpdate]);

    const selectedModel = filteredModels.find(m => m.id === config.model_id);
    const controls = selectedModel?.inputs_schema?.controls || [];
    const handles = selectedModel?.inputs_schema?.handles || [];

    const handleModelChange = (val: string) => {
        const modelId = Number(val);
        onUpdate({
            ...config,
            model_id: modelId,
            control_values: {}, // Reset controls when model changes
        });
    };

    const handleControlChange = (key: string, val: any) => {
        onUpdate({
            ...config,
            control_values: {
                ...(config.control_values || {}),
                [key]: val,
            },
        });
    };

    if (isModelsLoading) {
        return (
            <div className="flex flex-col items-center justify-center py-12 text-content-tertiary animate-in fade-in duration-500">
                <Loader2 className="w-8 h-8 animate-spin mb-4 text-accent-primary opacity-50" />
                <span className="text-[10px] font-black uppercase tracking-[0.3em]">Synching Neural Engine...</span>
            </div>
        );
    }

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-500">
            {/* Model Selection */}
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-4 shadow-xl ring-1 ring-white/5">
                <Select
                    label="Active Neural Model"
                    value={config.model_id?.toString() || ''}
                    onChange={(e) => handleModelChange(e.target.value)}
                    options={filteredModels.filter(m => m.is_active).map(m => ({
                        id: m.id.toString(),
                        display_name: m.display_name
                    }))}
                    placeholder="Select a neural model..."
                />
            </div>

            {/* Architecture Note (Parity with AIGenerateImage) */}
            {handles.length > 0 && (
                <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-[10px] text-content-secondary leading-relaxed font-medium animate-in fade-in duration-700">
                    <span className="font-bold text-blue-400 uppercase tracking-wider block mb-1">Architecture Note</span>
                    This model requires external inputs. Connect compatible nodes to the
                    {handles.map((h: any, i: number) => (
                        <span key={h.api_mapping_key}>
                            {i > 0 && i === handles.length - 1 ? ' and ' : i > 0 ? ', ' : ' '}
                            <b className="text-content-primary">{h.name}</b>
                        </span>
                    ))}
                    handle{handles.length > 1 ? 's' : ''} to provide context.
                </div>
            )}

            {/* Dynamic Controls */}
            {controls.length > 0 && (
                <div className="space-y-6 pt-2">
                    <div className="flex items-center gap-3">
                        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                        <p className="text-[10px] font-black uppercase tracking-[0.25em] text-content-tertiary whitespace-nowrap">
                            Parameters
                        </p>
                        <div className="h-px flex-1 bg-gradient-to-r from-transparent via-white/10 to-transparent" />
                    </div>

                    <div className="space-y-5">
                        {controls.map(ctrl => (
                            <div key={ctrl.api_mapping_key} className="space-y-2 group/field">
                                <ControlRenderer
                                    control={ctrl}
                                    value={config.control_values?.[ctrl.api_mapping_key]}
                                    onChange={handleControlChange}
                                />
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

// =============================================================================
// HELPERS
// =============================================================================

function ControlRenderer({
    control,
    value,
    onChange,
}: {
    control: Control;
    value: any;
    onChange: (key: string, val: any) => void;
}) {
    const baseInputClass =
        'w-full bg-white/5 border border-white/10 rounded-xl text-content-primary text-sm px-4 py-2.5 focus:outline-none focus:border-accent-primary/50 focus:ring-4 focus:ring-accent-primary/10 transition-all placeholder:text-content-tertiary/50';

    const label = control.api_mapping_key.replace(/_/g, ' ');

    switch (control.component) {
        case 'prompt_textarea':
        case 'negative_prompt':
            return (
                <div className="space-y-2">
                    <label className="text-[10px] font-bold text-content-tertiary uppercase tracking-wider pl-1 opacity-80 leading-none">
                        {label}
                    </label>
                    <textarea
                        value={value ?? control.default_value ?? ''}
                        onChange={e => onChange(control.api_mapping_key, e.target.value)}
                        placeholder={control.component === 'negative_prompt' ? 'What to exclude...' : 'What to generate...'}
                        rows={4}
                        className={cn(baseInputClass, 'resize-none leading-relaxed')}
                    />
                </div>
            );
        case 'aspect_ratio':
            return (
                <Select
                    label={label}
                    value={value ?? control.default_value ?? '1:1'}
                    onChange={e => onChange(control.api_mapping_key, e.target.value)}
                    options={['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'].map(r => ({ id: r, display_name: r }))}
                />
            );
        case 'format':
            return (
                <Select
                    label={label}
                    value={value ?? control.default_value ?? 'webp'}
                    onChange={e => onChange(control.api_mapping_key, e.target.value)}
                    options={['webp', 'png', 'jpg'].map(f => ({ id: f, display_name: f.toUpperCase() }))}
                />
            );
        case 'threshold':
            return (
                <div className="space-y-3 p-1">
                    <label className="text-[10px] font-bold text-content-tertiary uppercase tracking-wider pl-1 opacity-80 leading-none">
                        {label}
                    </label>
                    <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={value ?? control.default_value ?? 0.5}
                        onChange={e => onChange(control.api_mapping_key, parseFloat(e.target.value))}
                        className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-accent-primary"
                    />
                    <div className="flex justify-between text-[10px] font-mono text-content-tertiary/60">
                        <span>0.0</span>
                        <span className="text-accent-primary font-black scale-110">{value ?? control.default_value ?? 0.5}</span>
                        <span>1.0</span>
                    </div>
                </div>
            );
        case 'resolution':
            return (
                <Select
                    label={label}
                    value={value ?? control.default_value ?? '1024x1024'}
                    onChange={e => onChange(control.api_mapping_key, e.target.value)}
                    options={['512x512', '768x768', '1024x1024', '1280x720', '1920x1080'].map(r => ({ id: r, display_name: r }))}
                />
            );
        case 'reverse':
            return (
                <div className="space-y-2">
                    <label className="text-[10px] font-bold text-content-tertiary uppercase tracking-wider pl-1 opacity-80 leading-none">
                        {label}
                    </label>
                    <div className="flex bg-white/5 rounded-xl p-1 border border-white/10">
                        {[
                            { label: 'No', value: false },
                            { label: 'Yes', value: true }
                        ].map((opt) => (
                            <button
                                key={opt.label}
                                type="button"
                                onClick={() => onChange(control.api_mapping_key, opt.value)}
                                className={cn(
                                    "flex-1 py-1.5 text-xs font-bold rounded-lg transition-all",
                                    (value === opt.value || (value === undefined && opt.value === control.default_value))
                                        ? "bg-accent-primary text-white shadow-lg shadow-accent-primary/20"
                                        : "text-content-tertiary hover:text-content-secondary"
                                )}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </div>
            );
        default:
            return (
                <div className="space-y-2">
                    <label className="text-[10px] font-bold text-content-tertiary uppercase tracking-wider pl-1 opacity-80 leading-none">
                        {label}
                    </label>
                    <input
                        type="text"
                        value={value ?? control.default_value ?? ''}
                        onChange={e => onChange(control.api_mapping_key, e.target.value)}
                        className={baseInputClass}
                        placeholder={`${control.api_mapping_key}...`}
                    />
                </div>
            );
    }
}
