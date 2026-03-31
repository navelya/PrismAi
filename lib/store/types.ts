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
    appendNodeStream: (node: WorkflowNode) => void;
    appendEdgeStream: (edge: any) => void;
    isDragging: boolean;
    setIsDragging: (isDragging: boolean) => void;
    copiedNode: WorkflowNode | null;
    copyNode: (nodeId: string) => void;
    pasteNode: (position?: { x: number; y: number }) => void;
    updateNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
    updateNodePositions: (positions: Map<string, { x: number; y: number }>) => void;
    isWorkflowDirty: boolean;
    setWorkflowDirty: (isDirty: boolean) => void;
}

export interface ChatSlice {
    chatMessages: Message[];
    addMessage: (message: Message) => void;
    updateMessage: (id: string, updates: Partial<Message>) => void;
    clearMessages: () => void;
    chatScrollTop: number;
    setChatScrollTop: (pos: number) => void;
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
    models: AiModel[];
    categories: any[];
    nodeTypes: any[];
    providers: any[];
    isModelsLoading: boolean;
    fetchModelCatalog: () => Promise<void>;
    fetchCategories: () => Promise<void>;
    fetchNodeTypes: () => Promise<void>;
    fetchProviders: () => Promise<void>;
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
