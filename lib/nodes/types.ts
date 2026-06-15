/**
 * Node Types supported by the workflow engine
 */
export type NodeType = 'media_input' | 'compositor' | 'prompt' | 'ai_generator' | 'blur' | 'group_container' | 'note' | 'collect' | 'compare';

export interface InputHandle {
    name: string;
    api_mapping_key: string;
    type: string;
    is_array: boolean;
    is_mandatory: boolean;
    is_visible: boolean;
    /** Credits added per item connected to this handle (e.g. per image/video).
     *  Counted at run time × the number of connected items. Omitted/0 = free. */
    cost_per_item?: number;
    /** For array-capable handles (is_array), the max number of edges/items that
     *  may connect. Enforced at connection time. Omitted/0 = unlimited. */
    max_items?: number;
    /** Inline admin-authored help text shown to end users as a hover tooltip on
     *  the handle label. Empty/absent = no tooltip. */
    description?: string;
}

export interface OutputHandle {
    name: string;
    api_mapping_key: string;
    type: string;
    is_array: boolean;
    is_visible: boolean;
    /** See InputHandle.description. */
    description?: string;
}

export interface Control {
    api_mapping_key: string;
    type: string;
    component: 'text_input' | 'textarea' | 'slider' | 'number_input' | 'checkbox' | 'select' | 'prompt_textarea' | 'negative_prompt' | 'aspect_ratio' | 'resolution' | 'format' | 'reverse' | 'threshold' | 'voice_picker';
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
    /** Inline admin-authored help text shown to end users as a small ⓘ info icon
     *  + hover tooltip next to the control's label. Empty/absent = no icon. */
    description?: string;
}

export interface InputsSchema {
    description?: string;
    handles?: InputHandle[];
    controls?: Control[];
}

/**
 * A control is treated as a "seed" input (with auto/random semantics) when its
 * api_mapping_key is "seed". Convention: `default_value === null` (or empty) means
 * AUTO — the value is omitted from the model payload so it randomizes every run.
 * A number means the seed is pinned to that value.
 */
export function isSeedControl(ctrl: Pick<Control, 'api_mapping_key'>): boolean {
    return (ctrl?.api_mapping_key || '').toLowerCase() === 'seed';
}

export interface OutputsSchema {
    handles?: OutputHandle[];
}

export interface Category {
    id: string;
    display_name: string;
    icon_reference: string;
    order_index: number;
    /** Short blurb shown on hover in the Add Node panel; falls back to an item count when absent. */
    description?: string;
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
 * Image object structure. `url` is the canonical, serializable representation.
 * Live ephemeral output is published as a `GraphDescription` on a sibling
 * `graph` field (currently accessed via cast); see
 * `lib/nodes/plugins/compositor/shared.ts` for the type and
 * `docs/superpowers/specs/2026-05-20-ephemeral-envelope-unification-design.md`
 * for the contract.
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
    /**
     * Fan-out (iterations > 1) only: this prediction's stable index. Carried into
     * the webhook URL so the callback can address its own node_predictions row by
     * (execution_id, node_id, prediction_index) without depending on the async
     * replicate_id or on the dispatcher's row insert having landed first.
     */
    predictionIndex?: number;
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
    /**
     * Optional explicit result type. When set, the ephemeral executor persists
     * this instead of inferring from `data`'s shape. Needed by polymorphic
     * passthrough nodes (e.g. `collect`) whose output type isn't recoverable
     * from item shape alone — a video URL string would otherwise be mis-typed.
     */
    result_type?: 'image' | 'video' | 'audio' | '3d' | 'text' | 'json';
    /**
     * Async provider identity for a 'pending' result. Lets the dispatcher record
     * which provider owns the job (provider_id) and its job id (provider_job_id)
     * so the Phase A poll-backstop can complete it. Omitted for Replicate (the
     * dispatcher defaults to 'replicate' + the prediction id) and sync results.
     */
    providerId?: string;
    providerJobId?: string;
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
