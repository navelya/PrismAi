'use client';

import React, { memo, useState, useMemo, useCallback, useEffect } from 'react';
import { NodeProps } from 'reactflow';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '@/lib/utils';
import BaseNode from '@/lib/nodes/core/canvas/BaseNode';
import BlurryImage from '@/components/ui/BlurryImage';
import ImageLightbox from '@/components/ui/ImageLightbox';
import { NumberInput } from '@/components/ui/NumberInput';
import { CardDownloadButton } from '@/components/editor/CardDownloadButton';
import { useCardDownload } from '@/lib/hooks/use-card-download';
import { useAppStore } from '@/lib/store/app-store';
import { useNodeAutoCompute } from '@/lib/hooks/use-node-auto-compute';
import { NodeClientDef } from '../../core/types';
import { LevelsConfig, levelsSharedDef } from './definition';
import { levelsClientExecutor } from './executor.client';

interface LevelsNodeData {
    label: string;
    config: LevelsConfig;
}

const defaultConfig: LevelsConfig = {
    black_point: 0,
    white_point: 255,
    gamma: 1.0,
};

interface SliderRowProps {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    decimals?: number;
    accent?: string;
    onLocalChange: (v: number) => void;
    onCommit: (v: number) => void;
}

const SliderRow = memo(function SliderRow({
    label,
    value,
    min,
    max,
    step,
    decimals = 0,
    accent = 'bg-accent-primary',
    onLocalChange,
    onCommit,
}: SliderRowProps) {
    const fillPct = ((value - min) / (max - min)) * 100;
    const display = decimals > 0 ? value.toFixed(decimals) : Math.round(value).toString();

    return (
        <div className="flex items-center gap-2 h-7">
            <div className="w-[34px] shrink-0 text-[10px] font-bold uppercase tracking-[0.1em] text-content-tertiary">
                {label}
            </div>
            <div className="flex-1 flex items-center group/slider relative h-full px-1">
                <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={value}
                    onMouseDown={() => useAppStore.getState().takeSnapshot()}
                    onTouchStart={() => useAppStore.getState().takeSnapshot()}
                    onChange={(e) => {
                        const v = parseFloat(e.target.value);
                        if (Number.isNaN(v)) return;
                        onLocalChange(v);
                        onCommit(v);
                    }}
                    className="nodrag w-full h-full bg-transparent appearance-none cursor-pointer accent-accent-primary z-10"
                    style={{ WebkitAppearance: 'none' }}
                />
                <div className="absolute left-0 right-0 h-[1px] bg-white/10 top-1/2 -translate-y-1/2 pointer-events-none" />
                <div
                    className={cn('absolute left-0 h-[1px] top-1/2 -translate-y-1/2 pointer-events-none', accent)}
                    style={{ width: `${fillPct}%` }}
                />
            </div>
            <div className="w-[42px] shrink-0">
                <NumberInput
                    min={min}
                    max={max}
                    step={step}
                    value={display}
                    hideArrows={true}
                    onChange={(e) => {
                        const parsed = parseFloat(e.target.value);
                        if (Number.isNaN(parsed)) return;
                        const clamped = Math.max(min, Math.min(max, parsed));
                        onLocalChange(clamped);
                        onCommit(clamped);
                    }}
                    className="space-y-0 nodrag"
                    inputClassName="h-7 !px-1.5 !text-[10px] !bg-white/5 !border border-white/5 !rounded-lg text-center font-mono font-bold text-accent-primary focus:border-accent-primary/30 transition-all"
                />
            </div>
        </div>
    );
});

function LevelsNode({ data, id, selected, dragging = false }: NodeProps<LevelsNodeData>) {
    const updateNodeConfig = useAppStore((state) => state.updateNodeConfig);
    const isDragging = dragging;
    const [lightboxOpen, setLightboxOpen] = useState(false);

    const { connectedInputId, sourceFallbackOutput } = useAppStore(
        useShallow((state) => {
            const wf = state.currentWorkflow;
            if (!wf) return { connectedInputId: null as string | null, sourceFallbackOutput: null as any };
            const inputEdge = wf.edges.find((e) => e.target === id && e.targetHandle === 'image');
            if (!inputEdge) return { connectedInputId: null, sourceFallbackOutput: null };
            const sourceId = inputEdge.source;
            const node = wf.nodes.find((n) => n.id === sourceId);
            const fallback = node?.data
                ? (node.data.output ?? (node.data.config as any)?.images ?? (node.data.config as any)?.last_output ?? null)
                : null;
            return { connectedInputId: sourceId, sourceFallbackOutput: fallback };
        }),
    );

    const liveSourceOutput = useAppStore((state) =>
        connectedInputId ? state.nodeOutputs[connectedInputId] : undefined,
    );

    useNodeAutoCompute(id);

    const config = useMemo(
        () => ({ ...defaultConfig, ...data.config }),
        [data.config],
    );

    const [localBlack, setLocalBlack] = useState(config.black_point);
    const [localWhite, setLocalWhite] = useState(config.white_point);
    const [localGamma, setLocalGamma] = useState(config.gamma);

    useEffect(() => setLocalBlack(config.black_point), [config.black_point]);
    useEffect(() => setLocalWhite(config.white_point), [config.white_point]);
    useEffect(() => setLocalGamma(config.gamma), [config.gamma]);

    const sourceOutput = useMemo(() => {
        if (!connectedInputId) return null;
        return liveSourceOutput ?? sourceFallbackOutput ?? null;
    }, [connectedInputId, liveSourceOutput, sourceFallbackOutput]);

    const sourceImageUrl = useMemo(() => {
        if (!sourceOutput) return null;
        let imageInput = Array.isArray(sourceOutput) ? sourceOutput[0] : sourceOutput;
        if (imageInput && typeof imageInput === 'object') {
            imageInput =
                (imageInput as any).url ||
                (Array.isArray((imageInput as any).data) ? (imageInput as any).data[0] : imageInput);
        }
        if (!imageInput) return null;
        return typeof imageInput === 'string'
            ? imageInput
            : (imageInput as any)?.url || (imageInput as any)?.previewUrl;
    }, [sourceOutput]);

    // SVG filter params derived from local slider state. Updates as the user
    // drags — no image reload, no JS per pixel. The image element keeps the
    // same src; only the filter primitive's attributes change, and the
    // browser re-rasterizes on the GPU.
    const filterId = useMemo(() => `levels-filter-${id}`, [id]);
    const { slope, intercept, gammaExp } = useMemo(() => {
        const b = Math.max(0, Math.min(255, localBlack)) / 255;
        const w = Math.max(0, Math.min(255, localWhite)) / 255;
        const range = Math.max(0.001, w - b);
        return {
            slope: 1 / range,
            intercept: -b / range,
            gammaExp: 1 / Math.max(0.01, localGamma),
        };
    }, [localBlack, localWhite, localGamma]);

    const handleSync = useCallback(
        (updates: Partial<LevelsConfig>) => {
            updateNodeConfig(id, { ...config, ...updates });
        },
        [id, config, updateNodeConfig],
    );

    const ownOutput = useAppStore((s) => s.nodeOutputs[id]);
    const { state: cardDownloadState, canDownload, handleDownload } = useCardDownload(data.label, ownOutput);

    return (
        <BaseNode
            id={id}
            type="levels"
            label={data.label}
            selected={selected}
            dragging={dragging}
            nodeData={data}
            isNew={(data as any).isNew}
            hideStatus={true}
            width=""
            style={{ width: 'max-content', minWidth: 320, maxWidth: 420 }}
            customActions={canDownload ? <CardDownloadButton state={cardDownloadState} onClick={handleDownload} /> : undefined}
        >
            <div
                className={cn(
                    'relative w-full rounded-xl overflow-hidden shadow-inner group/node border border-white/10 bg-white/5 min-h-[200px]',
                    !isDragging && 'transition-all duration-500',
                )}
            >
                <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />

                {sourceImageUrl ? (
                    <div
                        className="w-full h-full relative group/preview cursor-zoom-in overflow-hidden"
                        onClick={() => setLightboxOpen(true)}
                        style={{ filter: `url(#${filterId})` }}
                    >
                        <BlurryImage
                            src={sourceImageUrl}
                            fallbackSrc={sourceImageUrl}
                            alt="Levels preview"
                            className={cn(
                                'relative z-10',
                                !isDragging && 'transition-transform duration-700 group-hover/preview:scale-[1.03]',
                            )}
                        />
                    </div>
                ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 opacity-30 group-hover/node:opacity-50 transition-opacity duration-500">
                        <div className="text-xs font-medium px-4 text-center text-content-tertiary">
                            Connect an image
                        </div>
                    </div>
                )}

                {/* GPU-accelerated levels filter. Re-renders smoothly on every
                    slider tick — no image decode, no Canvas pixel loop. The
                    server / client executors still run (debounced) so the
                    persisted output and any downstream Compositor see the real
                    LUT'd result; this is purely the on-card live preview. */}
                <svg
                    aria-hidden
                    width="0"
                    height="0"
                    style={{ position: 'absolute', width: 0, height: 0, pointerEvents: 'none' }}
                >
                    <defs>
                        <filter id={filterId} colorInterpolationFilters="sRGB">
                            <feComponentTransfer in="SourceGraphic" result="lvl">
                                <feFuncR type="linear" slope={slope} intercept={intercept} />
                                <feFuncG type="linear" slope={slope} intercept={intercept} />
                                <feFuncB type="linear" slope={slope} intercept={intercept} />
                            </feComponentTransfer>
                            <feComponentTransfer in="lvl">
                                <feFuncR type="gamma" amplitude={1} exponent={gammaExp} offset={0} />
                                <feFuncG type="gamma" amplitude={1} exponent={gammaExp} offset={0} />
                                <feFuncB type="gamma" amplitude={1} exponent={gammaExp} offset={0} />
                            </feComponentTransfer>
                        </filter>
                    </defs>
                </svg>
            </div>

            <div className="mt-3 px-1 pb-1 flex flex-col gap-1.5">
                <SliderRow
                    label="Blk"
                    value={localBlack}
                    min={0}
                    max={255}
                    step={1}
                    onLocalChange={setLocalBlack}
                    onCommit={(v) => handleSync({ black_point: v })}
                />
                <SliderRow
                    label="Gma"
                    value={localGamma}
                    min={0.1}
                    max={3.0}
                    step={0.01}
                    decimals={2}
                    onLocalChange={setLocalGamma}
                    onCommit={(v) => handleSync({ gamma: v })}
                />
                <SliderRow
                    label="Wht"
                    value={localWhite}
                    min={0}
                    max={255}
                    step={1}
                    onLocalChange={setLocalWhite}
                    onCommit={(v) => handleSync({ white_point: v })}
                />
            </div>

            {lightboxOpen && sourceImageUrl && (
                <ImageLightbox
                    media={sourceImageUrl}
                    type="image"
                    initialIndex={0}
                    onClose={() => setLightboxOpen(false)}
                />
            )}
        </BaseNode>
    );
}

export default memo(LevelsNode);

export const levelsClientDef: NodeClientDef = {
    ...levelsSharedDef,
    component: memo((props: any) => <LevelsNode {...props} type="levels" />),
    clientExecutor: levelsClientExecutor,
};
