'use client';

import React from 'react';
import { X } from 'lucide-react';
import { NodeConfig } from '@/lib/nodes/types';
import { clientRegistry } from '@/lib/nodes/core/client-registry';

interface PropertyPanelProps {
    nodeId: string;
    nodeType: string;
    config: NodeConfig;
    onUpdate: (config: NodeConfig) => void;
    onClose: () => void;
}

export default function PropertyPanel({ nodeId, nodeType, config, onUpdate, onClose }: PropertyPanelProps) {
    const PropertyComponent = clientRegistry[nodeType]?.propertyPanel;

    return (
        <div className="w-80 bg-surface-primary border-l border-stroke-subtle p-4 space-y-4 overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-stroke-subtle">
                <h3 className="font-semibold text-content-primary">Properties</h3>
                <button
                    onClick={onClose}
                    className="p-1 hover:bg-surface-secondary rounded transition-colors"
                >
                    <X className="w-5 h-5 text-content-secondary" />
                </button>
            </div>

            {/* Node Info */}
            <div className="bg-surface-secondary rounded-lg p-3">
                <div className="text-xs text-content-tertiary uppercase tracking-wide">Node ID</div>
                <div className="text-sm font-mono text-content-primary mt-1">{nodeId.substring(0, 8)}...</div>
            </div>

            {/* Form Fields or Placeholder */}
            <div className="space-y-4">
                {PropertyComponent ? (
                    <PropertyComponent config={config} onUpdate={onUpdate} />
                ) : (
                    <div className="flex flex-col items-center justify-center py-8 text-center border-2 border-dashed border-stroke-subtle rounded-xl bg-surface-primary/50">
                        <p className="text-sm text-content-secondary">No properties available for this node.</p>
                    </div>
                )}
            </div>
        </div>
    );
}
