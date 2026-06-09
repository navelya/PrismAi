'use client';
import React from 'react';
import { motion } from 'framer-motion';
import * as Icons from 'lucide-react';
import { NodeTypeRecord, AiModel } from '@/lib/nodes/types';
import { NodeItemRow, ModelItemRow, ToolItemRow } from './node-library/rows';

export type FlyoutMode =
    | { kind: 'category'; categoryName: string; items: NodeTypeRecord[] }
    | { kind: 'tools'; items: { type: string; label: string; icon: string }[] }
    | { kind: 'provider'; providerName: string; items: AiModel[]; providers: { id: string; name: string; logo_url: string | null }[] };

export interface NodeLibraryFlyoutProps {
    mode: FlyoutMode;
    left: number;
    top: number;
    /** Caller-computed max height (typically the available space below the
     *  triggering row, clamped to FLYOUT_MAX_HEIGHT). */
    maxHeight: number;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onDragStartClose: () => void;
    /** Click-to-add: drops the item at the viewport center and closes. */
    onAdd: (payload: Record<string, unknown>) => void;
}

export const FLYOUT_MAX_HEIGHT = 320;

export default function NodeLibraryFlyout({ mode, left, top, maxHeight, onMouseEnter, onMouseLeave, onDragStartClose, onAdd }: NodeLibraryFlyoutProps) {
    const isEmpty = mode.items.length === 0;

    return (
        <motion.div
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -6 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            onMouseEnter={onMouseEnter}
            onMouseLeave={onMouseLeave}
            style={{ left, top, maxHeight, width: 260, transformOrigin: 'left center' }}
            className="fixed z-[55] pointer-events-auto bg-surface-elevated/80 backdrop-blur-md border border-stroke-subtle rounded-2xl shadow-2xl flex flex-col overflow-hidden"
        >
            <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
                {isEmpty ? (
                    <div className="flex flex-col items-center justify-center py-8 text-content-tertiary">
                        <Icons.Inbox className="w-6 h-6 mb-1.5 opacity-20" />
                        <span className="text-[11px]">No items found</span>
                    </div>
                ) : mode.kind === 'category' ? (
                    mode.items.map(nt => (
                        <NodeItemRow key={nt.id} nodeType={nt} onDragStart={onDragStartClose} onAdd={onAdd} />
                    ))
                ) : mode.kind === 'tools' ? (
                    mode.items.map(t => (
                        <ToolItemRow key={t.type} tool={t} onDragStart={onDragStartClose} onAdd={onAdd} />
                    ))
                ) : (
                    mode.items.map(model => {
                        const provider = mode.providers.find(p => p.id === String(model.provider_id));
                        return <ModelItemRow key={model.id} model={model} provider={provider} onDragStart={onDragStartClose} onAdd={onAdd} />;
                    })
                )}
            </div>
        </motion.div>
    );
}
