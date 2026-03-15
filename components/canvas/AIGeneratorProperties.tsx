'use client';

import React, { useState, useEffect } from 'react';
import { Loader2, Eye, EyeOff, Info, ToggleLeft, ToggleRight } from 'lucide-react';
import { Select } from '@/components/ui/Select';
import { cn } from '@/lib/utils';

// =============================================================================
// TYPES (Synced with AIGeneratorNode)
// =============================================================================

// =============================================================================
// TYPES - MOVED TO lib/nodes/types.ts
// =============================================================================
import { AiModel, InputsSchema, OutputsSchema, Control } from '@/lib/nodes/types';
import { useAppStore } from '@/lib/store/app-store';

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
    editMode?: boolean;
    onToggleVisibility?: (key: string, type: 'control' | 'handle') => void;
    hideSelector?: boolean;
}

export default function AIGeneratorProperties({ config, onUpdate, editMode = false, onToggleVisibility, hideSelector = false }: AIGeneratorPropertiesProps) {
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
        <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-500 h-full flex flex-col max-h-[calc(100vh-200px)]">
            {/* Scrollable Content Wrapper */}
            <div className="flex-1 overflow-y-auto pr-4 custom-scrollbar space-y-8">
                {/* Model Selection */}
                {!hideSelector && (
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
                )}

            {/* Architecture Note (Parity with AIGenerateImage) */}
            {handles.length > 0 && (
                <div className="space-y-4">
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

                    {editMode && (
                        <div className="space-y-2">
                             <p className="text-[9px] font-black uppercase tracking-widest text-content-tertiary mb-2 px-1">Curation: Handles</p>
                             <div className="flex flex-wrap gap-2">
                                 {handles.map(h => (
                                     <button
                                         key={h.api_mapping_key}
                                         onClick={() => onToggleVisibility?.(h.api_mapping_key, 'handle')}
                                         className={cn(
                                             "flex items-center gap-2 px-3 py-1.5 rounded-lg border text-[10px] font-bold uppercase transition-all",
                                             h.is_visible 
                                                 ? "bg-blue-500/10 border-blue-500/30 text-blue-400" 
                                                 : "bg-white/5 border-white/10 text-content-tertiary line-through opacity-50"
                                         )}
                                     >
                                         {h.is_visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                                         {h.name}
                                     </button>
                                 ))}
                             </div>
                        </div>
                    )}
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
                        {controls
                            .filter(ctrl => editMode || ctrl.is_visible)
                            .map(ctrl => (
                                <div key={ctrl.api_mapping_key} className="relative group/field">
                                    {editMode && (
                                        <button 
                                            onClick={() => onToggleVisibility?.(ctrl.api_mapping_key, 'control')}
                                            className={cn(
                                                "absolute -top-1 -right-1 z-10 w-6 h-6 rounded-full flex items-center justify-center border shadow-xl transition-all",
                                                ctrl.is_visible 
                                                    ? "bg-green-500 border-green-400 text-white" 
                                                    : "bg-red-500 border-red-400 text-white"
                                            )}
                                        >
                                            {ctrl.is_visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
                                        </button>
                                    )}
                                    <div className={cn("transition-all", !ctrl.is_visible && "opacity-40 grayscale-[0.5]")}>
                                        <ControlRenderer
                                            control={ctrl}
                                            value={config.control_values?.[ctrl.api_mapping_key]}
                                            onChange={handleControlChange}
                                        />
                                    </div>
                                </div>
                            ))}
                    </div>
                </div>
            )}
        </div>
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
        'w-full bg-white/5 border border-white/10 rounded-xl text-content-primary text-sm px-4 py-3 focus:outline-none focus:border-accent-primary/50 focus:ring-4 focus:ring-accent-primary/10 transition-all placeholder:text-content-tertiary/50 hover:bg-white/10 hover:border-white/20 shadow-inner';

    const label = control.label || control.api_mapping_key.replace(/_/g, ' ');

    switch (control.component) {
        case 'textarea':
        case 'prompt_textarea':
        case 'negative_prompt':
            return (
                <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                         <label className="text-[10px] font-black text-content-tertiary uppercase tracking-[0.1em] pl-1 opacity-60 leading-none">
                            {label}
                        </label>
                        {control.type === 'string' && (
                             <span className="text-[8px] font-bold text-accent-primary/40 uppercase tracking-widest px-2 py-0.5 rounded-full border border-accent-primary/10">TEXT</span>
                        )}
                    </div>
                    <textarea
                        value={value ?? control.default_value ?? ''}
                        onChange={e => onChange(control.api_mapping_key, e.target.value)}
                        placeholder={control.component === 'negative_prompt' ? 'What to exclude...' : 'What to generate...'}
                        rows={4}
                        className={cn(baseInputClass, 'resize-none leading-relaxed')}
                    />
                </div>
            );
        case 'select':
        case 'aspect_ratio':
        case 'resolution':
        case 'format':
            return (
                <Select
                    label={label}
                    value={value ?? control.default_value ?? ''}
                    onChange={e => onChange(control.api_mapping_key, e.target.value)}
                    options={(control.options || []).map(opt => ({ id: opt, display_name: opt.toString() }))}
                />
            );
        case 'slider':
        case 'threshold':
            return (
                <div className="space-y-4 p-1.5 bg-white/[0.02] rounded-2xl border border-white/5 shadow-inner transition-all hover:bg-white/[0.05]">
                    <div className="flex items-center justify-between px-1">
                        <label className="text-[10px] font-black text-content-tertiary uppercase tracking-[0.1em] opacity-60 leading-none">
                            {label}
                        </label>
                        <span className="text-[8px] font-mono font-bold text-accent-primary/60 uppercase tracking-widest px-2 py-0.5 rounded-full border border-accent-primary/10 bg-accent-primary/5">
                            {control.type?.toUpperCase() || 'NUM'}
                        </span>
                    </div>
                    <div className="space-y-3 px-1 pb-1">
                        <input
                            type="range"
                            min={control.min ?? 0}
                            max={control.max ?? 1}
                            step={control.step ?? 0.01}
                            value={value ?? control.default_value ?? 0.5}
                            onChange={e => onChange(control.api_mapping_key, parseFloat(e.target.value))}
                            className="w-full h-1.5 bg-white/10 rounded-full appearance-none cursor-pointer accent-accent-primary transition-all hover:scale-y-125"
                        />
                        <div className="flex justify-between items-center text-[10px] font-mono text-content-tertiary/60">
                            <span className="opacity-40">{control.min ?? 0}</span>
                            <div className="px-2 py-0.5 rounded bg-accent-primary/10 border border-accent-primary/20 text-accent-primary font-black scale-110 shadow-lg shadow-accent-primary/10">
                                {value ?? control.default_value ?? 0.5}
                            </div>
                            <span className="opacity-40">{control.max ?? 1}</span>
                        </div>
                    </div>
                </div>
            );
        case 'checkbox':
        case 'reverse':
            return (
                <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                        <label className="text-[10px] font-black text-content-tertiary uppercase tracking-[0.1em] pl-1 opacity-60 leading-none">
                            {label}
                        </label>
                        <span className="text-[8px] font-bold text-accent-primary/40 uppercase tracking-widest px-2 py-0.5 rounded-full border border-accent-primary/10">BOOL</span>
                    </div>
                    <div className="flex bg-white/5 rounded-xl p-1.5 border border-white/10 shadow-inner">
                        {[
                            { label: 'No', value: false },
                            { label: 'Yes', value: true }
                        ].map((opt) => (
                            <button
                                key={opt.label}
                                type="button"
                                onClick={() => onChange(control.api_mapping_key, opt.value)}
                                className={cn(
                                    "flex-1 py-2 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all",
                                    (value === opt.value || (value === undefined && opt.value === control.default_value))
                                        ? "bg-accent-primary text-white shadow-xl shadow-accent-primary/30 scale-[1.02]"
                                        : "text-content-tertiary hover:text-content-secondary hover:bg-white/5"
                                )}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </div>
            );
        case 'number_input':
            return (
                <div className="space-y-2">
                    <label className="text-[10px] font-bold text-content-tertiary uppercase tracking-wider pl-1 opacity-80 leading-none">
                        {label}
                    </label>
                    <input
                        type="number"
                        min={control.min}
                        max={control.max}
                        step={control.step ?? 1}
                        value={value ?? control.default_value ?? 0}
                        onChange={e => onChange(control.api_mapping_key, parseFloat(e.target.value))}
                        className={baseInputClass}
                    />
                </div>
            );
        case 'text_input':
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
