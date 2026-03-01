'use client';

import React, { memo } from 'react';
import CustomNode from '@/components/canvas/CustomNode';
import { NodeClientDef } from '../../core/types';
import { mergeImageSharedDef } from './index';

export const mergeImageClientDef: NodeClientDef = {
    ...mergeImageSharedDef,
    component: memo((props: any) => <CustomNode {...props} type="merge_image" />),
};
