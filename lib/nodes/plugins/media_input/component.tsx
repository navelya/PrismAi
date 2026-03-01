'use client';

import React, { memo } from 'react';
import MediaInputNode from '@/components/canvas/MediaInputNode';
import { NodeClientDef } from '../../core/types';
import { mediaInputSharedDef } from './index';

export const mediaInputClientDef: NodeClientDef = {
    ...mediaInputSharedDef,
    component: memo((props: any) => <MediaInputNode {...props} type="media_input" />),
};
