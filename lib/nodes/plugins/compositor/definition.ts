import { NodeSharedDef } from '../../core/types';

/**
 * Layer transformation data for Compositor
 */
export interface LayerTransform {
    x: number;              // Left position (pixels)
    y: number;              // Top position (pixels)
    width: number;          // Rendered width (pixels)
    height: number;         // Rendered height (pixels)
    rotation: number;       // Degrees (0-360)
    opacity: number;        // 0.0 - 1.0
    flipX: boolean;         // Horizontal flip
    flipY: boolean;         // Vertical flip
    isAutoCentered?: boolean; // Flag to prevent infinite re-centering loops
    blendMode?: string;     // Konva GlobalCompositeOperation (e.g. 'multiply', 'screen')

    // Typography (Optional - for text layers)
    fontFamily?: string;
    fontWeight?: string;
    fontStyle?: string;
    fontSize?: number;
    lineHeight?: number;
    letterSpacing?: number;
    textAlign?: 'left' | 'center' | 'right' | 'justify';
    fillColor?: string;

    crop: {                 // Source Crop Box
        x: number;
        y: number;
        width: number;
        height: number;
    } | null;
}

/**
 * Single layer definition within the Compositor
 */
export interface CompositorLayer {
    id: string;                 // Unique layer ID (e.g., "layer_0")
    name: string;               // User-editable name (e.g., "Background")
    sourceHandleId: string;     // React Flow handle ID this layer is connected to
    selectedIndex: number;      // Which image from source array (default: 0)
    transform: LayerTransform;  // Position/scale/rotation data
    visible: boolean;           // Toggle visibility
    locked: boolean;            // Prevent edits
}

/**
 * Compositor Cube Configuration
 * Client-side image compositing with full layer control
 */
export interface CompositorConfig {
    /** Canvas dimensions */
    canvasWidth: number;        // Default: 1080
    canvasHeight: number;       // Default: 1080

    /** Background color (if no base image) */
    backgroundColor: string;    // Default: '#00000000' (transparent)

    /** Ordered array of layers (bottom to top) */
    layers: CompositorLayer[];

    /** Output quality */
    outputFormat: 'png' | 'webp' | 'jpeg';
    outputQuality: number;      // 0.0 - 1.0 (for jpeg/webp)
}

/**
 * Calculate the initial centered transform for a new layer
 */
export function calculateInitialTransform(
    itemWidth: number,
    itemHeight: number,
    canvasWidth: number,
    canvasHeight: number
): LayerTransform {
    const imgAspect = itemWidth / itemHeight;
    let newW = itemWidth;
    let newH = itemHeight;

    // Scale down if too large for canvas
    if (newW > canvasWidth * 0.8) {
        newW = canvasWidth * 0.8;
        newH = newW / imgAspect;
    }
    if (newH > canvasHeight * 0.8) {
        newH = canvasHeight * 0.8;
        newW = newH * imgAspect;
    }

    return {
        x: (canvasWidth - newW) / 2,
        y: (canvasHeight - newH) / 2,
        width: newW,
        height: newH,
        rotation: 0,
        opacity: 1,
        flipX: false,
        flipY: false,
        isAutoCentered: true,
        crop: null,
    };
}

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
