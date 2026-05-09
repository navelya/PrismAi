import { Workflow, WorkflowNode, NodeStatus, AiModel } from '../nodes/types';
export type { NodeStatus };

// Message interface
export interface Message {
    id: string;
    type: 'user' | 'assistant';
    content: string;
    result?: any;
    images?: string[];
    timestamp: Date;
    sessionId?: string;
    status?: 'running' | 'completed' | 'error';
    workflow?: any;
    // Thinking / extended-brain fields (new brain only)
    thinking?: string;
    isThinking?: boolean;
    thinkingStartedAt?: number;
    thinkingDurationMs?: number;
    usage?: {
        inputTokens: number;
        outputTokens: number;
        thinkingTokens: number;
        costUsd: number;
    };
    // Clarification chip card (assistant turn): set when the brain emits
    // a `clarification` stream event for this message.
    clarification?: { options: string[] };
    // Set on the assistant message once the user has answered the clarification
    // (either via chip click or by typing). chosenIndex is null for typed answers.
    // text mirrors the user's reply text; used to render the answered chip card.
    clarificationAnswer?: { chosenIndex: number | null; text: string };
    // Plan card (assistant turn): set when the brain emits a `plan`
    // stream event. The full PlanPayload from the propose_plan tool.
    plan?: {
        title: string;
        summary: string;
        arrows: string;
        models: string[];
        detail: string;
        blueprint: { nodes?: any[]; edges?: any[] };
    };
    // Set on the assistant plan message once the user has approved it
    // or sent feedback. chosenAction === 'approve' renders the locked
    // approved state; 'feedback' renders the feedback-given state with
    // the feedback text shown.
    planAnswer?: {
        action: 'approve' | 'feedback';
        feedbackText?: string;
    };
    // Transient client-only error from the most-recent approve attempt.
    // NOT persisted. Reverts to undefined after the user submits feedback
    // or reloads the page.
    planApproveError?: string;
}

// Editor state interface
export interface EditorState {
    zoom: number;
    viewport: { x: number; y: number };
}

// Slice Interfaces
export interface WorkflowSlice {
    activeSessionId: string | null;
    setActiveSessionId: (sessionId: string | null) => void;
    currentWorkflow: Workflow | null;
    setCurrentWorkflow: (workflow: Workflow | null, isDirty?: boolean) => void;
    
    // Selection
    selectedNodeId: string | null;
    setSelectedNodeId: (nodeId: string | null) => void;

    // History (Undo/Redo)
    past: Workflow[];
    future: Workflow[];
    undo: () => void;
    redo: () => void;
    canUndo: () => boolean;
    canRedo: () => boolean;
    takeSnapshot: () => void;

    // Direct React Flow Actions
    onNodesChange: (changes: any[]) => void;
    onEdgesChange: (changes: any[]) => void;
    onConnect: (connection: any) => void;

    isDragging: boolean;
    setIsDragging: (isDragging: boolean) => void;
    copiedNode: WorkflowNode | null;
    copyNode: (nodeId: string) => void;
    pasteNode: (position?: { x: number; y: number }) => void;
    updateNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
    updateNodePositions: (positions: Map<string, { x: number; y: number }>) => void;
    updateNodeConfig: (nodeId: string, config: any) => void;
    updateNodeLabel: (nodeId: string, label: string) => void;
    bringNodeToFront: (nodeId: string) => void;
    /**
     * Re-derive and write source-node values (Prompt text, MediaInput URLs)
     * into nodeOutputs from the current workflow. Call after any operation
     * that wipes nodeOutputs (clearNodeOutputs, execution-start reset) so the
     * compositor preview / other consumers don't lose their upstream data.
     */
    reseedSourceNodeOutputs: () => void;
    isWorkflowDirty: boolean;
    setWorkflowDirty: (isDirty: boolean) => void;

    // Grouping
    /**
     * Create a new group node containing the given child node ids.
     * Computes a bounding box around children, adds GROUP_PADDING + title bar room,
     * places the group with zIndex -1, sets parentNode on each child, converts
     * each child's position to be relative to the new group's origin.
     * Returns the new group's id.
     */
    groupNodes: (childIds: string[]) => string | null;
    /**
     * Dissolve a group: clear parentNode on all its children, convert each
     * child's position back to absolute (group.position + child.position),
     * remove the group node itself.
     */
    ungroupNode: (groupId: string) => void;
    /**
     * Move a single node into or out of a group.
     * - parentId = string: attaches; child position is converted from absolute
     *   to relative to the group's origin; group is expanded to fit the child.
     * - parentId = null: detaches; child position is converted from relative
     *   to absolute. Group keeps its current size (no shrink).
     */
    setNodeParent: (nodeId: string, parentId: string | null) => void;
    /**
     * Resize a group container. Clamps width/height so the group never shrinks
     * past the bounding box of current children + GROUP_PADDING.
     */
    resizeGroup: (groupId: string, width: number, height: number) => void;
    /**
     * Rename a group's title (stored in data.label).
     */
    renameGroup: (groupId: string, label: string) => void;
}

export interface ChatSlice {
    chatMessages: Message[];
    addMessage: (message: Message) => void;
    updateMessage: (id: string, updates: Partial<Message>) => void;
    clearMessages: () => void;
    chatScrollTop: number;
    setChatScrollTop: (pos: number) => void;
    selectedChatModel?: 'haiku' | 'sonnet';
    setSelectedChatModel: (m: 'haiku' | 'sonnet') => void;
}

export interface ExecutionSlice {
    executionResults: Record<string, any>;
    activeExecutionId: string | null;
    executionStartTime: number | null;
    nodeStatuses: Record<string, NodeStatus>;
    nodeOutputs: Record<string, any>;
    addExecutionResult: (workflowId: string, result: any) => void;
    clearExecutionResults: () => void;
    setActiveExecutionId: (id: string | null) => void;
    setExecutionStartTime: (time: number | null) => void;
    isExecutionActive: () => boolean;
    setNodeStatus: (nodeId: string, status: NodeStatus) => void;
    resetNodeStatuses: () => void;
    setNodeOutput: (nodeId: string, output: any) => void;
    clearNodeOutputs: () => void;
    cleanupNodeMetadata: (nodeId: string) => void;
    invalidateNodes: (nodeIds: string[]) => void;
}

export interface UISlice {
    editorState: EditorState;
    setEditorState: (state: Partial<EditorState>) => void;
    isLoading: boolean;
    setIsLoading: (isLoading: boolean) => void;
    isLoadingSession: boolean;
    setIsLoadingSession: (isLoadingSession: boolean) => void;
    statusMessage: string | null;
    setStatusMessage: (message: string | null) => void;
    isCanvasMode: boolean;
    setIsCanvasMode: (v: boolean) => void;
    isCopilotMinimized: boolean;
    setIsCopilotMinimized: (v: boolean) => void;
    lastInteraction: number;
    touchInteraction: () => void;
    nodeLabelDraft: { nodeId: string; label: string } | null;
    setNodeLabelDraft: (draft: { nodeId: string; label: string } | null) => void;
    models: AiModel[];
    categories: any[];
    nodeTypes: any[];
    providers: any[];
    dataTypes: any[];
    isModelsLoading: boolean;
    fetchModelCatalog: () => Promise<void>;
    fetchCategories: () => Promise<void>;
    fetchNodeTypes: () => Promise<void>;
    fetchProviders: () => Promise<void>;
    fetchDataTypes: () => Promise<void>;
    fetchModels: () => Promise<void>;
    runFromNodeId: string | null;
    runMode: 'solo' | 'chain' | 'ab_test' | null;
    triggerRunFromNode: (nodeId: string, runMode?: 'solo' | 'chain' | 'ab_test') => void;
    clearRunFromNode: () => void;
    deleteNodeWithAssets: (nodeId: string) => Promise<void>;
    
    // Menu Data
    menuTree: any[];
    menuFlat: any[];
    isMenuLoading: boolean;
    fetchMenuData: (force?: boolean) => Promise<void>;
}

export interface LivePositionSlice {
    liveNodePositions: Record<string, { x: number; y: number }>;
    setLiveNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
    clearLiveNodePositions: () => void;
    syncLivePositionsToWorkflow: () => void;
}

export type RootState = WorkflowSlice & ChatSlice & ExecutionSlice & UISlice & LivePositionSlice & {
    clearAllState: () => void;
};
