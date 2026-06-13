import { Workflow, WorkflowNode, NodeStatus, AiModel } from '../nodes/types';
import type { NodeResultType, RenderableMediaItem } from '../workflow/result-format';
export type { NodeStatus };

export type RunProposalStatus = 'ready' | 'running' | 'done' | 'failed' | 'superseded';

/**
 * Standing chat-composer preferences. Each value is either a concrete choice or
 * the sentinel `'auto'` (no preference). Model keys hold the AiModel id as a
 * string. See UISlice.chatPreferences for lifecycle/persistence.
 */
export interface ChatPreferences {
    imageModelId: string;   // AiModel id (stringified) or 'auto'
    videoModelId: string;   // AiModel id (stringified) or 'auto'
    aspectRatio: string;    // '1:1' | '16:9' | '9:16' | '4:3' | '3:4' | '21:9' | 'auto'
    videoDuration: string;  // '5s' | '10s' | '15s' | 'auto'
    quality: string;        // '480p' | '720p' | '1080p' | 'auto'
    outputs: string;        // '1' | '2' | '4' | 'auto'
    style: string;          // 'Photorealistic' | 'Cinematic' | 'Illustration' | 'Anime' | '3D' | 'auto'
}

/** All-'auto' default — no preferences set. */
export const DEFAULT_CHAT_PREFERENCES: ChatPreferences = {
    imageModelId: 'auto',
    videoModelId: 'auto',
    aspectRatio: 'auto',
    videoDuration: 'auto',
    quality: 'auto',
    outputs: 'auto',
    style: 'auto',
};

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
    /** Which model produced this assistant message ('haiku' = fast, 'sonnet' = deep). */
    model?: 'haiku' | 'sonnet';
    // Clarification chip card (assistant turn): set when the brain emits
    // a `clarification` stream event for this message. `questions` is the
    // multi-question shape (each question shown one at a time); `options` is
    // the legacy single-question shape kept for old persisted rows.
    clarification?: {
        questions?: import('@/lib/chat/streaming/protocol').ClarificationQuestion[];
        options?: string[];
    };
    // Set on the assistant message once the user has answered the clarification.
    // `answers` holds one entry per question (chosenIndex null for typed answers);
    // legacy single-answer rows carry `chosenIndex`. `text` is the combined reply
    // text sent as the user message. Used to render the answered card.
    clarificationAnswer?: {
        chosenIndex?: number | null;
        text: string;
        answers?: { chosenIndex: number | null; text: string }[];
    };
    // Transient client-only flag: true once the brain emits a
    // `tool_start: propose_plan` event for this turn but before the
    // full `plan` payload arrives. Drives the PlanCardSkeleton placeholder.
    // Cleared implicitly once `plan` is set (skeleton is gated on !plan).
    // Not persisted.
    planLoading?: boolean;
    // Transient client-only flag: true WHILE the brain is consulting the
    // template library on a fresh build. Set on `template_search_start`,
    // cleared on `template_search_complete` (and forced false on `done` as
    // a safety net). Drives the active "Consulting templates" spinner step.
    templateSearching?: boolean;
    // Persistent flag: true once a template search ran this turn. Set on
    // `template_search_complete`, persisted to assistant metadata + rehydrated
    // on reload, so the "Consulted templates" timeline step stays visible like
    // the plan/built steps. Hit/miss is NOT surfaced — scaffolding only.
    templateConsulted?: boolean;
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
    // Chat-run feature: when an AI turn touched runnable nodes whose run was
    // NOT auto-executed (paid run above the auto-run limit), this holds the
    // proposed run. Rendered as the RunProposalCard. Persisted to DB
    // metadata.run_proposal so the card (as a manual button) survives refresh.
    runProposal?: {
        runTargetIds: string[];
        terminalIds: string[];
        cost: number;
        status: RunProposalStatus;
        /** When set, why the run can't dispatch (validation message). Shown on the card. */
        error?: string;
        /** The execution_id this proposal's run dispatched under (stamped by
         *  commitExecution). The freeze only snapshots a terminal's output once
         *  that output was produced by THIS execution — so a stale prior-run
         *  output lingering in nodeOutputs can never be frozen into the card. */
        executionId?: string;
        /** How many media results this run is expected to emit (Σ terminal
         *  iterations). Drives the inline skeleton-grid placeholder count so it
         *  matches the real result count. */
        expectedResultCount?: number;
    };
    // Terminal node ids whose outputs render inline under this message while a
    // chat-triggered run is in flight. Frozen into `result` on completion.
    // Persisted to DB metadata.inline_result_ids.
    inlineResultIds?: string[];
}

// Editor state interface
export interface EditorState {
    zoom: number;
    viewport: { x: number; y: number };
}

/** One iteration's outcome while a fan-out ai_generator node is still running. */
export interface PartialIterationItem {
    index: number;
    status: 'completed' | 'failed';
    /** Renderable media for a completed iteration; empty for a failed one. */
    media: RenderableMediaItem[];
}

/** Per-node accumulator of streaming iteration results for the active run. */
export interface PartialIterationEntry {
    executionId: string;
    /** Outcomes in arrival (completion) order. */
    items: PartialIterationItem[];
}

// Slice Interfaces
export interface WorkflowSlice {
    activeSessionId: string | null;
    setActiveSessionId: (sessionId: string | null) => void;
    activeCanvasId: string | null;
    setActiveCanvasId: (id: string | null) => void;
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
    clearHistory: () => void;
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
    pruneIncompatibleOutgoingEdges: (nodeId: string, outputType: string | string[], sourceHandleId?: string) => void;

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
    // The session's currently-active chat (multi-chat-per-session). Tracked so
    // title generation targets the chat the message was sent to, not whatever is
    // active when the async title call returns (avoids a misfiled-title race).
    activeChatId: string | null;
    setActiveChatId: (id: string | null) => void;
}

export interface ExecutionSlice {
    executionResults: Record<string, any>;
    activeExecutionId: string | null;
    executionStartTime: number | null;
    nodeStatuses: Record<string, NodeStatus>;
    nodeOutputs: Record<string, any>;
    // The execution_id that produced each node's current `nodeOutputs` entry.
    // Lets the chat-run freeze tell THIS run's output apart from a stale prior
    // run's output that lingers in the shared, execution-agnostic nodeOutputs
    // slot. Cleared in lock-step with nodeOutputs.
    nodeOutputExecutions: Record<string, string | undefined>;
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
    setNodeOutput: (nodeId: string, output: any, executionId?: string) => void;
    clearNodeOutputs: () => void;
    cleanupNodeMetadata: (nodeId: string) => void;
    invalidateNodes: (nodeIds: string[]) => void;
    applyOptimisticCharge: (executionId: string, cost: number, nodeIds: string[]) => void;
    settleOptimisticCharge: (executionId: string, failed: boolean) => void;
    resetOptimisticDelta: () => void;
    partialIterationResults: Record<string, PartialIterationEntry>;
    addPartialIterationResult: (
        nodeId: string,
        executionId: string,
        item: PartialIterationItem,
    ) => void;
    clearPartialIterationResults: (nodeId: string) => void;
}

/**
 * Tabs of the global "Your account" modal (the former /settings page). Used by
 * the sidebar profile menu and the /settings deep-link redirector.
 */
export type AccountTab =
    | 'profile'
    | 'preferences'
    | 'plan-pricing'
    | 'credits-billing'
    | 'api-keys'
    | 'members';

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
    // Desktop-only: when true, the canvas-mode chat expands to fill the
    // workspace ("full screen view") instead of the compact sidebar. Ephemeral
    // UI flag — never persisted, and reset whenever the session changes.
    isChatFullscreen: boolean;
    setIsChatFullscreen: (v: boolean) => void;
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
    // Templates catalog — loaded once on app open, shared across the /templates
    // gallery and the in-canvas Templates modal. Refreshed (force) after an admin
    // creates/edits/deletes a template.
    templates: any[];
    isTemplatesLoading: boolean;
    templatesLoaded: boolean;
    fetchTemplates: (force?: boolean) => Promise<void>;
    // Per-template workflow graphs, fetched lazily the first time a template
    // detail opens and cached so re-opening never reloads. (List metadata above
    // already covers everything else, so the popup only ever fetches the graph.)
    templateWorkflows: Record<string, { nodes: any[]; edges: any[] }>;
    templateWorkflowLoading: Record<string, boolean>;
    fetchTemplateWorkflow: (id: string) => Promise<void>;
    invalidateTemplateWorkflow: (id: string) => void;
    // Credit (monthly vs top-up) breakdown — preloaded on app open so the credits
    // popover shows instantly instead of fetching on hover. Refreshed silently.
    creditBreakdown: { balance: number; monthly: number; topup: number } | null;
    isCreditBreakdownLoading: boolean;
    fetchCreditBreakdown: () => Promise<void>;
    // Docked side-rail open/collapsed preference. Persisted (survives reloads,
    // consistent across pages) via the store's blacklist partialize. Defaults
    // to collapsed. Only the docked variant uses it; the floating menu and the
    // mobile drawer manage their own open state.
    sidebarExpanded: boolean;
    setSidebarExpanded: (expanded: boolean) => void;
    // Global "Your account" modal — the former /settings page, now an overlay
    // reachable from anywhere via the sidebar profile menu. Ephemeral UI state:
    // both fields are blacklisted from persistence so a reload never reopens it.
    accountModalOpen: boolean;
    accountModalTab: AccountTab;
    /** Open the account modal, optionally jumping straight to a tab. */
    openAccountModal: (tab?: AccountTab) => void;
    closeAccountModal: () => void;
    // The signed-in user's display name — loaded once on app open and shared so the
    // chat welcome (and anything else) reads it from the store instead of fetching
    // userApi.me() per mount. null until the first load resolves.
    userName: string | null;
    fetchUserName: () => Promise<void>;
    // The full signed-in user (auth metadata + profile row), preloaded once on
    // app open and shared via the store so the account modal renders instantly
    // instead of refetching userApi.me() on every open. Refreshed in place after
    // profile edits (force) or lazily if it was never loaded.
    currentUser: any | null;
    setCurrentUser: (user: any | null) => void;
    fetchCurrentUser: (force?: boolean) => Promise<void>;
    // Workflow versions/history — loaded once when a canvas opens and kept in sync
    // via the versions bus, so opening the History panel never refetches.
    versions: any[];
    versionsLoading: boolean;
    versionsCanvasId: string | null;
    fetchVersions: (canvasId: string, force?: boolean) => Promise<void>;
    runFromNodeId: string | null;
    runMode: 'solo' | 'chain' | 'ab_test' | 'selection' | null;
    /** Targets for 'selection' mode — the set of nodes from the multi-select toolbar's Run button. */
    runSelectionIds: string[] | null;
    /**
     * True when the current run signal was already cost-confirmed by the caller
     * (the chat Run card / chat auto-run) and the SharedWorkflowEditor effect
     * should skip the credit modal. Ephemeral — never persisted (same policy as
     * runFromNodeId/runMode).
     */
    runPreconfirmed: boolean;
    triggerRunFromNode: (nodeId: string, runMode?: 'solo' | 'chain' | 'ab_test') => void;
    triggerRunSelection: (nodeIds: string[], opts?: { preconfirmed?: boolean }) => void;
    clearRunFromNode: () => void;
    /** Max credits a chat run may cost before it stops auto-running and shows a Run card. Default 10. */
    maxAutoRunCredits: number;
    setMaxAutoRunCredits: (n: number) => void;
    /**
     * Master on/off for auto-run. When false, chat never auto-starts a run
     * regardless of cost — the user always gets a Run button. When true, runs
     * auto-start while their cost is within maxAutoRunCredits. Sourced from
     * profiles.preferences.autoRunEnabled, loaded on startup. Default true.
     */
    autoRunEnabled: boolean;
    setAutoRunEnabled: (v: boolean) => void;
    /**
     * Standing composer preferences the user sets from the chat Preferences
     * panel. Every key defaults to 'auto' (no preference). Non-auto values are
     * shown as removable chips above the composer and sent to the chat brain as
     * a dynamic system block; 'auto' keys are omitted entirely so the brain
     * behaves exactly as it does today for those. Persisted across sessions via
     * profiles.preferences.chatPreferences (hydrated in ThemeProvider) and the
     * localStorage persist slice for a warm rehydrate.
     */
    chatPreferences: ChatPreferences;
    setChatPreference: (key: keyof ChatPreferences, value: string) => void;
    /**
     * Whether the user has seen the one-time auto-run intro modal. Sourced from
     * profiles.preferences.seenAutoRunIntro (once-per-user across devices),
     * loaded into the store on startup.
     */
    hasSeenAutoRunIntro: boolean;
    setHasSeenAutoRunIntro: (v: boolean) => void;
    /**
     * When true, the AutoRunIntroModal is open in config-only mode (no pending
     * run) — opened from the chat menu's "Configure" link. Ephemeral.
     */
    autoRunConfigOpen: boolean;
    openAutoRunConfig: () => void;
    closeAutoRunConfig: () => void;
    /**
     * When set, the AutoRunIntroModal is open for this pending run. Carries the
     * run plan that triggered it so the modal can run it on approve. Ephemeral —
     * never persisted.
     */
    autoRunIntro: {
        runTargetIds: string[];
        terminalIds: string[];
        cost: number;
        messageId: string;
    } | null;
    openAutoRunIntro: (payload: { runTargetIds: string[]; terminalIds: string[]; cost: number; messageId: string }) => void;
    closeAutoRunIntro: () => void;
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
     *
     * `addedNodeIds` is the strict subset of nodes CREATED this turn (from
     * `addedNodes` only — not updated nodes or edge endpoints). It drives the
     * end-of-turn measured re-layout in <AiAddedZoom />, which must reposition
     * only the genuinely new nodes and never move existing ones.
     */
    aiTurn: {
        active: boolean;
        touchedNodeIds: string[];
        addedNodeIds: string[];
        hiddenAddedIds: string[];
        patchTick: number;
    } | null;
    beginAiTurn: () => void;
    recordAiPatch: (patch: import('@/lib/workflow/workflow-patch').WorkflowPatch | null | undefined) => void;
    endAiTurn: () => void;
    revealAddedNodes: () => void;
}

export interface LivePositionSlice {
    liveNodePositions: Record<string, { x: number; y: number }>;
    setLiveNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
    clearLiveNodePosition: (nodeId: string) => void;
    clearLiveNodePositions: () => void;
    syncLivePositionsToWorkflow: () => void;
    // In-flight group-resize geometry pushed by a peer (w/h plus the anchored-
    // edge CSS shift). GroupNode reads its own entry and renders it like the
    // local liveSize/liveShift so peers see the border resize live. Cleared when
    // the committed structural state lands (applyRemoteState).
    liveNodeSizes: Record<string, { w: number; h: number; sx: number; sy: number }>;
    setLiveNodeSize: (nodeId: string, size: { w: number; h: number; sx: number; sy: number }) => void;
    clearLiveNodeSizes: () => void;
}

export interface CollaboratorPresence {
    userId: string;
    name: string;
    color: string;
    role: 'owner' | 'editor' | 'viewer';
    cursor?: { x: number; y: number };
}

export interface CollabSlice {
    collabRole: 'owner' | 'editor' | 'viewer' | null;
    // Last-known role per canvas id, used ONLY to seed `collabRole` optimistically
    // while loadSession resolves the authoritative role from the server. This
    // avoids a UI flash when entering a shared workflow: an unknown canvas seeds
    // to nothing (collabRole stays null → least-privilege UI), while a known own
    // session seeds to 'owner' so its edit affordances appear immediately. The
    // server response always overwrites collabRole, so staleness self-heals.
    // Persisted (unlike collabRole) so the seed survives a cold refresh.
    sessionRoles: Record<string, 'owner' | 'editor' | 'viewer'>;
    setSessionRole: (canvasId: string, role: 'owner' | 'editor' | 'viewer') => void;
    setSessionRoles: (roles: Record<string, 'owner' | 'editor' | 'viewer'>) => void;
    presence: Record<string, CollaboratorPresence>;
    setCollabRole: (r: CollabSlice['collabRole']) => void;
    setPresence: (p: Record<string, CollaboratorPresence>) => void;
    upsertCursor: (userId: string, cursor: { x: number; y: number }) => void;
    // Ephemeral peer selection presence (like cursors): each peer's selected
    // node ids + their in-flight marquee rectangle (flow coords). Rendered as a
    // colored overlay; NEVER touches the local user's own ReactFlow selection.
    peerSelections: Record<string, { selectedIds: string[]; marquee: { x: number; y: number; w: number; h: number } | null }>;
    setPeerSelection: (userId: string, sel: { selectedIds: string[]; marquee: { x: number; y: number; w: number; h: number } | null }) => void;
    clearPeerSelection: (userId: string) => void;
}

export type RootState = WorkflowSlice & ChatSlice & ExecutionSlice & UISlice & LivePositionSlice & CollabSlice & {
    clearAllState: () => void;
};
