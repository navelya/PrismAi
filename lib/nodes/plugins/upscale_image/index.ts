import { NodeSharedDef } from '../../core/types';
import { UpscaleImageConfig } from '../../types';

export const upscaleImageSharedDef: NodeSharedDef<UpscaleImageConfig> = {
    type: 'upscale_image',
    family: 'generative',
    category: 'generative',
    creditCost: 1,
    meta: {
        label: 'Upscale Image',
        description: 'AI-powered image super-resolution (2x/4x)',
        color: '#ec4899',
        icon: 'Maximize2',
    },
    handles: {
        inputs: [{ id: 'images_in', label: 'Images', expectedType: ['image', 'image_array'], isMandatory: true }],
        outputs: [{ id: 'images_out', label: 'Images', dataType: 'image_array' }],
    },
    defaultConfig: {
        scale: 4,
    },
    aiSchema: {
        type: 'object',
        properties: {
            scale: { type: 'number', enum: [2, 3, 4, 8] }
        }
    }
};
