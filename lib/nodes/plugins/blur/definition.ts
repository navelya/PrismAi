import { NodeSharedDef } from '../../core/types';

// BlurConfig is defined below — this plugin's config TS lives with the shared def.
export type BlurType = 'gaussian' | 'box' | 'stack';

export interface BlurConfig {
    radius: number;                          // Slider 0-100; effective sigma is radius/2 (see shared.ts)
    type?: BlurType;                         // Blur flavor: gaussian (default) / box / stack
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
        type: 'gaussian',
    },
    aiSchema: {
        type: 'object',
        properties: {
            radius: {
                type: 'number',
                description:
                    'Blur intensity from 0 (no blur) to 100 (maximum). ' +
                    'Use ~10–20 for a subtle blur, ~40–60 for moderate, ~80–100 for heavy. ' +
                    'Works on both image and video inputs.',
                minimum: 0,
                maximum: 100,
                default: 5,
            },
            type: {
                type: 'string',
                enum: ['gaussian', 'box', 'stack'],
                description:
                    'Blur flavor. "gaussian" (default) is a clean soft blur. ' +
                    '"box" adds slight contrast + saturation boost on top of the blur. ' +
                    '"stack" gives a softer, slightly desaturated look.',
                default: 'gaussian',
            },
        },
    },
};
