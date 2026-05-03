'use client';

import React, { memo } from 'react';
import BlurNode from '@/components/canvas/BlurNode';
import { NodeClientDef } from '../../core/types';
import { blurSharedDef } from './index';
import { blurClientExecutor } from './client-blur';

export const blurClientDef: NodeClientDef = {
    ...blurSharedDef,
    component: memo((props: any) => <BlurNode {...props} type="blur" />),
    // Live blur: useNodeAutoCompute picks this up and recomputes the blurred
    // image client-side whenever this node's config or its upstream value
    // changes, writing the result into nodeOutputs so downstream nodes
    // (e.g. Compositor) re-render automatically.
    clientExecutor: blurClientExecutor,
};
