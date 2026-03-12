'use client';

import React, { memo } from 'react';
import BaseNode from './BaseNode';
import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

const LegacyNode = ({ id, data, selected, type }: any) => {
    return (
        <BaseNode
            id={id}
            type={type}
            label={data?.label || 'Legacy Node'}
            selected={selected}
            className="border-accent-warning/40 bg-surface-primary/60 backdrop-blur-md"
        >
            <div className="flex flex-col items-center justify-center py-5 px-3 text-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-accent-warning/10 flex items-center justify-center border border-accent-warning/20 shadow-inner">
                    <AlertTriangle className="w-7 h-7 text-accent-warning" />
                </div>
                <div className="space-y-1.5">
                    <p className="text-[13px] font-bold text-content-primary">Deprecated Node Type</p>
                    <p className="inline-block px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[9px] text-content-tertiary uppercase tracking-wider font-mono">
                        {data?.__originalType || type}
                    </p>
                </div>
                <p className="text-[11px] text-content-secondary leading-snug max-w-[200px] opacity-80">
                    This node is no longer supported in the current version. Connections are preserved, but settings are unavailable.
                </p>
            </div>
        </BaseNode>
    );
};


export default memo(LegacyNode);
