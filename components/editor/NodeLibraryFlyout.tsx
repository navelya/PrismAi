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
    left: number;
    top: number;
    height: number;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onDragStartClose: () => void;
}

export default function NodeLibraryFlyout({ mode, left, top, height, onMouseEnter, onMouseLeave, onDragStartClose }: NodeLibraryFlyoutProps) {
    const title = mode.kind === 'category' ? mode.categoryName : mode.providerName;
    const isEmpty = mode.items.length === 0;

    return (
        <div
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            className="fixed z-[55] pointer-events-auto bg-surface-elevated/80 backdrop-blur-md border border-stroke-subtle rounded-2xl shadow-2xl flex flex-col overflow-hidden"
            style={{ left, top, height, width: 260 }}
        >
            <div className="px-3 py-2 border-b border-stroke-subtle/60">
                <h4 className="text-[12px] font-semibold text-content-primary truncate">{title}</h4>
            </div>

            <div className="flex-1 overflow-y-auto p-2.5 space-y-1.5">
                {isEmpty ? (
                    <div className="flex flex-col items-center justify-center py-10 text-content-tertiary">
                        <Icons.Inbox className="w-7 h-7 mb-2 opacity-20" />
                        <span className="text-[11px]">No items found</span>
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
