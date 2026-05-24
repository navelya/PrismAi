import { Workflow, WorkflowNode, NodeStatus, AiModel } from '../nodes/types';
import type { NodeResultType } from '../workflow/result-format';
export type { NodeStatus };

// Message interface
export interface Message {
    id: string;
    type: 'user' | 'assistant';
    content: string;
    result?: any;
    images?: string[];
    // Snapshot of canvas nodes the user referenced when sending this message.
    // Captured at send-time so labels survive later renames/deletes. Persisted
    // to messages.metadata.node_refs. Rendered as a marker strip on the bubble.
    nodeRefs?: import('@/lib/utils/selection-refs').NodeRef[];
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
    // Transient client-only flag: true once the brain emits a
    // `tool_start: propose_plan` event for this turn but before the
    // full `plan` payload arrives. Drives the PlanCardSkeleton placeholder.
    // Cleared implicitly once `plan` is set (skeleton is gated on !plan).
    // Not persisted.
    planLoading?: boolean;
    // Plan card (assistant turn): set when the brain emits a `plan`
    // stream event. The full PlanPayload from the propose_plan tool.
    plan?: {
        title: string;
        summary: string;
        arrows: string;
        models: string[];
        detail: string;
        blueprint: { nodes?: any[]; edges?: any[] };
        tasks?: import('@/lib/chat/streaming/protocol').TaskBlueprint[];
    };
    // Live task-execution progress, updated via stream events (task_start /
    // task_complete / tasks_complete) and via Supabase Realtime when the server
    // persists metadata.taskProgress to the messages row.
    taskProgress?: {
        status: 'running' | 'done' | 'failed';
        currentIndex: number;
        total: number;
        failedTaskId?: string | null;
        errorMessage?: string;
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

    // One-shot: when set, EditorCanvas smooth-pans to this node, selects it,
    // and clears the field. Used by the Run Workflow error popover to jump
    // to the offending node when an entry is clicked.
    pendingCenterNodeId: string | null;
    selectNodeAndCenter: (nodeId: string) => void;
    clearPendingCenterNodeId: () => void;

    // One-shot: when set, EditorCanvas drops this node at the current viewport
    // center with the standard "new node" pop, then clears the field. Lets the
    // side panels (Characters, Add Node) add a node by click instead of drag —
    // mirrors the drag payload shape. `type` is a string (not NodeType) so
    // plugin types like 'character' work.
    pendingAddNode: { type: string; nodeTypeId?: string; modelId?: number; initialConfig?: Record<string, any> } | null;
    requestAddNode: (payload: { type: string; nodeTypeId?: string; modelId?: number; initialConfig?: Record<string, any> }) => void;
    clearPendingAddNode: () => void;

    // Live multi-select set, mirrored from React Flow's per-node `selected`
    // flag in EditorCanvas. Read by the chat to render the selection pill and
    // to build the NodeRef focus hint on send. Ephemeral — never persisted.
    currentSelectedNodeIds: string[];
    setCurrentSelectedNodeIds: (ids: string[]) => void;
    // One-shot trigger: bumping this counter tells EditorCanvas to deselect
    // every node. Used by the chat pill's clear (X) button, since emptying
    // currentSelectedNodeIds alone would be re-filled by the canvas on next render.
    selectionClearToken: number;
    clearCanvasSelection: () => void;

    // Transient flag flipped true when the user attempts to Run a workflow
    // with validation errors. Per-node error badges only render while this
    // is active (4 seconds), then hide until the next Run attempt — keeps
    // the canvas uncluttered by default.
    errorFlashActive: boolean;
    flashErrors: () => void;

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

    /**
     * Drop outgoing edges from a node whose downstream target is incompatible
     * with the given output type. Used by nodes with dynamically-narrowing
     * outputs (e.g. Blur) — when their effective output type changes (image
     * → video or vice versa), edges that targeted a now-incompatible input
     * become orphaned and are removed.
     */
    pruneIncompatibleOutgoingEdges: (nodeId: string, outputType: string | string[]) => void;

    isDragging: boolean;
    setIsDragging: (isDragging: boolean) => void;
    copiedNode: WorkflowNode | null;
    copyNode: (nodeId: string) => void;
    pasteNode: (position?: { x: number; y: number }) => void;
    updateNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
    updateNodePositions: (positions: Map<string, { x: number; y: number }>) => void;
    updateNodeConfig: (nodeId: string, config: any) => void;
    /**
     * Append a completed ai_generator run's outputs to the node's persisted
     * collection (newest-first), auto-select the newest, and persist. No-op for
     * non-ai_generator nodes. Idempotent per executionId.
     */
    appendAiGeneratorRun: (
        nodeId: string,
        type: NodeResultType,
        values: any[],
        executionId?: string,
    ) => void;
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
     *
     * `opts.anchorRight` keeps the RIGHT edge fixed (i.e., the user grabbed the
     * left/W handle). `opts.anchorBottom` keeps the BOTTOM edge fixed (top/N).
     * On an anchored axis the group's position shifts by -deltaSize and each
     * child's relative position shifts by +deltaSize so children stay pinned in
     * world space. Default (both false) anchors at the top-left as before.
     */
    resizeGroup: (
        groupId: string,
        width: number,
        height: number,
        opts?: { anchorRight?: boolean; anchorBottom?: boolean; skipSnapshot?: boolean }
    ) => void;
    /**
     * Rename a group's title (stored in data.label).
     */
    renameGroup: (groupId: string, label: string) => void;
    /**
     * Wrap the given node IDs in a new group_container. The new group is positioned
     * at the bounding box of the selection minus padding (24px X, 56px Y for header).
     * Children's positions become relative to the new group; their parentNode is set.
     *
     * Validation (caller's responsibility — store does not enforce):
     * - All IDs must exist on the canvas.
     * - None of the nodes may already be inside another group (parentNode unset).
     * - None may BE a group_container.
     *
     * Returns the new group's id, or null if validation fails.
     */
    createGroupFromSelection: (
        nodeIds: string[],
        options?: { label?: string; icon?: string; color?: string }
    ) => string | null;
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
    // Server-side failure message per node (e.g. the Replicate prediction error),
    // keyed by nodeId. Populated when a node's status becomes 'error' and surfaced
    // as a hover tooltip on the node's error badge. Cleared when the node leaves
    // the error state (re-run, success) or is invalidated.
    nodeErrors: Record<string, string>;
    /** Signed, ephemeral adjustment added to the authoritative balance for display.
     *  Negative while a run's debit is in flight; positive while a refund is in flight. */
    optimisticCreditDelta: number;
    /** In-flight optimistic charges, keyed by executionId. */
    pendingCharges: Record<string, { cost: number; nodeIds: string[] }>;
    addExecutionResult: (workflowId: string, result: any) => void;
    clearExecutionResults: () => void;
    setActiveExecutionId: (id: string | null) => void;
    setExecutionStartTime: (time: number | null) => void;
    isExecutionActive: () => boolean;
    setNodeStatus: (nodeId: string, status: NodeStatus) => void;
    setNodeError: (nodeId: string, error: string | null) => void;
    resetNodeStatuses: () => void;
    setNodeOutput: (nodeId: string, output: any) => void;
    clearNodeOutputs: () => void;
    cleanupNodeMetadata: (nodeId: string) => void;
    invalidateNodes: (nodeIds: string[]) => void;
    applyOptimisticCharge: (executionId: string, cost: number, nodeIds: string[]) => void;
    settleOptimisticCharge: (executionId: string, failed: boolean) => void;
    resetOptimisticDelta: () => void;
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
    // Mobile-only: when true, the read-only canvas is shown and the chat is
    // collapsed into a floating bubble. Ephemeral UI flag — never persisted.
    isMobileCanvasOpen: boolean;
    setIsMobileCanvasOpen: (v: boolean) => void;
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
    runMode: 'solo' | 'chain' | 'ab_test' | 'selection' | null;
    /** Targets for 'selection' mode — the set of nodes from the multi-select toolbar's Run button. */
    runSelectionIds: string[] | null;
    triggerRunFromNode: (nodeId: string, runMode?: 'solo' | 'chain' | 'ab_test') => void;
    triggerRunSelection: (nodeIds: string[]) => void;
    clearRunFromNode: () => void;
    deleteNodeWithAssets: (nodeId: string) => Promise<void>;
    
    // Menu Data
    menuTree: any[];
    menuFlat: any[];
    isMenuLoading: boolean;
    fetchMenuData: (force?: boolean) => Promise<void>;

    /** ID of the group currently being hovered over by a dragged node, or null. Ephemeral — never persisted. */
    dragHoverGroupId: string | null;
    setDragHoverGroupId: (id: string | null) => void;

    /**
     * Progress for the multi-select bulk-download flow. Keyed by a per-call
     * operation id so concurrent downloads each get their own pill in the
     * EditorToolbar. Empty record = idle. EditorCanvas is the sole writer.
     * Ephemeral — never persisted.
     */
    bulkDownloads: Record<string, { current: number; total: number }>;
    setBulkDownloadProgress: (id: string, state: { current: number; total: number }) => void;
    clearBulkDownload: (id: string) => void;

    /**
     * Tracks which nodes the AI has touched during the current chat turn so
     * the canvas can smoothly fit them into view. Driven by use-chat-messages
     * (begin → record per patch → end) and consumed by <AiAddedZoom />.
     * Ephemeral — never persisted.
     *
     * `touchedNodeIds` is the union of every `addedNodes`, `updatedNodes`, and
     * both endpoints of every `addedEdges` entry seen this turn. `patchTick`
     * is a monotonic counter bumped on each `recordAiPatch` so subscribers
     * fire even when the id set is unchanged (e.g. position-only update on a
     * node already tracked).
     */
    aiTurn: {
        active: boolean;
        touchedNodeIds: string[];
        patchTick: number;
    } | null;
    beginAiTurn: () => void;
    recordAiPatch: (patch: import('@/lib/workflow/workflow-patch').WorkflowPatch | null | undefined) => void;
    endAiTurn: () => void;
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
