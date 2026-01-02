/**
 * Node Types supported by the workflow engine
 */
export type NodeType = 'scrape_images' | 'remove_background' | 'filter_sort' | 'ai_generate_image';

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

export type NodeConfig =
    | ScrapeImagesConfig
    | RemoveBackgroundConfig
    | FilterSortConfig
    | AIGenerateImageConfig;

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
