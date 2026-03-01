'use client';

import React, { memo } from 'react';
import CustomNode from '@/components/canvas/CustomNode';
import { NodeClientDef } from '../../core/types';
import { upscaleImageSharedDef } from './index';
import Properties from './Properties';

export const upscaleImageClientDef: NodeClientDef = {
    ...upscaleImageSharedDef,
    component: memo((props: any) => <CustomNode {...props} type="upscale_image" />),
    propertyPanel: Properties,
};
