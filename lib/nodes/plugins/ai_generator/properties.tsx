'use client';

import React, { useEffect } from 'react';
import { Eye, EyeOff, Play, Coins } from 'lucide-react';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { NumberInput } from '@/components/ui/NumberInput';
import { Switch } from '@/components/ui/Switch';
import { AspectRatioPicker, isCustomAspectFormat } from '@/components/ui/AspectRatioPicker';
import { cn } from '@/lib/utils';
import { formatDisplayName } from '@/lib/utils/schema-parser';

// =============================================================================
// TYPES - MOVED TO lib/nodes/types.ts
// =============================================================================
import { AiModel, Control, isSeedControl } from '@/lib/nodes/types';
import { selectVisibleModels } from '@/lib/store/model-selectors';
import { useAppStore } from '@/lib/store/app-store';
import { DescriptionHint } from '@/components/ui/DescriptionHint';
import { Skeleton } from '@/components/ui/Skeleton';
import { computeAiNodeCost, clampIterations, computeModelMenuCost, formatCredits } from '@/lib/billing/cost';
import { useNodeRunValidation } from '@/lib/hooks/use-node-run-validation';
import { useNodeConnectedInputCost } from '@/lib/hooks/use-node-connected-cost';
import { formatValidationError } from '@/lib/workflow/validate-execution-messages';
import { Tooltip } from '@/components/ui/Tooltip';
import { VoicePickerControl } from './VoicePickerControl';
import { useModelPreview } from '@/components/editor/ModelPreview';

// =============================================================================
// SKELETON LOADER
// =============================================================================

function PropertiesSkeleton() {
    return (
        <div className="flex-1 flex flex-col min-h-0 animate-in fade-in duration-300 overflow-hidden">
            <div className="flex-1 overflow-y-auto custom-scrollbar px-3 pt-3 pb-3 space-y-3">
                <div className="space-y-1.5">
                    <Skeleton className="h-2.5 w-12" />
                    <Skeleton className="h-8 w-full rounded-lg" />
                </div>

                <Skeleton className="h-2.5 w-20" />

                <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                        <div key={i} className="space-y-1.5">
                            <Skeleton className="h-2.5 w-16" />
                            <Skeleton className={cn(
                                "w-full rounded-lg",
                                i === 1 ? "h-20" : i === 2 ? "h-12" : "h-8"
                            )} />
                        </div>
                    ))}
                </div>
            </div>

            <div className="px-3 py-2 bg-surface-elevated/95 backdrop-blur-xl border-t border-stroke-subtle/60 flex items-center justify-between gap-2 z-30 shrink-0">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-7 w-20 rounded-lg" />
            </div>
        </div>
    );
}

// =============================================================================
// COMPONENT
// =============================================================================

interface AIGeneratorPropertiesProps {
    config: {
        node_type_id?: string;
        model_id?: number;
        control_values?: Record<string, any>;
        /** Non-control UI state (not sent to executor). */
        ui_state?: Record<string, any>;
        iterations?: number;
    };
    onUpdate: (config: any) => void;
    editMode?: boolean;
    onToggleVisibility?: (key: string, type: 'control' | 'handle') => void;
    hideSelector?: boolean;
    selectedModelOverride?: Partial<AiModel>;
    nodeId?: string;
}

export default function AIGeneratorProperties({ config, onUpdate, editMode = false, onToggleVisibility, hideSelector = false, selectedModelOverride, nodeId }: AIGeneratorPropertiesProps) {
    const models = useAppStore(state => state.models);
    const triggerRunFromNode = useAppStore(state => state.triggerRunFromNode);
    const isModelsLoading = useAppStore(state => state.isModelsLoading);
    // View-only (collaboration viewer): the run button is grayed + disabled.
    const isViewer = useAppStore(state => state.collabRole) === 'viewer';
    // Pre-flight wiring validation for a solo run of this node — same source as
    // the node-card Run button. Empty when there's no real node (admin model
    // edit passes no nodeId), so the button stays enabled in those contexts.
    const modelPreview = useModelPreview();
    const runErrors = useNodeRunValidation(nodeId);
    const cannotRun = runErrors.length > 0;
    const runErrorText = cannotRun ? runErrors.map(formatValidationError).join(' · ') : '';

    // Variant visibility is contextual. A variant (`is_primary === false`) is an
    // alternate-settings row that lives in its OWN sub-category, and the user
    // picks a model here PER sub-category — so inside a sub-category-scoped picker
    // the variant must appear and behave like a normal model. The primary-only
    // dedupe only matters for flat / provider-grouped lists (where two variants of
    // one group would collide, e.g. the unscoped fallback below and the add-node /
    // provider pickers elsewhere). Cost resolution still uses the full `models`.
    const visibleModels = selectVisibleModels(models);
    const filteredModels = config.node_type_id
        ? models.filter(m => m.node_type_id === config.node_type_id)
        : visibleModels;

    useEffect(() => {
        // Default model selection if none exists (and models have loaded)
        if (!isModelsLoading && filteredModels.length > 0 && !config.model_id) {
            const firstActive = filteredModels.find(mod => mod.is_active) || filteredModels[0];
            onUpdate({ ...config, model_id: firstActive.id, control_values: {} });
        }
    }, [isModelsLoading, filteredModels, config.model_id, onUpdate]);

    // Fall back to the full list so a node bound to a hidden variant (e.g. one the
    // chat brain wired) still resolves its controls/handles, even though the
    // dropdown only offers primaries.
    const selectedModel = selectedModelOverride
        || filteredModels.find(m => m.id === config.model_id)
        || models.find(m => m.id === config.model_id);
    const controls = selectedModel?.inputs_schema?.controls || [];
    const handles = selectedModel?.inputs_schema?.handles || [];

    // Cost of media wired into this node's priced input handles (one-time / per-item),
    // so the estimate reacts live when an image is connected — mirrors the run-modal total.
    // Declared before the isModelsLoading early-return to keep hook order stable.
    const connectedInputCost = useNodeConnectedInputCost(nodeId, selectedModel ?? null);

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
        return <PropertiesSkeleton />;
    }

    const totalCost = selectedModel
        ? Number(((computeAiNodeCost(config.control_values, selectedModel) + connectedInputCost) * clampIterations(config.iterations)).toFixed(2))
        : 0;

    const hasMultiplier = (selectedModel?.inputs_schema?.controls ?? [])
        .some(c => c.is_cost_multiplier === true);

    // Aspect-ratio link: when an aspect_ratio control exists and is NOT in custom
    // mode, hide sibling width/height controls — picking a preset means letting the
    // model choose the dimensions.
    const aspectControl = controls.find(c => c.component === 'aspect_ratio');
    const aspectValue = aspectControl
        ? String(config.control_values?.[aspectControl.api_mapping_key] ?? aspectControl.default_value ?? '')
        : '';
    const aspectCustomFlag = config.ui_state?.aspect_ratio_custom === true;
    const aspectIsCustom = aspectCustomFlag || (!!aspectControl && isCustomAspectFormat(aspectValue));

    const setAspectCustom = (next: boolean) => {
        onUpdate({
            ...config,
            ui_state: {
                ...(config.ui_state || {}),
                aspect_ratio_custom: next,
            },
        });
    };

    const dimensionKeys = new Set(['width', 'height']);
    const visibleControls = controls.filter(ctrl => {
        if (aspectControl && !aspectIsCustom && dimensionKeys.has(ctrl.api_mapping_key.toLowerCase())) {
            return false;
        }
        return true;
    });

    return (
        <div className="flex-1 flex flex-col min-h-0 animate-in fade-in duration-300 overflow-hidden">
            {modelPreview.overlay}
            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto custom-scrollbar px-3 pt-3 pb-3 space-y-3">
                {/* Model Selection */}
                {!hideSelector && (
                    <Select
                        label="Model"
                        value={config.model_id?.toString() || ''}
                        onChange={(e) => handleModelChange(e.target.value)}
                        onOpenChange={(open) => { if (!open) modelPreview.hide(); }}
                        options={filteredModels.filter(m => m.is_active).map(m => {
                            const cost = computeModelMenuCost(m);
                            return {
                                id: m.id.toString(),
                                display_name: m.display_name,
                                icon_url: m.providers?.logo_url ?? undefined,
                                ...modelPreview.bind(m),
                                meta: (
                                    <span className="inline-flex items-center gap-1 text-[10px] font-mono font-medium tabular-nums text-content-secondary">
                                        <Coins className="w-3.5 h-3.5 text-accent-primary/80" />
                                        {formatCredits(cost.credits)}{cost.perSecond ? '/s' : ''}
                                    </span>
                                ),
                            };
                        })}
                        placeholder="Select a model..."
                        variant="minimal"
                    />
                )}

                {/* Curation Handles (edit mode only) */}
                {editMode && (handles.length > 0 || (selectedModel?.outputs_schema?.handles?.length ?? 0) > 0) && (
                    <div className="space-y-2 bg-white/5 border border-white/10 rounded-lg p-2">
                         {handles.length > 0 && (
                             <div className="space-y-1.5">
                                <p className="text-[9px] font-bold uppercase tracking-widest text-content-tertiary px-0.5">Inputs</p>
                                <div className="flex flex-wrap gap-1">
                                    {handles.map(h => (
                                        <button
                                            key={h.api_mapping_key}
                                            type="button"
                                            onClick={() => onToggleVisibility?.(h.api_mapping_key, 'input-handle' as any)}
                                            className={cn(
                                                "flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[9px] font-semibold uppercase transition-all",
                                                h.is_visible
                                                    ? "bg-blue-500/10 border-blue-500/30 text-blue-400"
                                                    : "bg-white/5 border-white/10 text-content-tertiary line-through opacity-50"
                                            )}
                                        >
                                            {h.is_visible ? <Eye className="w-2.5 h-2.5" /> : <EyeOff className="w-2.5 h-2.5" />}
                                            {h.name}
                                        </button>
                                    ))}
                                </div>
                             </div>
                         )}

                         {(selectedModel?.outputs_schema?.handles?.length ?? 0) > 0 && (
                             <div className="space-y-1.5 pt-1.5 border-t border-white/5">
                                <p className="text-[9px] font-bold uppercase tracking-widest text-content-tertiary px-0.5">Outputs</p>
                                <div className="flex flex-wrap gap-1">
                                    {selectedModel?.outputs_schema?.handles?.map(h => (
                                        <button
                                            key={h.api_mapping_key}
                                            type="button"
                                            onClick={() => onToggleVisibility?.(h.api_mapping_key, 'output-handle' as any)}
                                            className={cn(
                                                "flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[9px] font-semibold uppercase transition-all",
                                                h.is_visible
                                                    ? "bg-accent-primary/10 border-accent-primary/30 text-accent-primary"
                                                    : "bg-white/5 border-white/10 text-content-tertiary line-through opacity-50"
                                            )}
                                        >
                                            {h.is_visible ? <Eye className="w-2.5 h-2.5" /> : <EyeOff className="w-2.5 h-2.5" />}
                                            {h.name || formatDisplayName(h.api_mapping_key)}
                                        </button>
                                    ))}
                                </div>
                             </div>
                         )}
                    </div>
                )}

                {/* Dynamic Controls */}
                {controls.length > 0 && (
                    <div className="space-y-2 pt-1">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-content-tertiary px-0.5">
                            Parameters
                        </p>

                        <div className="space-y-2.5">
                            {visibleControls
                                .filter(ctrl => editMode || ctrl.is_visible)
                                .map(ctrl => (
                                    <div key={ctrl.api_mapping_key} className="relative group/field">
                                        {editMode && (
                                            <button
                                                type="button"
                                                onClick={() => onToggleVisibility?.(ctrl.api_mapping_key, 'control')}
                                                className={cn(
                                                    "absolute -top-1 -right-1 z-10 w-5 h-5 rounded-full flex items-center justify-center border shadow-md transition-all",
                                                    ctrl.is_visible
                                                        ? "bg-green-500 border-green-400 text-white"
                                                        : "bg-red-500 border-red-400 text-white"
                                                )}
                                            >
                                                {ctrl.is_visible ? <Eye className="w-2.5 h-2.5" /> : <EyeOff className="w-2.5 h-2.5" />}
                                            </button>
                                        )}
                                        <div className={cn("transition-all", !ctrl.is_visible && "opacity-40 grayscale-[0.5]")}>
                                            <ControlRenderer
                                                control={ctrl}
                                                value={config.control_values?.[ctrl.api_mapping_key]}
                                                seedRandom={config.control_values?.__seedRandom}
                                                onChange={handleControlChange}
                                                aspectIsCustom={aspectIsCustom}
                                                onAspectCustomChange={setAspectCustom}
                                                descriptionBody={ctrl.description}
                                            />
                                        </div>
                                    </div>
                                ))}
                        </div>
                    </div>
                )}

                {/* Iterations — node-level (not a model control); multiplies cost.
                    Placed last, just above the run footer. */}
                {selectedModel && (
                    <div className="space-y-1 pt-1">
                        <div className="flex items-center justify-between">
                            <label className="text-[8px] font-bold text-content-tertiary uppercase tracking-[0.1em] pl-0.5 leading-none opacity-80">
                                Iterations
                            </label>
                            <span className="text-[9px] font-mono font-semibold text-accent-primary tracking-tight tabular-nums">
                                {Math.min(Math.max(Number(config.iterations ?? 1), 1), 10)}×
                            </span>
                        </div>
                        <input
                            type="range"
                            min={1}
                            max={10}
                            step={1}
                            value={Math.min(Math.max(Number(config.iterations ?? 1), 1), 10)}
                            onChange={(e) => onUpdate({ ...config, iterations: parseInt(e.target.value, 10) })}
                            className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-accent-primary"
                        />
                        <div className="flex justify-between text-[8px] font-mono text-content-tertiary/40 tabular-nums px-0.5">
                            <span>1</span>
                            <span>10</span>
                        </div>
                    </div>
                )}
            </div>

            {/* Compact Footer */}
            <div className="px-3 py-2 bg-surface-elevated/95 backdrop-blur-xl border-t border-stroke-subtle/60 flex items-center justify-between gap-2 z-30 shrink-0">
                <div className="flex items-center gap-1.5 min-w-0">
                    <Coins className="w-3 h-3 text-accent-primary shrink-0" />
                    <span className="text-[9px] font-bold text-accent-primary/80 uppercase tracking-widest whitespace-nowrap">Cost</span>
                    <span className="text-sm font-black text-accent-primary tracking-tight leading-none truncate">
                        {totalCost}
                    </span>
                    <span className="text-[9px] font-bold text-accent-primary/60 uppercase tracking-tight leading-none whitespace-nowrap">
                        CR{!hasMultiplier && selectedModel?.is_per_second ? '/s' : ''}
                    </span>
                </div>

                <Tooltip
                    content={runErrorText}
                    position="top"
                    popupClassName="whitespace-normal max-w-xs leading-snug normal-case tracking-normal font-semibold"
                >
                <button
                    onClick={() => { if (!isViewer && !cannotRun && nodeId) triggerRunFromNode(nodeId, 'solo'); }}
                    // cannotRun stays OUT of `disabled` (a disabled button swallows
                    // hover events in Chromium → no tooltip). Styled + click-guarded
                    // instead so the Tooltip wrapper can still explain why.
                    disabled={!nodeId || isViewer}
                    className={cn(
                        "h-7 px-2.5 bg-accent-primary hover:bg-accent-primary/90 rounded-lg flex items-center justify-center gap-1 text-white font-bold uppercase tracking-wider text-[10px] shadow-md shadow-accent-primary/20 transition-all active:scale-95 shrink-0",
                        // Viewer / no-node disable keeps pointer-events off; cannotRun
                        // leaves them on so the Tooltip wrapper can surface the reason.
                        (!nodeId || isViewer) && "opacity-30 pointer-events-none",
                        cannotRun && "opacity-30 hover:bg-accent-primary"
                    )}
                >
                    <Play className="w-2.5 h-2.5 fill-white" />
                    Run
                </button>
                </Tooltip>
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
    seedRandom,
    onChange,
    aspectIsCustom,
    onAspectCustomChange,
    descriptionBody,
}: {
    control: Control;
    value: any;
    /** For the seed control only: current value of the reserved `__seedRandom` flag. */
    seedRandom?: boolean;
    onChange: (key: string, val: any) => void;
    aspectIsCustom?: boolean;
    onAspectCustomChange?: (custom: boolean) => void;
    descriptionBody?: string;
}) {
    const label = control.label || formatDisplayName(control.api_mapping_key);

    // ⓘ info marker next to the label, revealing the attached description on hover.
    // Renders nothing when the control has no description. `side="bottom"` shows it
    // centered underneath, auto-fitting within the viewport.
    const hint = <DescriptionHint body={descriptionBody} side="bottom" />;

    const minimalLabelClass = "text-[8px] font-bold text-content-tertiary uppercase tracking-[0.1em] pl-0.5 leading-none opacity-80";

    // Seed: a "Random" toggle (ON by default) decides whether to randomize. The number
    // field always shows the would-be seed (pre-filled from the admin default); it is
    // disabled while Random is on. Random state lives under the reserved `__seedRandom`
    // key in control_values; the executor omits the seed entirely when it isn't `false`.
    if (isSeedControl(control)) {
        const raw = value ?? control.default_value ?? '';
        const isRandom = seedRandom !== false; // undefined → ON by default
        return (
            <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                    <label className={cn(minimalLabelClass, "flex items-center gap-1")}>{label}{hint}</label>
                    <Switch
                        size="sm"
                        checked={isRandom}
                        onCheckedChange={checked => onChange('__seedRandom', checked)}
                        label="Random"
                    />
                </div>
                <NumberInput
                    min={control.min}
                    max={control.max}
                    step={control.step ?? 1}
                    value={raw === null ? '' : raw}
                    placeholder={isRandom ? 'Random' : 'Seed'}
                    disabled={isRandom}
                    onChange={e => {
                        const v = e.target.value;
                        onChange(control.api_mapping_key, v === '' ? '' : parseFloat(v));
                    }}
                    variant="minimal"
                />
            </div>
        );
    }

    switch (control.component) {
        case 'textarea':
        case 'prompt_textarea':
        case 'negative_prompt':
            return (
                <div className="space-y-1">
                    <label className={cn(minimalLabelClass, "flex items-center gap-1")}>{label}{hint}</label>
                    <textarea
                        value={value ?? control.default_value ?? ''}
                        onChange={e => onChange(control.api_mapping_key, e.target.value)}
                        placeholder={control.component === 'negative_prompt' ? 'What to exclude…' : 'What to generate…'}
                        rows={6}
                        className="w-full min-h-[9rem] bg-white/5 border border-white/10 rounded-lg text-content-primary text-xs px-2 py-1.5 focus:outline-none focus:border-accent-primary/50 focus:ring-4 focus:ring-accent-primary/10 transition-all placeholder:text-content-tertiary/40 resize-none leading-relaxed"
                    />
                </div>
            );
        case 'aspect_ratio':
            return (
                <div className="relative">
                    {descriptionBody && <span className="absolute top-0 right-0 z-10">{hint}</span>}
                    <AspectRatioPicker
                        label={label}
                        value={String(value ?? control.default_value ?? '')}
                        options={control.options}
                        onChange={val => onChange(control.api_mapping_key, val)}
                        variant="minimal"
                        isCustom={aspectIsCustom}
                        onCustomChange={onAspectCustomChange}
                    />
                </div>
            );
        case 'select':
        case 'resolution':
        case 'format': {
            const allOptions = control.options || [];
            const disabled = new Set(control.disabled_options ?? []);
            const visibleOptions = allOptions.filter(opt => !disabled.has(opt));
            const stored = value ?? control.default_value ?? '';
            // If the saved value points at a now-hidden option, fall back to the first
            // visible option for display only — do NOT mutate stored config.
            const effective = disabled.has(String(stored)) && visibleOptions.length > 0
                ? visibleOptions[0]
                : stored;
            return (
                <Select
                    label={label}
                    labelAccessory={hint}
                    value={effective}
                    onChange={e => onChange(control.api_mapping_key, e.target.value)}
                    options={visibleOptions.map(opt => ({
                        id: opt,
                        display_name: formatDisplayName(opt.toString())
                    }))}
                    variant="minimal"
                />
            );
        }
        case 'slider':
        case 'threshold': {
            const current = value ?? control.default_value ?? 0.5;
            return (
                <div className="space-y-1">
                    <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1">
                            <label className={minimalLabelClass}>{label}</label>
                            {hint}
                        </span>
                        <span className="text-[9px] font-mono font-semibold text-accent-primary tracking-tight tabular-nums">
                            {current}
                        </span>
                    </div>
                    <input
                        type="range"
                        min={control.min ?? 0}
                        max={control.max ?? 1}
                        step={control.step ?? 0.01}
                        value={current}
                        onChange={e => onChange(control.api_mapping_key, parseFloat(e.target.value))}
                        className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-accent-primary"
                    />
                    <div className="flex justify-between text-[8px] font-mono text-content-tertiary/40 tabular-nums px-0.5">
                        <span>{control.min ?? 0}</span>
                        <span>{control.max ?? 1}</span>
                    </div>
                </div>
            );
        }
        case 'checkbox':
        case 'reverse':
            return (
                <div className="flex items-center justify-between gap-2 px-2 py-1.5 bg-white/5 border border-white/10 rounded-lg transition-colors hover:bg-white/[0.07]">
                    <span className="flex items-center gap-1 min-w-0">
                        <label className="text-[10px] font-bold text-content-secondary tracking-tight truncate">
                            {label}
                        </label>
                        {hint}
                    </span>
                    <Switch
                        size="sm"
                        checked={value ?? control.default_value ?? false}
                        onCheckedChange={(checked) => onChange(control.api_mapping_key, checked)}
                    />
                </div>
            );
        case 'number_input':
            return (
                <NumberInput
                    label={label}
                    labelAccessory={hint}
                    min={control.min}
                    max={control.max}
                    step={control.step ?? 1}
                    value={value ?? control.default_value ?? 0}
                    onChange={e => onChange(control.api_mapping_key, parseFloat(e.target.value))}
                    variant="minimal"
                />
            );
        case 'voice_picker':
            return (
                <div className="relative">
                    {descriptionBody && <span className="absolute top-0 right-0 z-10">{hint}</span>}
                    <VoicePickerControl
                        label={label}
                    // Fall back to the admin-configured default voice (control.default_value)
                    // when the node has no explicitly-picked voice yet — same display-fallback
                    // pattern every other control uses, and matches what the executor runs
                    // (executor.server.ts: control_values?.[key] ?? ctrl.default_value).
                    value={value ?? control.default_value}
                    onChange={val => onChange(control.api_mapping_key, val)}
                    />
                </div>
            );
        case 'text_input':
        default:
            return (
                <Input
                    label={label}
                    labelAccessory={hint}
                    value={value ?? control.default_value ?? ''}
                    onChange={e => onChange(control.api_mapping_key, e.target.value)}
                    placeholder={`${control.api_mapping_key}…`}
                    variant="minimal"
                />
            );
    }
}
