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
        description: 'Apply Gaussian blur to an image or video',
        color: '#3b82f6',
        icon: 'Droplets',
        ephemeral: true,
    },
    handles: {
        inputs: [
            // Polymorphic input: accepts either image or video. The component
            // narrows the visible label/color to match what's actually flowing.
            { id: 'image', label: 'Media', expectedType: ['image', 'video'] }
        ],
        // Single polymorphic output. The id stays `image_out` so saved workflows
        // (which only ever had `image_out` historically) keep their downstream
        // edges. The dataType is the union of types this node may emit —
        // typesAreCompatible() resolves it against the consumer's expectedType.
        // The component narrows the visible label/color based on input kind.
        outputs: [
            { id: 'image_out', label: 'Media', dataType: ['image', 'video'] },
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
                description: 'Blur radius in pixels (0-50). Works on both image and video inputs.',
                minimum: 0,
                maximum: 50,
                default: 5
            }
        }
    }
};
