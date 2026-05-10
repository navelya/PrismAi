import { NodeSharedDef } from '../../core/types';

// BlurConfig is defined below — this plugin's config TS lives with the shared def.
export interface BlurConfig {
    radius: number;           // Blur radius in pixels (0-50)
    edgeMode?: 'clamp' | 'wrap' | 'mirror';  // Edge handling (future)
}

export const blurSharedDef: NodeSharedDef<BlurConfig> = {
    type: 'blur',
    family: 'utility',
    category: 'utility',
    meta: {
        label: 'Blur',
        description: 'Apply Gaussian blur to an image',
        color: '#3b82f6',
        icon: 'Droplets',
        ephemeral: true,
    },
    handles: {
        inputs: [
            { id: 'image', label: 'Image', expectedType: 'image' }
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
