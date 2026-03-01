'use client';

import React, { memo } from 'react';
import CustomNode from '@/components/canvas/CustomNode';
import { NodeClientDef } from '../../core/types';
import { scrapeImagesSharedDef } from './index';
import Properties from './Properties';

// We map directly to the CustomNode component from the canvas
export const scrapeImagesClientDef: NodeClientDef = {
    ...scrapeImagesSharedDef,
    component: memo((props: any) => <CustomNode {...props} type="scrape_images" />),
    propertyPanel: Properties,
};
