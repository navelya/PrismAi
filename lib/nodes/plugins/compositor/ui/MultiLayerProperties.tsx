'use client';

import React from 'react';
import { RotateCcw, FlipHorizontal, FlipVertical, AlignCenter, AlignJustify, ArrowLeft, ArrowRight, ArrowUp, ArrowDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Select } from '@/components/ui/Select';
import { CompositorLayer, LayerTransform } from '../definition';

const BLEND_MODES = [
    { id: 'source-over', display_name: 'Normal' }, { id: 'multiply', display_name: 'Multiply' },
    { id: 'screen', display_name: 'Screen' }, { id: 'overlay', display_name: 'Overlay' },
    { id: 'darken', display_name: 'Darken' }, { id: 'lighten', display_name: 'Lighten' },
    { id: 'color-dodge', display_name: 'Color Dodge' }, { id: 'color-burn', display_name: 'Color Burn' },
    { id: 'hard-light', display_name: 'Hard Light' }, { id: 'soft-light', display_name: 'Soft Light' },
    { id: 'difference', display_name: 'Difference' }, { id: 'exclusion', display_name: 'Exclusion' },
];

/** Shared value across layers for a transform field, or undefined if mixed. */
function shared<K extends keyof LayerTransform>(layers: CompositorLayer[], key: K): LayerTransform[K] | undefined {
    if (layers.length === 0) return undefined;
    const first = layers[0].transform[key];
    return layers.every((l) => l.transform[key] === first) ? first : undefined;
}

export default function MultiLayerProperties({
    layers,
    onUpdateAll,
    onAlignAll,
}: {
    layers: CompositorLayer[];
    onUpdateAll: (patch: Partial<LayerTransform>) => void;
    onAlignAll: (type: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => void;
}) {
    const opacity = shared(layers, 'opacity');
    const rotation = shared(layers, 'rotation');
    const blend = shared(layers, 'blendMode') ?? 'source-over';
    const flipX = shared(layers, 'flipX');
    const flipY = shared(layers, 'flipY');

    return (
        <div className="flex-1 overflow-y-auto p-4 space-y-8 custom-scrollbar pb-20">
            <div className="text-[10px] font-black text-accent-primary uppercase tracking-widest">{layers.length} layers selected</div>

            {/* Alignment (each layer aligned against the canvas) */}
            <div className="space-y-3">
                <label className="text-[9px] font-black text-white/20 uppercase tracking-widest">Alignment</label>
                <div className="grid grid-cols-6 gap-1 bg-white/5 p-1 rounded-xl border border-white/5">
                    <button onClick={() => onAlignAll('left')} className="p-2 rounded-lg hover:bg-white/10 text-white/40 flex items-center justify-center"><ArrowLeft className="w-3.5 h-3.5" /></button>
                    <button onClick={() => onAlignAll('center')} className="p-2 rounded-lg hover:bg-white/10 text-white/40 flex items-center justify-center"><AlignCenter className="w-3.5 h-3.5" /></button>
                    <button onClick={() => onAlignAll('right')} className="p-2 rounded-lg hover:bg-white/10 text-white/40 flex items-center justify-center"><ArrowRight className="w-3.5 h-3.5" /></button>
                    <button onClick={() => onAlignAll('top')} className="p-2 rounded-lg hover:bg-white/10 text-white/40 flex items-center justify-center"><ArrowUp className="w-3.5 h-3.5" /></button>
                    <button onClick={() => onAlignAll('middle')} className="p-2 rounded-lg hover:bg-white/10 text-white/40 flex items-center justify-center"><AlignJustify className="w-3.5 h-3.5 rotate-90" /></button>
                    <button onClick={() => onAlignAll('bottom')} className="p-2 rounded-lg hover:bg-white/10 text-white/40 flex items-center justify-center"><ArrowDown className="w-3.5 h-3.5" /></button>
                </div>
            </div>

            {/* Rotation + Flip */}
            <div className="grid grid-cols-2 gap-3 items-end">
                <div className="relative">
                    <label className="text-[8px] font-bold text-white/20 uppercase tracking-widest pl-1 mb-1 block">Rotation</label>
                    <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-2 h-8">
                        <RotateCcw className="w-3 h-3 text-white/20" />
                        <input type="number" placeholder={rotation === undefined ? 'Mixed' : undefined}
                            value={rotation === undefined ? '' : Math.round(rotation)}
                            onChange={(e) => onUpdateAll({ rotation: Number(e.target.value) })}
                            className="w-full bg-transparent border-none focus:outline-none text-xs text-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                        <span className="text-[10px] font-bold text-white/20">°</span>
                    </div>
                </div>
                <div className="flex gap-1 bg-white/5 p-1 rounded-lg border border-white/5 h-8">
                    <button onClick={() => onUpdateAll({ flipX: !flipX })} className={cn("flex-1 rounded flex items-center justify-center transition-all", flipX ? "bg-accent-primary text-white" : "text-white/20 hover:text-white")}><FlipHorizontal className="w-3 h-3" /></button>
                    <button onClick={() => onUpdateAll({ flipY: !flipY })} className={cn("flex-1 rounded flex items-center justify-center transition-all", flipY ? "bg-accent-primary text-white" : "text-white/20 hover:text-white")}><FlipVertical className="w-3 h-3" /></button>
                </div>
            </div>

            {/* Blend + Opacity */}
            <div className="space-y-4">
                <label className="text-[9px] font-black text-white/20 uppercase tracking-widest">Effects</label>
                <Select variant="minimal" label="Blend Mode" value={blend} options={BLEND_MODES} onChange={(e) => onUpdateAll({ blendMode: e.target.value })} />
                <div className="space-y-2">
                    <div className="flex justify-between items-center px-1">
                        <label className="text-[8px] font-bold text-white/30 uppercase tracking-widest">Opacity</label>
                        <span className="text-[10px] font-black text-accent-primary tabular-nums">{opacity === undefined ? 'Mixed' : `${Math.round(opacity * 100)}%`}</span>
                    </div>
                    <input type="range" min="0" max="1" step="0.01" value={opacity ?? 1} onChange={(e) => onUpdateAll({ opacity: Number(e.target.value) })} className="w-full h-1 bg-white/10 rounded-full appearance-none cursor-pointer accent-accent-primary" />
                </div>
            </div>
        </div>
    );
}
