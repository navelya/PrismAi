'use client';

import React, { memo } from 'react';
import CustomNode from '@/components/canvas/CustomNode';
import { NodeClientDef } from '../../core/types';
import { removeBackgroundSharedDef } from './index';
import Properties from './Properties';

export const removeBackgroundClientDef: NodeClientDef = {
    ...removeBackgroundSharedDef,
    component: memo((props: any) => <CustomNode {...props} type="remove_background" />),
    propertyPanel: Properties,
};
