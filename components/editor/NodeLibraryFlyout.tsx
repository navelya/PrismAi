'use client';
import React from 'react';
import * as Icons from 'lucide-react';
import { NodeTypeRecord, AiModel } from '@/lib/nodes/types';
import { NodeItemRow, ModelItemRow } from './node-library/rows';

export type FlyoutMode =
    | { kind: 'category'; categoryName: string; items: NodeTypeRecord[] }
    | { kind: 'provider'; providerName: string; items: AiModel[]; providers: { id: string; name: string; logo_url: string | null }[] };

export interface NodeLibraryFlyoutProps {
    mode: FlyoutMode;
    /** Viewport-relative left offset of the flyout in px. */
    left: number;
    /** Viewport-relative top offset in px, already clamped by the parent. */
    top: number;
    /** Height of the flyout in px. */
    height: number;
    /** Called when the cursor enters the flyout — cancels the parent's pending close. */
    onMouseEnter: () => void;
    /** Called when the cursor leaves the flyout — schedules a close in the parent. */
    onMouseLeave: () => void;
    /** Called from row drag-start to dismiss the entire panel stack. */
    onDragStartClose: () => void;
}

export default function NodeLibraryFlyout({ mode, left, top, height, onMouseEnter, onMouseLeave, onDragStartClose }: NodeLibraryFlyoutProps) {
    const isCategory = mode.kind === 'category';
    const eyebrow = isCategory ? 'Nodes' : `Models from ${mode.providerName}`;
    const title = isCategory ? mode.categoryName : mode.providerName;
    const isEmpty = mode.items.length === 0;

    return (
        <div
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            className="fixed z-[55] pointer-events-auto bg-surface-elevated/80 backdrop-blur-md border border-stroke-subtle rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            style={{ left, top, height, width: 280 }}
        >
            <div className="px-3 pt-3 pb-2 border-b border-stroke-subtle/60">
                <p className="text-[10px] font-bold uppercase tracking-widest text-content-tertiary">{eyebrow}</p>
                <h4 className="text-sm font-bold text-content-primary truncate">{title}</h4>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {isEmpty ? (
                    <div className="flex flex-col items-center justify-center py-12 text-content-tertiary">
                        <Icons.Inbox className="w-8 h-8 mb-2 opacity-20" />
                        <span className="text-xs">No items found</span>
                    </div>
                ) : mode.kind === 'category' ? (
                    mode.items.map(nt => (
                        <NodeItemRow key={nt.id} nodeType={nt} onDragStart={onDragStartClose} />
                    ))
                ) : (
                    mode.items.map(model => {
                        const provider = mode.providers.find(p => p.id === String(model.provider_id));
                        return <ModelItemRow key={model.id} model={model} provider={provider} onDragStart={onDragStartClose} />;
                    })
                )}
            </div>
        </div>
    );
}
