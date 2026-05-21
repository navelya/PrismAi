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

const ROW_CLASS =
    'flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-white/[0.04] transition-colors group';

const ICON_CHIP_CLASS =
    'w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0 bg-surface-secondary/40 group-hover:bg-accent-primary/10 transition-colors';

const ICON_CLASS =
    'w-3.5 h-3.5 text-content-secondary group-hover:text-accent-primary transition-colors';

export interface BasicsTileProps {
    name: string;
    icon: React.ComponentType<{ className?: string }>;
    payload: DragPayload;
    onDragStart?: () => void;
}

export function BasicsTile({ name, icon: Icon, payload, onDragStart }: BasicsTileProps) {
    return (
        <div
            draggable
            onDragStart={e => startDrag(e, payload, onDragStart)}
            className={`${ROW_CLASS} cursor-move`}
        >
            <div className={ICON_CHIP_CLASS}>
                <Icon className={ICON_CLASS} />
            </div>
            <span className="font-medium text-[11px] text-content-primary truncate">{name}</span>
        </div>
    );
}

export interface CategoryRowProps {
    id?: string;
    category: Category;
    active: boolean;
    onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => void;
    onMouseLeave?: (e: React.MouseEvent<HTMLButtonElement>) => void;
    onFocus?: () => void;
}

export function CategoryRow({ id, category, active, onMouseEnter, onMouseLeave, onFocus }: CategoryRowProps) {
    const IconComponent = (Icons[category.icon_reference as keyof typeof Icons] as React.ComponentType<{ className?: string }>) || Icons.Folder;
    return (
        <button
            id={id}
            data-active={active}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            onFocus={onFocus}
            className={`w-full text-left ${ROW_CLASS} justify-between data-[active=true]:bg-accent-primary/[0.08]`}
        >
            <div className="flex items-center gap-2.5 min-w-0">
                <div className={ICON_CHIP_CLASS}>
                    <IconComponent className={ICON_CLASS} />
                </div>
                <span className="text-[11px] font-medium text-content-primary truncate">{category.display_name}</span>
            </div>
            <ChevronRight className="w-3 h-3 text-content-tertiary flex-shrink-0 opacity-50 group-hover:opacity-100 group-hover:text-accent-primary transition" />
        </button>
    );
}

export interface ProviderRowProps {
    id?: string;
    provider: { id: string; name: string; logo_url: string | null };
    active: boolean;
    onMouseEnter: (e: React.MouseEvent<HTMLButtonElement>) => void;
    onMouseLeave?: (e: React.MouseEvent<HTMLButtonElement>) => void;
    onFocus?: () => void;
}

export function ProviderRow({ id, provider, active, onMouseEnter, onMouseLeave, onFocus }: ProviderRowProps) {
    return (
        <button
            id={id}
            data-active={active}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            onFocus={onFocus}
            className={`w-full text-left ${ROW_CLASS} justify-between data-[active=true]:bg-accent-primary/[0.08]`}
        >
            <div className="flex items-center gap-2.5 min-w-0">
                <div className={`${ICON_CHIP_CLASS} overflow-hidden p-1`}>
                    {provider.logo_url
                        ? <img src={provider.logo_url} alt={provider.name} className="w-full h-full object-contain" />
                        : <Building2 className={ICON_CLASS} />}
                </div>
                <span className="text-[11px] font-medium text-content-primary truncate">{provider.name}</span>
            </div>
            <ChevronRight className="w-3 h-3 text-content-tertiary flex-shrink-0 opacity-50 group-hover:opacity-100 group-hover:text-accent-primary transition" />
        </button>
    );
}

/** Two-line row whose subtitle is hidden by default and slides up from below
 *  on hover. The row's height is fixed by the icon chip (24 px) + padding,
 *  so revealing the subtitle never reflows neighbours. */
function RevealingRow({ name, subtitle, leftSlot, draggable, onDragStart, onDragPayload }: {
    name: string;
    subtitle: string;
    leftSlot: React.ReactNode;
    draggable: boolean;
    onDragStart?: () => void;
    onDragPayload?: DragPayload;
}) {
    return (
        <div
            draggable={draggable}
            onDragStart={draggable && onDragPayload ? e => startDrag(e, onDragPayload, onDragStart) : undefined}
            className={`${ROW_CLASS} ${draggable ? 'cursor-move' : ''}`}
        >
            {leftSlot}
            <div className="flex-1 min-w-0 relative">
                <div className="text-[11px] font-medium text-content-primary truncate leading-[14px] transition-transform duration-200 group-hover:-translate-y-1">
                    {name}
                </div>
                <div className="absolute left-0 right-0 top-full mt-0.5 text-[9px] text-content-tertiary uppercase tracking-wider truncate leading-[10px] opacity-0 -translate-y-1 group-hover:opacity-100 group-hover:-translate-y-[5px] transition-all duration-200">
                    {subtitle}
                </div>
            </div>
        </div>
    );
}

export interface NodeItemRowProps {
    nodeType: NodeTypeRecord;
    onDragStart?: () => void;
}

export function NodeItemRow({ nodeType, onDragStart }: NodeItemRowProps) {
    const IconComp = (Icons[nodeType.icon_reference as keyof typeof Icons] as React.ComponentType<{ className?: string }>) || Icons.Zap;
    return (
        <RevealingRow
            name={nodeType.display_name}
            subtitle="Dynamic node"
            draggable
            onDragStart={onDragStart}
            onDragPayload={{ type: 'ai_generator', node_type_id: nodeType.id, archetype_id: nodeType.archetype_id }}
            leftSlot={
                <div className={ICON_CHIP_CLASS}>
                    <IconComp className={ICON_CLASS} />
                </div>
            }
        />
    );
}

export interface ModelItemRowProps {
    model: AiModel;
    provider?: { name: string; logo_url: string | null } | null;
    onDragStart?: () => void;
}

export function ModelItemRow({ model, provider, onDragStart }: ModelItemRowProps) {
    return (
        <RevealingRow
            name={model.display_name}
            subtitle={model.replicate_model_id.split(':')[0]}
            draggable
            onDragStart={onDragStart}
            onDragPayload={{ type: 'ai_generator', node_type_id: model.node_type_id, model_id: model.id }}
            leftSlot={
                <div className={`${ICON_CHIP_CLASS} overflow-hidden p-1`}>
                    {provider?.logo_url
                        ? <img src={provider.logo_url} alt={provider.name} className="w-full h-full object-contain" />
                        : <Icons.Box className={ICON_CLASS} />}
                </div>
            }
        />
    );
}
