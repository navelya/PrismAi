import { NodeSharedDef } from '../../core/types';

export interface LevelsConfig {
    black_point: number; // Input black point, 0-255
    white_point: number; // Input white point, 0-255
    gamma: number;       // Midtone gamma, 0.1-3.0 (>1 brightens midtones, Photoshop-style)
}

export const levelsSharedDef: NodeSharedDef<LevelsConfig> = {
    type: 'levels',
    family: 'utility',
    category: 'utility',
    meta: {
        label: 'Levels',
        description: 'Adjust black point, white point, and gamma to remap an image or video’s tonal range',
        color: '#a855f7',
        icon: 'SlidersHorizontal',
        ephemeral: true,
    },
    handles: {
        // Polymorphic input: accepts either image or video. The component
        // narrows the visible label/color to match what's actually flowing.
        inputs: [
            { id: 'image', label: 'Media', expectedType: ['image', 'video'] },
        ],
        // Single polymorphic output. The id stays `image_out` so saved
        // workflows (which only ever had `image_out`) keep their downstream
        // edges. dataType is the union this node may emit; the component
        // narrows the visible label/color based on the input kind, and
        // resolveLevelsOutputKind (handle-compatibility.ts) narrows it for
        // wire-drop validation.
        outputs: [
            { id: 'image_out', label: 'Media', dataType: ['image', 'video'] },
        ],
    },
    defaultConfig: {
        black_point: 0,
        white_point: 255,
        gamma: 1.0,
    },
    aiSchema: {
        type: 'object',
        properties: {
            black_point: {
                type: 'number',
                description:
                    'Input black point (0-255). Pixel values at or below this become pure black. Raise to crush shadows / deepen blacks. Works on both image and video inputs.',
                minimum: 0,
                maximum: 255,
                default: 0,
            },
            white_point: {
                type: 'number',
                description:
                    'Input white point (0-255). Pixel values at or above this become pure white. Lower to blow out highlights / brighten whites.',
                minimum: 0,
                maximum: 255,
                default: 255,
            },
            gamma: {
                type: 'number',
                description:
                    'Midtone gamma. 1.0 = no change. >1 brightens midtones (e.g. 1.5 lifts shadows). <1 darkens midtones (e.g. 0.5 deepens contrast). Photoshop-style convention.',
                minimum: 0.1,
                maximum: 3.0,
                default: 1.0,
            },
        },
    },
};
