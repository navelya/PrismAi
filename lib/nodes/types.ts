/**
 * Node Types supported by the workflow engine
 */
export type NodeType = 'media_input' | 'compositor' | 'prompt' | 'ai_generator' | 'blur' | 'group_container';

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
    /** Option values to hide from the end-user picker. Admin still sees them. Absent or empty = all visible. */
    disabled_options?: string[];
    min?: number;
    max?: number;
    step?: number;
    cost_modifiers?: Record<string, number>;
    cost_per_unit?: number;
    /** When true on a numeric control, multiplies the total node cost by this control's value (e.g. video duration). */
    is_cost_multiplier?: boolean;
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
 * Image object structure.
 *
 * `url` is the canonical, serializable representation. `canvas` is an optional
 * LIVE reference used by client-side ephemeral nodes that render directly into
 * a `<canvas>` (compositor with video content, future live-blur, etc.) — it
 * lets downstream consumers draw frames in real time without round-tripping
 * through a dataURL on every tick. Anything that persists or serializes
 * `nodeOutputs` MUST ignore the `canvas` field.
 */
export interface ImageObject {
    url: string;
    /** Live canvas surface. Present on outputs from canvas-driven ephemeral nodes; consume with `drawImage` per frame. */
    canvas?: HTMLCanvasElement;
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
        config: Record<string, any>;
        output?: any; // Cached execution output
        outputMetadata?: any; // Metadata about node outputs (e.g. thumbnails)
        status?: NodeStatus; // Current execution status of this specific node
        errorMessage?: string; // Error message if the node failed
        isNew?: boolean; // Ephemeral flag for initial animations
        __originalType?: string; // Track original type for legacy/deprecated nodes
    };
    zIndex?: number;
    width?: number;
    height?: number;
    measured?: {
        width?: number;
        height?: number;
    };
    /** ID of the group this node belongs to (omitted when ungrouped) */
    parentNode?: string;
    /** Intentionally NOT set on grouped children — must be omitted so they can be dragged OUT of the group. */
    extent?: 'parent';
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
    config: Record<string, any>,
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
