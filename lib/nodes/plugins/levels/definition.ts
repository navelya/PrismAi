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
        description: 'Adjust black point, white point, and gamma to remap an image’s tonal range',
        color: '#a855f7',
        icon: 'SlidersHorizontal',
        ephemeral: true,
    },
    handles: {
        inputs: [
            { id: 'image', label: 'Image', expectedType: 'image' },
        ],
        outputs: [
            { id: 'image_out', label: '', dataType: 'image' },
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
                    'Input black point (0-255). Pixel values at or below this become pure black. Raise to crush shadows / deepen blacks.',
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
