/**
 * Node Types supported by the workflow engine
 */
export type NodeType = 'scrape_images' | 'remove_background' | 'filter_sort' | 'ai_generate_image' | 'upscale_image' | 'merge_image' | 'media_input' | 'compositor';

/**
 * Node execution status for real-time updates
 */
export type NodeStatus = 'idle' | 'pending' | 'running' | 'success' | 'error';

/**
 * Image object structure
 */
export interface ImageObject {
    url: string;
    resolution: {
        width: number;
        height: number;
    };
    metadata?: {
        title?: string;
        source?: string;
        format?: string;
        size?: number;
        hasTransparency?: boolean;
        processedBy?: string;
        generatedBy?: string;
        prompt?: string;
    };
}

/**
 * Node configuration types
 */
export interface ScrapeImagesConfig {
    searchTerm: string;
    limit: number;
    sources?: string[];  // Optional website domains to search from
    imageSize?: 'small' | 'medium' | 'large' | 'xlarge' | 'any';
    imageType?: 'photo' | 'clipart' | 'lineart' | 'face' | 'any';
    colorType?: 'color' | 'gray' | 'mono' | 'any';
    safeSearch?: 'off' | 'medium' | 'high';
}

export interface RemoveBackgroundConfig {
    format?: 'png' | 'webp';
}

export interface FilterSortConfig {
    criteria: 'resolution' | 'size' | 'format';
    order: 'asc' | 'desc';
    limit?: number;
}

export interface AIGenerateImageConfig {
    prompt: string;
    model?: 'gemini-2.5-flash-image' | 'gemini-3-pro-image-preview' | 'pollinations' | 'huggingface' | 'gemini';
    aspectRatio?: '1:1' | '16:9' | '4:3';
}

export interface UpscaleImageConfig {
    scale: 2 | 3 | 4 | 8;  // Upscale factor
}

/**
 * Image Merge Node Configuration
 * Composites one image (overlay) onto another (base) with positioning and scaling
 * 
 * ITERATION BEHAVIOR:
 * - 1-to-1: Single base + single overlay = 1 composite
 * - 1-to-Many: 10 bases + 1 overlay = 10 composites (overlay is repeated)
 * - Many-to-Many: 10 bases + 10 overlays = 10 composites (pairwise: base[i] + overlay[i])
 */
export interface MergeImageConfig {
    /** Position of overlay on base image */
    position: 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'top-center' | 'bottom-center';
    /** Scale of overlay relative to base image width (0.1 = 10%, 1.0 = 100%) */
    overlayScale: number;
    /** Opacity of overlay (0.0 = transparent, 1.0 = opaque) */
    opacity: number;
    /** Padding from edge in pixels */
    padding: number;
}

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
    canvasWidth: number;        // Default: 1920
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
 * Media Input Node Configuration
 * Stores manually uploaded images as base64 data URLs
 */
export interface MediaInputConfig {
    /** Array of base64 data URLs for uploaded images */
    images: string[];
}

export type NodeConfig =
    | ScrapeImagesConfig
    | RemoveBackgroundConfig
    | FilterSortConfig
    | AIGenerateImageConfig
    | UpscaleImageConfig
    | MergeImageConfig
    | MediaInputConfig
    | CompositorConfig;

/**
 * Node definition for workflow
 */
export interface WorkflowNode {
    id: string;
    type: NodeType;
    position: {
        x: number;
        y: number;
    };
    data: {
        label: string;
        config: NodeConfig;
    };
}

/**
 * Edge definition for workflow
 */
export interface WorkflowEdge {
    id: string;
    source: string;
    target: string;
    type?: string;
    sourceHandle?: string | null;
    targetHandle?: string | null;
}

/**
 * Complete workflow definition
 */
export interface Workflow {
    id?: string;
    name: string;
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
}

/**
 * Execution context passed between nodes
 */
export interface ExecutionContext {
    workflowId: string;
    executionId: string;
    data: any;
}

/**
 * Node execution result
 */
export interface NodeExecutionResult {
    success: boolean;
    data: any;
    error?: string;
}

/**
 * Node executor function signature
 */
export type NodeExecutor = (
    config: NodeConfig,
    input: any,
    context: ExecutionContext
) => Promise<NodeExecutionResult>;

/**
 * Execution status
 */
export type ExecutionStatus = 'pending' | 'running' | 'completed' | 'failed';

/**
 * Execution record
 */
export interface ExecutionRecord {
    id: string;
    workflowId: string;
    status: ExecutionStatus;
    resultData: any;
    errorMessage?: string;
    createdAt: string;
    completedAt?: string;
}
