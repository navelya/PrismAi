'use client';

import React, { memo } from 'react';
import CustomNode from '@/components/canvas/CustomNode';
import { NodeClientDef } from '../../core/types';
import { filterSortSharedDef } from './index';
import Properties from './Properties';

export const filterSortClientDef: NodeClientDef = {
    ...filterSortSharedDef,
    component: memo((props: any) => <CustomNode {...props} type="filter_sort" />),
    propertyPanel: Properties,
};
