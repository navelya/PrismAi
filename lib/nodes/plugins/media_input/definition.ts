import { NodeSharedDef } from '../../core/types';

/**
 * Media Input Node Configuration
 * Stores manually uploaded images as base64 data URLs or storage objects.
 * Images-only — videos and other media types are not accepted.
 */
export interface MediaInputConfig {
    /** Array of base64 data URLs (legacy) or storage objects for uploaded images */
    images: Array<{ url: string; path: string } | string>;
}

export const mediaInputSharedDef: NodeSharedDef<MediaInputConfig> = {
    type: 'media_input',
    family: 'input',
    category: 'input',
    meta: {
        label: 'Media Input',
        description: 'Upload images manually (images only)',
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
