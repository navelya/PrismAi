import { NodeSharedDef } from '../../core/types';
import { MediaInputConfig } from '../../types';

export const mediaInputSharedDef: NodeSharedDef<MediaInputConfig> = {
    type: 'media_input',
    family: 'input',
    category: 'input',
    meta: {
        label: 'Media Input',
        description: 'Upload images manually',
        color: '#3b82f6',
        icon: 'ImagePlus',
    },
    handles: {
        inputs: [],
        outputs: [{ id: 'images_out', label: 'Images', dataType: 'image_array' }],
    },
    defaultConfig: {
        images: [],
    },
    aiSchema: {
        type: 'object',
        properties: {
            images: { type: 'array', items: { type: 'string' }, description: 'Array of base64 image strings' }
        }
    }
};
