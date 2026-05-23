'use client';

import React, { memo } from 'react';
import { NodeProps } from 'reactflow';
import { cn } from '@/lib/utils';
import BaseNode from '@/lib/nodes/core/canvas/BaseNode';
import { UserCircle } from 'lucide-react';
import BlurryImage from '@/components/ui/BlurryImage';
import { CharacterConfig } from './definition';

interface CharacterNodeData {
    label: string;
    config: CharacterConfig;
}

function CharacterNode({ data, id, selected }: NodeProps<CharacterNodeData>) {
    const config = data.config || ({} as CharacterConfig);
    const images = Array.isArray(config.referenceImages) ? config.referenceImages : [];
    const primary = images[0];

    return (
        <BaseNode
            id={id}
            type="character"
            label={data.label}
            selected={selected}
            nodeData={data}
            isNew={(data as any).isNew}
            renderInputs={false}
            hideStatus={true}
            width=""
            style={{ width: 'max-content', minWidth: 240, maxWidth: 300 }}
        >
            <div className="flex flex-col gap-2">
                <div className="relative w-full aspect-square rounded-xl overflow-hidden bg-white/5 border border-white/10">
                    {primary ? (
                        <BlurryImage src={primary} alt={config.name || 'Character'} className="w-full h-full object-cover max-w-none max-h-none" />
                    ) : (
                        <div className="absolute inset-0 flex items-center justify-center text-content-tertiary">
                            <UserCircle className="w-10 h-10" />
                        </div>
                    )}
                    {images.length > 1 && (
                        <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded-md bg-black/60 text-white text-[10px] font-medium">
                            +{images.length - 1}
                        </span>
                    )}
                </div>
                <div className="px-1">
                    <p className="text-sm font-semibold text-content-primary truncate">{config.name || 'Character'}</p>
                    {config.description && (
                        <p className={cn('text-xs text-content-tertiary line-clamp-2')}>{config.description}</p>
                    )}
                </div>
            </div>
        </BaseNode>
    );
}

export default memo(CharacterNode);

import { NodeClientDef } from '../../core/types';
import { characterSharedDef } from './definition';

export const characterClientDef: NodeClientDef = {
    ...characterSharedDef,
    component: memo((props: any) => <CharacterNode {...props} type="character" />),
};
