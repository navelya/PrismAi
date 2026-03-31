'use client';

import React, { memo } from 'react';
import BlurNode from '@/components/canvas/BlurNode';
import { NodeClientDef } from '../../core/types';
import { blurSharedDef } from './index';

export const blurClientDef: NodeClientDef = {
    ...blurSharedDef,
    component: memo((props: any) => <BlurNode {...props} type="blur" />),
};
