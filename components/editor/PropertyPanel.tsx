'use client';

import React from 'react';
import * as Icons from 'lucide-react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { clientRegistry } from '@/lib/nodes/core/client-registry';

interface PropertyPanelProps {
    nodeId: string;
    nodeType: string;
    config: Record<string, any>;
    label: string;
    icon?: string;
    onUpdate: (config: Record<string, any>) => void;
    onClose: () => void;
}

export default function PropertyPanel({
    nodeId,
    nodeType,
    config,
    label,
    icon,
    onUpdate,
    onClose,
}: PropertyPanelProps) {
    const aiNodeTypeId = config && 'node_type_id' in config ? config.node_type_id : undefined;
    const PropertyComponent = clientRegistry[nodeType]?.propertyPanel || (
        (nodeType === 'ai_generator' || aiNodeTypeId) ? clientRegistry.ai_generator.propertyPanel : null
    );
    const isAiNode = nodeType === 'ai_generator' || !!aiNodeTypeId;

    const IconComponent = (Icons[icon as keyof typeof Icons] as React.ComponentType<{ className?: string }>) || Icons.Box;

    return (
        <div className="w-80 bg-surface-elevated/80 backdrop-blur-md border border-stroke-subtle rounded-2xl shadow-2xl flex flex-col overflow-hidden max-h-full h-fit select-none">
            {/* Compact header — matches AssetsPanel */}
            <div className="flex items-center justify-between gap-2 px-2 py-2 border-b border-stroke-subtle/60 shrink-0">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                    <div className="w-6 h-6 rounded-md flex items-center justify-center shrink-0 bg-accent-primary/10 border border-accent-primary/20">
                        <IconComponent className="w-3.5 h-3.5 text-accent-primary" />
                    </div>

                    <h3 className="text-[11px] font-bold text-content-primary tracking-wide truncate px-1.5 py-0.5 flex-1 min-w-0">
                        {label}
                    </h3>
                </div>

                <button
                    onClick={onClose}
                    className="p-1 hover:bg-white/10 rounded-md transition-colors group shrink-0"
                    title="Close"
                >
                    <X className="w-3.5 h-3.5 text-content-tertiary group-hover:text-content-primary" />
                </button>
            </div>

            <div className={cn(
                "flex-1 relative flex flex-col min-h-0",
                !isAiNode && "overflow-y-auto custom-scrollbar p-4 space-y-4"
            )}>
                {!isAiNode && (
                    <div className="bg-white/5 border border-stroke-subtle rounded-xl p-3">
                        <div className="text-[10px] font-bold text-content-tertiary uppercase tracking-widest">Selected ID</div>
                        <div className="text-xs font-mono text-content-secondary mt-1 opacity-70">{nodeId}</div>
                    </div>
                )}

                <div className={cn("flex-1", isAiNode && "flex flex-col min-h-0")}>
                    {PropertyComponent ? (
                        <PropertyComponent config={config} onUpdate={onUpdate} nodeId={nodeId} />
                    ) : (
                        <div className={cn(!isAiNode && "flex flex-col items-center justify-center py-10 text-center border border-dashed border-stroke-subtle rounded-xl bg-white/5")}>
                            <p className="text-xs text-content-tertiary font-medium">No properties available</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
