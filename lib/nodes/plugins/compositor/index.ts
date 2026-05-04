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
        ephemeral: true,
    },
    handles: {
        inputs: [
            { id: 'layers', label: 'Layers', expectedType: ['image', 'text'], is_array: true, color: '#f8fafc' }
        ],
        outputs: [{ id: 'image_out', label: '', dataType: 'image' }],
    },
    defaultConfig: {
        canvasWidth: 1080,
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
            outputQuality: { type: 'number', minimum: 0, maximum: 1 },
            // 👑 הוספנו את השכבות כדי שה-AI יידע שהן קיימות ואיך לקנפג אותן!
            layers: {
                type: 'array',
                description: 'CRITICAL: Array of layers. You MUST generate one layer object for every image you connect to this compositor.',
                items: {
                    type: 'object',
                    required: ['id', 'name', 'sourceHandleId', 'transform'],
                    properties: {
                        id: { type: 'string', description: 'Unique layer ID, e.g., layer_0' },
                        name: { type: 'string', description: 'Layer name' },
                        sourceHandleId: { type: 'string', description: 'The exact ID of the targetHandle you will use in the edge array to connect to this layer. e.g., layer_0' },
                        selectedIndex: { type: 'number', default: 0 },
                        visible: { type: 'boolean', default: true },
                        locked: { type: 'boolean', default: false },
                        transform: {
                            type: 'object',
                            required: ['x', 'y', 'width', 'height'],
                            properties: {
                                x: { type: 'number', description: 'Left position' },
                                y: { type: 'number', description: 'Top position' },
                                width: { type: 'number', description: 'Rendered width' },
                                height: { type: 'number', description: 'Rendered height' },
                                rotation: { type: 'number', default: 0 },
                                opacity: { type: 'number', default: 1 },
                                flipX: { type: 'boolean', default: false },
                                flipY: { type: 'boolean', default: false }
                            }
                        }
                    }
                }
            }
        }
    }
};
