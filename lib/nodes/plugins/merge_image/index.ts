import { NodeSharedDef } from '../../core/types';
import { MergeImageConfig } from '../../types';

export const mergeImageSharedDef: NodeSharedDef<MergeImageConfig> = {
    type: 'merge_image',
    family: 'generative',
    category: 'generative',
    creditCost: 1,
    meta: {
        label: 'Merge Image',
        description: 'Composite overlay onto base image',
        color: '#14b8a6',
        icon: 'Layers',
    },
    handles: {
        inputs: [
            { id: 'base', label: 'BASE', expectedType: ['image', 'image_array'], isMandatory: true, color: '#22c55e' },
            { id: 'overlay', label: 'OVER', expectedType: ['image', 'image_array'], isMandatory: true, color: '#f59e0b' }
        ],
        outputs: [{ id: 'image_out', label: 'Merged', dataType: 'image_array' }],
    },
    defaultConfig: {
        position: 'bottom-right',
        overlayScale: 0.2,
        opacity: 1.0,
        padding: 10,
    },
    aiSchema: {
        type: 'object',
        properties: {
            position: { type: 'string', enum: ['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'top-center', 'bottom-center'] },
            overlayScale: { type: 'number' },
            opacity: { type: 'number' },
            padding: { type: 'number' }
        }
    }
};
