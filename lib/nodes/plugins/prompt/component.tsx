'use client';

import React, { memo } from 'react';
import { NodeProps } from 'reactflow';
import * as Icons from 'lucide-react';
import { promptSharedDef } from './index';
import { NodeClientDef } from '../../core/types';

interface PromptNodeData {
    label: string;
    config: {
        text: string;
    };
}

/**
 * Properties panel component for Prompt node
 * This is displayed in the Sidebar when the node is selected
 */
function PromptProperties({ data }: NodeProps<PromptNodeData>) {
    // This component is currently used for the properties implementation plan
    // If the main PropertyPanel uses dynamic injection, it will render this.
    return (
        <div className="space-y-4">
            <div>
                <label className="text-xs font-medium text-content-tertiary uppercase tracking-wider">
                    Prompt Text
                </label>
                <div className="mt-1.5 p-3 rounded-lg bg-surface-primary border border-stroke-subtle">
                    <p className="text-sm text-content-secondary italic">
                        {data.config?.text || 'No prompt entered'}
                    </p>
                </div>
            </div>

            <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/10">
                <p className="text-[10px] text-blue-500 leading-relaxed uppercase font-bold tracking-tight">
                    Tip: This prompt can be connected to Scrape Images or AI Generate nodes.
                </p>
            </div>
        </div>
    );
}

export const promptClientDef: NodeClientDef = {
    ...promptSharedDef,
    component: undefined as any, // The canvas component is registered separately in EditorCanvas
    propertyPanel: memo(PromptProperties),
};
