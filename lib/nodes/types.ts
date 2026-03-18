/**
 * Node Types supported by the workflow engine
 */
export type NodeType = 'ai_generate_image' | 'media_input' | 'compositor' | 'prompt' | 'ai_generator';

export interface InputHandle {
    name: string;
    api_mapping_key: string;
    type: string;
    is_array: boolean;
    is_mandatory: boolean;
    is_visible: boolean;
}

export interface OutputHandle {
    name: string;
    api_mapping_key: string;
    type: string;
    is_array: boolean;
    is_visible: boolean;
}

export interface Control {
    api_mapping_key: string;
    type: string;
    component: 'text_input' | 'textarea' | 'slider' | 'number_input' | 'checkbox' | 'select' | 'prompt_textarea' | 'negative_prompt' | 'aspect_ratio' | 'resolution' | 'format' | 'reverse' | 'threshold';
    default_value: any;
    is_visible: boolean;
    label?: string;
    options?: string[];
    min?: number;
    max?: number;
    step?: number;
    cost_modifiers?: Record<string, number>;
    cost_per_unit?: number;
}

export interface InputsSchema {
    description?: string;
    handles?: InputHandle[];
    controls?: Control[];
}

export interface OutputsSchema {
    handles?: OutputHandle[];
}

export interface Category {
    id: string;
    display_name: string;
    icon_reference: string;
    order_index: number;
}

export interface NodeTypeRecord {
    id: string;
    display_name: string;
    icon_reference: string;
    parent_categories: string[];
    archetype_id?: string;
}

export interface AiModel {
    id: number;
    replicate_model_id: string;
    display_name: string;
    credit_cost: number;
    is_per_second: boolean;
    is_active: boolean;
    category_id: string;
    node_type_id: string | null;
    provider_id: string | null;
    providers?: {
        name: string;
        logo_url: string | null;
    } | null;
    inputs_schema: InputsSchema | null;
    outputs_schema: OutputsSchema | null;
}

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
export interface AIGenerateImageConfig {
    prompt: string;
    model?: 'gemini-2.5-flash-image' | 'gemini-3-pro-image-preview' | 'pollinations' | 'huggingface' | 'gemini';
    aspectRatio?: '1:1' | '16:9' | '4:3';
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
    /** Array of base64 data URLs (legacy) or storage objects for uploaded images */
    images: Array<{ url: string; path: string } | string>;
}

/**
 * Prompt Node Configuration
 * Provides a string output to be used as a prompt or search term
 */
export interface PromptConfig {
    text: string;
}

/**
 * AI Generator Node Configuration
 * Dynamic node that adapts based on selected model from the catalog
 */
export interface AIGeneratorConfig {
    model_id?: number;
    node_type_id?: string;
    control_values?: Record<string, any>;
    last_output?: any;
}

export type NodeConfig =
    | AIGenerateImageConfig
    | MediaInputConfig
    | CompositorConfig
    | PromptConfig
    | AIGeneratorConfig;

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
        output?: any; // Cached execution output
        outputMetadata?: any; // Metadata about node outputs (e.g. thumbnails)
        __originalType?: string; // Track original type for legacy/deprecated nodes
    };
    zIndex?: number;
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
    userId?: string;
    sessionId?: string;
    nodeId?: string; // Current node being executed
    data: any;
}

/**
 * Node execution result
 */
export interface NodeExecutionResult {
    success: boolean;
    data: any;
    error?: string;
    status?: 'success' | 'pending' | 'error';
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
