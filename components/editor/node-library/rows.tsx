'use client';
import React from 'react';
import { ChevronRight, Building2 } from 'lucide-react';
import * as Icons from 'lucide-react';
import { NodeTypeRecord, Category, AiModel } from '@/lib/nodes/types';

type DragPayload = Record<string, unknown>;

function startDrag(e: React.DragEvent, payload: DragPayload, onAfterStart?: () => void) {
    e.dataTransfer.setData('application/reactflow', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'move';
    if (onAfterStart) onAfterStart();
}

export interface BasicsTileProps {
    name: string;
    desc: string;
    icon: React.ComponentType<{ className?: string }>;
    payload: DragPayload;
    onDragStart?: () => void;
}

export function BasicsTile({ name, desc, icon: Icon, payload, onDragStart }: BasicsTileProps) {
    return (
        <div
            draggable
            onDragStart={e => startDrag(e, payload, onDragStart)}
            className="flex items-center gap-3 p-2.5 rounded-xl border border-stroke-subtle bg-surface-primary hover:border-accent-primary hover:bg-accent-primary/5 transition-all cursor-move group shadow-sm"
        >
            <div className="w-8 h-8 rounded-lg bg-surface-secondary flex items-center justify-center flex-shrink-0 group-hover:bg-accent-primary/10 transition-colors">
                <Icon className="w-4 h-4 text-content-secondary group-hover:text-accent-primary transition-colors" />
            </div>
            <div className="flex-1 min-w-0">
                <div className="font-semibold text-[11px] text-content-primary truncate">{name}</div>
                <div className="text-[9px] text-content-tertiary truncate">{desc}</div>
            </div>
        </div>
    );
}

export interface CategoryRowProps {
    id?: string;
    category: Category;
    active: boolean;
    onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => void;
    onFocus?: () => void;
}

export function CategoryRow({ id, category, active, onMouseEnter, onFocus }: CategoryRowProps) {
    const IconComponent = (Icons[category.icon_reference as keyof typeof Icons] as React.ComponentType<{ className?: string }>) || Icons.Folder;
    return (
        <button
            id={id}
            data-active={active}
            onMouseEnter={onMouseEnter}
            onFocus={onFocus}
            className="w-full flex items-center justify-between gap-3 p-2.5 rounded-xl border border-stroke-subtle bg-surface-primary hover:border-accent-primary hover:bg-accent-primary/5 transition-all group shadow-sm text-left data-[active=true]:border-accent-primary/30 data-[active=true]:bg-accent-primary/5"
        >
            <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-surface-secondary flex items-center justify-center flex-shrink-0 group-hover:bg-accent-primary/10 transition-colors">
                    <IconComponent className="w-4 h-4 text-content-primary group-hover:text-accent-primary transition-colors" />
                </div>
                <span className="text-[11px] font-semibold text-content-primary truncate">{category.display_name}</span>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-content-tertiary flex-shrink-0" />
        </button>
    );
}

export interface ProviderRowProps {
    id?: string;
    provider: { id: string; name: string; logo_url: string | null };
    active: boolean;
    onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => void;
    onFocus?: () => void;
}

export function ProviderRow({ id, provider, active, onMouseEnter, onFocus }: ProviderRowProps) {
    return (
        <button
            id={id}
            data-active={active}
            onMouseEnter={onMouseEnter}
            onFocus={onFocus}
            className="w-full flex items-center justify-between gap-3 p-2.5 rounded-xl border border-stroke-subtle bg-surface-primary hover:border-accent-primary hover:bg-accent-primary/5 transition-all group shadow-sm text-left data-[active=true]:border-accent-primary/30 data-[active=true]:bg-accent-primary/5"
        >
            <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-surface-secondary flex items-center justify-center flex-shrink-0 group-hover:bg-accent-primary/10 transition-colors overflow-hidden p-1.5">
                    {provider.logo_url
                        ? <img src={provider.logo_url} alt={provider.name} className="w-full h-full object-contain" />
                        : <Building2 className="w-4 h-4 text-content-primary group-hover:text-accent-primary transition-colors" />}
                </div>
                <span className="text-[11px] font-semibold text-content-primary truncate">{provider.name}</span>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-content-tertiary flex-shrink-0" />
        </button>
    );
}

export interface NodeItemRowProps {
    nodeType: NodeTypeRecord;
    onDragStart?: () => void;
}

export function NodeItemRow({ nodeType, onDragStart }: NodeItemRowProps) {
    const IconComp = (Icons[nodeType.icon_reference as keyof typeof Icons] as React.ComponentType<{ className?: string }>) || Icons.Zap;
    return (
        <div
            draggable
            onDragStart={e => startDrag(e, { type: 'ai_generator', node_type_id: nodeType.id, archetype_id: nodeType.archetype_id }, onDragStart)}
            className="flex items-center gap-3 p-3 border border-stroke-subtle rounded-xl cursor-move hover:border-accent-primary hover:bg-accent-primary/5 transition-all bg-surface-primary group shadow-sm"
        >
            <div className="w-10 h-10 rounded-lg bg-surface-secondary flex items-center justify-center flex-shrink-0 group-hover:bg-accent-primary/10 transition-colors">
                <IconComp className="w-5 h-5 text-content-secondary group-hover:text-accent-primary transition-colors" />
            </div>
            <div className="flex-1 min-w-0">
                <div className="font-bold text-sm text-content-primary truncate">{nodeType.display_name}</div>
                <div className="text-[10px] text-content-tertiary uppercase tracking-wider">Dynamic node</div>
            </div>
        </div>
    );
}

export interface ModelItemRowProps {
    model: AiModel;
    provider?: { name: string; logo_url: string | null } | null;
    onDragStart?: () => void;
}

export function ModelItemRow({ model, provider, onDragStart }: ModelItemRowProps) {
    return (
        <div
            draggable
            onDragStart={e => startDrag(e, { type: 'ai_generator', node_type_id: model.node_type_id, model_id: model.id }, onDragStart)}
            className="flex items-center gap-3 p-3 border border-stroke-subtle rounded-xl cursor-move hover:border-accent-primary hover:bg-accent-primary/5 transition-all bg-surface-primary group shadow-sm"
        >
            <div className="w-10 h-10 rounded-lg bg-surface-secondary flex items-center justify-center flex-shrink-0 group-hover:bg-accent-primary/10 transition-colors overflow-hidden p-1.5">
                {provider?.logo_url
                    ? <img src={provider.logo_url} alt={provider.name} className="w-full h-full object-contain" />
                    : <Icons.Box className="w-5 h-5 text-content-secondary group-hover:text-accent-primary transition-colors" />}
            </div>
            <div className="flex-1 min-w-0">
                <div className="font-bold text-sm text-content-primary truncate">{model.display_name}</div>
                <div className="text-[10px] text-content-tertiary uppercase tracking-wider">{model.replicate_model_id.split(':')[0]}</div>
            </div>
        </div>
    );
}
