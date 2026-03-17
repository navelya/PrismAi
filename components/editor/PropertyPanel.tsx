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
    const isAiNode = nodeType === 'ai_generator' || nodeType === 'ai_generate_image';

    return (
        <div className="w-80 bg-surface-elevated/80 backdrop-blur-md border border-stroke-subtle rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-[calc(100vh-80px)] h-fit">
            {/* Header */}
            <div className="flex items-center justify-between p-4 bg-white/5 border-b border-stroke-subtle">
                <div className="flex items-center gap-2">
                    <div className="w-1 h-3 bg-accent-primary rounded-full" />
                    <h3 className="font-bold text-sm text-content-primary">
                        {isAiNode ? 'AI Generation' : 'Node Properties'}
                    </h3>
                </div>
                <button
                    onClick={onClose}
                    className="p-1.5 hover:bg-white/10 rounded-lg transition-colors group"
                >
                    <X className="w-4 h-4 text-content-tertiary group-hover:text-content-primary" />
                </button>
            </div>

            <div className="p-4 space-y-4 overflow-y-auto custom-scrollbar flex-1 relative">
                {/* Node Info - Minimalist Card */}
                {!isAiNode && (
                    <div className="bg-white/5 border border-stroke-subtle rounded-xl p-3">
                        <div className="text-[10px] font-bold text-content-tertiary uppercase tracking-widest">Selected ID</div>
                        <div className="text-xs font-mono text-content-secondary mt-1 opacity-70">{nodeId}</div>
                    </div>
                )}

                {/* Form Fields */}
                <div className="pb-2">
                    {PropertyComponent ? (
                        <PropertyComponent config={config} onUpdate={onUpdate} nodeId={nodeId} />
                    ) : (
                        <div className="flex flex-col items-center justify-center py-10 text-center border border-dashed border-stroke-subtle rounded-xl bg-white/5">
                            <p className="text-xs text-content-tertiary font-medium">No properties available</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
