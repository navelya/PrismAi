'use client';

import React, { memo } from 'react';
import CompositorNode from '@/components/canvas/CompositorNode';
import { NodeClientDef } from '../../core/types';
import { compositorSharedDef } from './index';
import { compositorClientExecutor } from './client-compositor';

export const compositorClientDef: NodeClientDef = {
    ...compositorSharedDef,
    component: memo((props: any) => <CompositorNode {...props} type="compositor" />),
    // Live compositor: useNodeAutoCompute runs this whenever the layer
    // config or any upstream input changes, writing the composited image
    // into nodeOutputs so downstream nodes (Blur, AI Generator, etc.) see
    // the result through the same path they use for every other node.
    clientExecutor: compositorClientExecutor,
};
