import { NodeSharedDef } from '../../core/types';

// ExtractFrameConfig lives with the shared def (same convention as blur).
export interface ExtractFrameConfig {
    frameTime: number; // Timestamp in seconds of the frame to grab. 0 = first frame.
}

export const extractFrameSharedDef: NodeSharedDef<ExtractFrameConfig> = {
    type: 'extract_frame',
    family: 'utility',
    category: 'utility',
    meta: {
        label: 'Extract Frame',
        description: 'Grab a single still frame from a video at a chosen timestamp',
        color: '#f59e0b',
        icon: 'Camera',
        ephemeral: true,
    },
    handles: {
        inputs: [
            // Polymorphic media input, mirroring blur: accepts a static video
            // URL, a live compositor/filter graph (envelope type 'video'), or an
            // image (in which case frame extraction is the identity). The
            // component narrows the visible label/color to the flowing kind.
            { id: 'image', label: 'Video', expectedType: ['image', 'video'] },
        ],
        // Output is ALWAYS a single still image — extracting a frame collapses a
        // video down to one raster. No dynamic narrowing needed (unlike blur /
        // compositor whose output kind tracks their input).
        outputs: [
            { id: 'image_out', label: 'Frame', dataType: 'image' },
        ],
    },
    defaultConfig: {
        frameTime: 0,
    },
    aiSchema: {
        type: 'object',
        properties: {
            frameTime: {
                type: 'number',
                description:
                    'Timestamp in SECONDS of the frame to grab from the video. ' +
                    '0 = the first/opening frame. e.g. 2.5 grabs the frame at 2.5 seconds in. ' +
                    'Pick a value partway through (e.g. half the clip length) for a representative ' +
                    'thumbnail. The value is clamped to the actual video length at run time.',
                minimum: 0,
                default: 0,
            },
        },
    },
};
