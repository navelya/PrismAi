'use client';

import React, { memo } from 'react';
import CustomNode from '@/components/canvas/CustomNode';
import { NodeClientDef } from '../../core/types';
import { aiGenerateImageSharedDef } from './index';
import Properties from './Properties';

export const aiGenerateImageClientDef: NodeClientDef = {
    ...aiGenerateImageSharedDef,
    component: memo((props: any) => <CustomNode {...props} type="ai_generate_image" />),
    propertyPanel: Properties,
};
