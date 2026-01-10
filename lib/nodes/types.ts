/**
 * Node Types supported by the workflow engine
 */
export type NodeType = 'scrape_images' | 'remove_background' | 'filter_sort' | 'ai_generate_image' | 'upscale_image' | 'merge_image' | 'media_input';

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
    | MediaInputConfig;

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
