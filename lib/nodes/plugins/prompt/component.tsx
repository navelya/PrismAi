'use client';

import React, { memo } from 'react';
import { NodeProps } from 'reactflow';
import * as Icons from 'lucide-react';
import { promptSharedDef } from './index';
import { NodeClientDef } from '../../core/types';
import PromptNode from '@/components/canvas/PromptNode';

interface PromptNodeData {
    label: string;
    config: {
        text: string;
    };
}

export const promptClientDef: NodeClientDef = {
    ...promptSharedDef,
    component: memo((props: any) => <PromptNode {...props} type="prompt" />),
};
