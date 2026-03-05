'use client';

import React, { memo } from 'react';
import FilterSortNode from '@/components/canvas/FilterSortNode';
import { NodeClientDef } from '../../core/types';
import { filterSortSharedDef } from './index';
import Properties from './Properties';

export const filterSortClientDef: NodeClientDef = {
    ...filterSortSharedDef,
    component: memo((props: any) => <FilterSortNode {...props} type="filter_sort" />),
    propertyPanel: Properties,
};
