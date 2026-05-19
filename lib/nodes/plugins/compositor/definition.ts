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
 * Per-clip transition spec. Stored at Stage 1 but ignored by the executor.
 */
export interface ClipTransition {
    type: 'none' | 'crossfade' | 'fade';
    duration: number;           // seconds
}

/**
 * Single layer definition within the Compositor.
 *
 * Temporal fields (startTime, duration, trimIn, trimOut, speed, muted, transition)
 * are forward-compat. Stage 1 only acts on startTime/duration to gate visibility
 * over the timeline; the rest are stored and ignored until Stage 2+.
 */
export interface CompositorLayer {
    id: string;                 // Unique layer ID (e.g., "layer_0")
    name: string;               // User-editable name (e.g., "Background")
    sourceHandleId: string;     // React Flow handle ID this layer is connected to
    selectedIndex: number;      // Which image from source array (default: 0)
    transform: LayerTransform;  // Position/scale/rotation data
    visible: boolean;           // Toggle visibility
    locked: boolean;            // Prevent edits

    // --- Temporal (Stage 1 active) ---
    /** When this layer first appears on the timeline (seconds). Default 0. */
    startTime: number;
    /** How long it stays. null = "full source" for video, "full timeline" for image/text. */
    duration: number | null;
    /**
     * One-shot flag: true once the editor has auto-placed this video layer at
     * the end of the prior timeline content (so new videos don't pile up at
     * t=0). After this is set, the user owns the layer's startTime and the
     * auto-sequencer never touches it again. Image/text layers don't need
     * sequencing — this stays falsy for them.
     */
    isAutoSequenced?: boolean;

    // --- Forward-compat (Stage 1 ignored) ---
    /** Trim seconds from the start of the source clip (Stage 2). */
    trimIn: number;
    /** Trim point measured from source start; null = end of source (Stage 2). */
    trimOut: number | null;
    /** Playback rate multiplier (Stage 2). */
    speed: number;
    /** Mute the layer's audio (Stage 2). */
    muted: boolean;
    /** Outgoing transition into the next layer (Stage 3). */
    transition: ClipTransition;
}

/**
 * Compositor Configuration.
 *
 * Was image-only; now also drives a temporal composite when any layer has
 * video content or a non-default time range. See [executor.server.ts](executor.server.ts)
 * for the hybrid path.
 */
export interface CompositorConfig {
    /** Canvas dimensions */
    canvasWidth: number;        // Default: 1920 in modal, but 1080 in legacy default
    canvasHeight: number;       // Default: 1080

    /** Background color (if no base image) */
    backgroundColor: string;    // Default: '#00000000' (transparent)

    /** Ordered array of layers (array[0] = bottom of stack; renderer reverses for draw order) */
    layers: CompositorLayer[];

    /** Image output format (used when output is still image) */
    outputFormat: 'png' | 'webp' | 'jpeg';
    outputQuality: number;      // 0.0 - 1.0 (for jpeg/webp)

    // --- Temporal config (Stage 1) ---
    /** Output framerate when rendering a video. Default 30. */
    fps: number;
    /** Hard timeline length in seconds. null = auto = max(layer.startTime + effectiveDuration). */
    timelineDuration: number | null;
}

/**
 * When the first layer connects, the canvas resizes to match the layer's
 * intrinsic dimensions and the layer fills it edge-to-edge. After this fires
 * once, the layer's `isAutoCentered` flag prevents re-firing — subsequent
 * dimension changes are user-driven via the editor's canvas controls.
 */
export function calculateFirstLayerFitToCanvas(
    itemWidth: number,
    itemHeight: number
): { canvasWidth: number; canvasHeight: number; transform: LayerTransform } {
    const w = Math.max(1, Math.round(itemWidth));
    const h = Math.max(1, Math.round(itemHeight));
    return {
        canvasWidth: w,
        canvasHeight: h,
        transform: {
            x: 0,
            y: 0,
            width: w,
            height: h,
            rotation: 0,
            opacity: 1,
            flipX: false,
            flipY: false,
            isAutoCentered: true,
            crop: null,
        },
    };
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
        description: 'Layer-based image and video compositing on a timeline',
        color: '#8b5cf6',
        icon: 'Layers2',
        ephemeral: true,
    },
    handles: {
        inputs: [
            { id: 'layers', label: 'Layers', expectedType: ['image', 'video', 'text', 'audio'], is_array: true, color: '#f8fafc' }
        ],
        // Single polymorphic output. The id stays `image_out` so saved
        // workflows (which originally only had `image_out` and `video_out`,
        // both pointing at the same envelope) keep their downstream edges on
        // the canonical handle. The dataType is the broad union — the
        // connection validator narrows it at runtime via
        // resolveDynamicOutputType (see lib/editor/handle-compatibility.ts):
        // any wired video layer narrows the output to 'video', blocking new
        // drops onto image-only consumers. The component mirrors this in the
        // visible label/color.
        outputs: [
            { id: 'image_out', label: '', dataType: ['image', 'video'] },
        ],
    },
    defaultConfig: {
        canvasWidth: 1080,
        canvasHeight: 1080,
        backgroundColor: '#00000000',
        layers: [],
        outputFormat: 'png',
        outputQuality: 1.0,
        fps: 30,
        timelineDuration: null,
    },
    aiSchema: {
        type: 'object',
        properties: {
            canvasWidth: { type: 'number', description: 'Width of the canvas in pixels' },
            canvasHeight: { type: 'number', description: 'Height of the canvas in pixels' },
            backgroundColor: { type: 'string', description: 'Hex color code with alpha (e.g., #00000000)' },
            outputFormat: { type: 'string', enum: ['png', 'webp', 'jpeg'], description: 'Image output format. Ignored when timeline has video content.' },
            outputQuality: { type: 'number', minimum: 0, maximum: 1 },
            fps: { type: 'number', default: 30, description: 'Output framerate for video rendering.' },
            timelineDuration: { type: ['number', 'null'], default: null, description: 'Total timeline length in seconds. null = auto = longest layer end.' },
            layers: {
                type: 'array',
                description: 'CRITICAL: Array of layers. You MUST generate one layer object for every image, video, text, OR audio source you connect to this compositor. Layer at array[0] is the BOTTOM of the visual stack. Layers can be still (no duration on timeline) or temporal (startTime + duration). Audio-only sources are accepted as wires but currently do not render visually or play standalone — only the audio track of a connected VIDEO source is audible during preview (toggle via the mute control). The compositor has a single polymorphic output handle (image_out) that emits an image when all layers are still, or a video when any layer is temporal/video.',
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
                        startTime: { type: 'number', default: 0, description: 'When this layer starts on the timeline, in seconds.' },
                        duration: { type: ['number', 'null'], default: null, description: 'How long the layer is active. null = full source for video, full timeline for image/text.' },
                        trimIn: { type: 'number', default: 0, description: 'Forward-compat (Stage 2). Seconds trimmed from source start.' },
                        trimOut: { type: ['number', 'null'], default: null, description: 'Forward-compat (Stage 2). Source-relative end time; null = full source.' },
                        speed: { type: 'number', default: 1, description: 'Forward-compat (Stage 2). Playback rate.' },
                        muted: { type: 'boolean', default: false, description: 'Forward-compat (Stage 2). Mute layer audio.' },
                        transition: {
                            type: 'object',
                            description: 'Forward-compat (Stage 3). Outgoing transition.',
                            properties: {
                                type: { type: 'string', enum: ['none', 'crossfade', 'fade'], default: 'none' },
                                duration: { type: 'number', default: 0 },
                            },
                        },
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
