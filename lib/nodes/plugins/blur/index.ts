import { NodeSharedDef } from '../../core/types';
import { BlurConfig } from './types';

export const blurSharedDef: NodeSharedDef<BlurConfig> = {
    type: 'blur',
    family: 'transform',
    category: 'image-processing',
    meta: {
        label: 'Blur',
        description: 'Apply Gaussian blur to an image',
        color: '#3b82f6',
        icon: 'Droplets',
        ephemeral: true,
    },
    handles: {
        inputs: [
            { id: 'image', label: 'Image', dataType: 'image' }
        ],
        outputs: [
            { id: 'image_out', label: '', dataType: 'image' }
        ],
    },
    defaultConfig: {
        radius: 5,
    },
    aiSchema: {
        type: 'object',
        properties: {
            radius: {
                type: 'number',
                description: 'Blur radius in pixels (0-50)',
                minimum: 0,
                maximum: 50,
                default: 5
            }
        }
    }
};

export * from './types';
