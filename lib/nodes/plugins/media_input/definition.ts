import { NodeSharedDef } from '../../core/types';

/**
 * Media Input Node Configuration
 * Stores manually uploaded media (image / video / audio) as storage objects
 * (or legacy base64 data URLs).
 */
export interface MediaInputConfig {
    /** Array of base64 data URLs (legacy) or storage objects for uploaded media */
    images: Array<{ url: string; path: string } | string>;
}

export const mediaInputSharedDef: NodeSharedDef<MediaInputConfig> = {
    type: 'media_input',
    family: 'input',
    category: 'input',
    meta: {
        label: 'Media Input',
        description: 'Upload images, video, or audio manually',
        color: '#3b82f6',
        icon: 'ImagePlus',
    },
    handles: {
        inputs: [],
        // image_array folds to the `image` base for type-compat (still feeds any
        // image/video consumer); `audio` is declared so audio uploads can wire
        // into audio-consuming nodes too.
        outputs: [{ id: 'images_out', label: 'Media', dataType: ['image_array', 'audio'] }],
    },
    defaultConfig: {
        images: [],
    },
    aiSchema: {
        type: 'object',
        properties: {
            images: { type: 'array', items: { type: 'string' }, description: 'Array of media URLs (image, video, or audio)' }
        }
    }
};
