'use client';

import React, { memo } from 'react';
import CompositorNode from '@/components/canvas/CompositorNode';
import { NodeClientDef } from '../../core/types';
import { compositorSharedDef } from './index';

export const compositorClientDef: NodeClientDef = {
    ...compositorSharedDef,
    component: memo((props: any) => <CompositorNode {...props} type="compositor" />),
};
