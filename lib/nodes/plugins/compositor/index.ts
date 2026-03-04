import { NodeSharedDef } from '../../core/types';
import { CompositorConfig } from '../../types';

export const compositorSharedDef: NodeSharedDef<CompositorConfig> = {
    type: 'compositor',
    family: 'output',
    category: 'utility',
    meta: {
        label: 'Compositor',
        description: 'Layer-based image compositing',
        color: '#8b5cf6',
        icon: 'Layers2',
        dynamicInputs: true,
    },
    handles: {
        // Inputs are dynamic based on layers, but we define an empty list here
        // as the actual Handles are rendered by CompositorNode dynamically.
        inputs: [],
        outputs: [{ id: 'image_out', label: '', dataType: 'image' }],
    },
    defaultConfig: {
        canvasWidth: 1920,
        canvasHeight: 1080,
        backgroundColor: '#00000000',
        layers: [],
        outputFormat: 'png',
        outputQuality: 1.0,
    },
    aiSchema: {
        type: 'object',
        properties: {
            canvasWidth: { type: 'number', description: 'Width of the canvas in pixels' },
            canvasHeight: { type: 'number', description: 'Height of the canvas in pixels' },
            backgroundColor: { type: 'string', description: 'Hex color code with alpha (e.g., #00000000)' },
            outputFormat: { type: 'string', enum: ['png', 'webp', 'jpeg'] },
            outputQuality: { type: 'number', minimum: 0, maximum: 1 }
        }
    }
};
