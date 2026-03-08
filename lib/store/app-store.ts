import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Workflow, WorkflowNode, NodeStatus } from '../nodes/types';
import { LayoutEngine } from '../utils/graph-layout';
import { sharedRegistry } from '../nodes/core/shared-registry';

// Message interface
export interface Message {
    id: string;
    type: 'user' | 'assistant';
    content: string;
    result?: any;
    workflow?: Workflow;
    images?: string[];
    timestamp: Date;
}

// Editor state interface
interface EditorState {
    zoom: number;
    viewport: { x: number; y: number };
}

// App state interface
interface AppState {
    // Session Context (Data Ownership Checksum)
    activeSessionId: string | null;
    setActiveSessionId: (sessionId: string | null) => void;
    // Workflow State (belongs to active session)
    currentWorkflow: Workflow | null;
    setCurrentWorkflow: (workflow: Workflow | null) => void;

    // History State (Undo/Redo) - MOVED TO LOCAL HOOK useUndoRedo
    isDragging: boolean;
    setIsDragging: (isDragging: boolean) => void;

    // Node Management
    copiedNode: WorkflowNode | null;
    deleteNode: (nodeId: string) => void;
    copyNode: (nodeId: string) => void;
    pasteNode: (position?: { x: number; y: number }) => void;
    updateNodePosition: (nodeId: string, position: { x: number; y: number }) => void;
    updateNodePositions: (positions: Map<string, { x: number; y: number }>) => void;

    // Chat State
    chatMessages: Message[];
    addMessage: (message: Message) => void;
    updateMessage: (id: string, updates: Partial<Message>) => void;
    clearMessages: () => void;

    // Editor State
    editorState: EditorState;
    setEditorState: (state: Partial<EditorState>) => void;

    // Execution Results
    executionResults: Record<string, any>;
    addExecutionResult: (workflowId: string, result: any) => void;
    clearExecutionResults: () => void;

    // Execution Status (Real-time updates)
    nodeStatuses: Record<string, NodeStatus>;
    setNodeStatus: (nodeId: string, status: NodeStatus) => void;
    resetNodeStatuses: () => void;

    // Advanced Execution States
    nodeDirtyStates: Record<string, boolean>; // Stale/Dirty tracker
    setNodeDirtyState: (nodeId: string, isDirty: boolean) => void;

    isComputing: Record<string, boolean>; // Utility node sync
    setIsComputing: (nodeId: string, computing: boolean) => void;

    executionLocks: Record<string, boolean>; // Race condition locks
    setExecutionLock: (nodeId: string, locked: boolean) => void;
    clearExecutionLocks: () => void;

    // Live Node Outputs (streaming results)
    nodeOutputs: Record<string, any>;
    setNodeOutput: (nodeId: string, output: any) => void;
    clearNodeOutputs: () => void;

    // Global Reset
    clearAllState: () => void;

    // Global UI Loading State
    isLoading: boolean;
    setIsLoading: (isLoading: boolean) => void;
    statusMessage: string | null;
    setStatusMessage: (message: string | null) => void;

    // Run From Node (partial execution trigger)
    runFromNodeId: string | null;
    runMode: 'solo' | 'chain' | 'ab_test' | null;
    triggerRunFromNode: (nodeId: string, runMode?: 'solo' | 'chain' | 'ab_test') => void;
    clearRunFromNode: () => void;

    // Invalidates nodes and their descendants (Partial Execution Helper)
    invalidateNodes: (nodeIds: string[]) => void;

    // Workspace view mode (canvas vs chat focus)
    isCanvasMode: boolean;
    setIsCanvasMode: (v: boolean) => void;
    isCopilotMinimized: boolean;
    setIsCopilotMinimized: (v: boolean) => void;

    // Layout Engine Preference
    layoutEngine: LayoutEngine;
    setLayoutEngine: (engine: LayoutEngine) => void;

    // Chat Scroll Persistence (Ephemeral)
    chatScrollTop: number;
    setChatScrollTop: (pos: number) => void;
}

const MAX_HISTORY = 50; // Keep last 50 snapshots

// Create the store with persistence
export const useAppStore = create<AppState>()(
    persist(
        (set, get) => ({
            // Initial State
            activeSessionId: null,
            currentWorkflow: null,
            isDragging: false,
            chatMessages: [],
            isCanvasMode: false,
            isCopilotMinimized: false,
            editorState: {
                zoom: 0.8,
                viewport: { x: 0, y: 0 },
            },
            executionResults: {},
            nodeStatuses: {}, // Initialize empty status map
            nodeDirtyStates: {},
            isComputing: {},
            executionLocks: {},
            nodeOutputs: {}, // Initialize empty outputs map
            copiedNode: null, // Initialize copied node as null
            runFromNodeId: null, // No partial execution pending
            runMode: null, // Execution targeting modifier
            layoutEngine: 'elk', // Default layout engine
            isLoading: false,
            statusMessage: null,

            chatScrollTop: 9999999,
            setChatScrollTop: (pos) => set({ chatScrollTop: pos }),

            // Global Reset
            clearAllState: () => {
                set({
                    activeSessionId: null,
                    currentWorkflow: null,
                    chatMessages: [],
                    editorState: {
                        zoom: 1,
                        viewport: { x: 0, y: 0 },
                    },
                    executionResults: {},
                    nodeStatuses: {},
                    nodeDirtyStates: {},
                    isComputing: {},
                    executionLocks: {},
                    nodeOutputs: {},
                    copiedNode: null,
                    runFromNodeId: null,
                    runMode: null,
                    isLoading: false,
                    statusMessage: null,
                    isCanvasMode: false,
                    isCopilotMinimized: false,
                    chatScrollTop: 9999999,
                });
            },

            // Session Context Actions
            setActiveSessionId: (sessionId) => {
                set({ activeSessionId: sessionId });
            },
            setCurrentWorkflow: (workflow) => {
                if (workflow && workflow.nodes) {
                    workflow.nodes = workflow.nodes.map((node) => {
                        const def = sharedRegistry[node.type];
                        if (def && def.defaultConfig) {
                            node.data = {
                                ...node.data,
                                config: { ...def.defaultConfig, ...(node.data?.config || {}) }
                            };
                        }
                        // 🛡️ CRASH PREVENTION: Ensure every node has a valid position
                        if (!node.position) {
                            node.position = { x: 0, y: 0 };
                        }
                        return node;
                    });
                }
                set((state) => ({ currentWorkflow: workflow }));
            },

            setIsDragging: (isDragging) => set({ isDragging }),

            // Node Management
            deleteNode: (nodeId) => {
                const state = get();
                if (!state.currentWorkflow) return;

                const updatedWorkflow: Workflow = {
                    ...state.currentWorkflow,
                    nodes: state.currentWorkflow.nodes.filter((node) => node.id !== nodeId),
                    edges: state.currentWorkflow.edges.filter(
                        (edge) => edge.source !== nodeId && edge.target !== nodeId
                    ),
                };

                set({ currentWorkflow: updatedWorkflow });
            },

            copyNode: (nodeId) => {
                const state = get();
                if (!state.currentWorkflow) return;

                const nodeToCopy = state.currentWorkflow.nodes.find((node) => node.id === nodeId);
                if (nodeToCopy) {
                    // Deep copy the node
                    set({ copiedNode: JSON.parse(JSON.stringify(nodeToCopy)) });
                }
            },

            pasteNode: (position) => {
                const state = get();
                if (!state.currentWorkflow || !state.copiedNode) return;

                // Create new node with unique ID and offset position
                const newNode: WorkflowNode = {
                    ...JSON.parse(JSON.stringify(state.copiedNode)),
                    id: `node_${Date.now()}`,
                    position: position || {
                        x: state.copiedNode.position.x + 50,
                        y: state.copiedNode.position.y + 50,
                    },
                };

                const updatedWorkflow: Workflow = {
                    ...state.currentWorkflow,
                    nodes: [...state.currentWorkflow.nodes, newNode],
                };

                set({ currentWorkflow: updatedWorkflow });
            },

            updateNodePosition: (nodeId, position) => {
                const state = get();
                if (!state.currentWorkflow) return;

                const updatedWorkflow: Workflow = {
                    ...state.currentWorkflow,
                    nodes: state.currentWorkflow.nodes.map((node) =>
                        node.id === nodeId ? { ...node, position } : node
                    ),
                };

                set({ currentWorkflow: updatedWorkflow });
            },

            updateNodePositions: (positions) => {
                const state = get();
                if (!state.currentWorkflow) return;

                const updatedWorkflow: Workflow = {
                    ...state.currentWorkflow,
                    nodes: state.currentWorkflow.nodes.map((node) => {
                        const newPosition = positions.get(node.id);
                        return newPosition ? { ...node, position: newPosition } : node;
                    }),
                };

                set({ currentWorkflow: updatedWorkflow });
            },

            // Chat Actions
            addMessage: (message) =>
                set((state) => ({
                    chatMessages: [...state.chatMessages, message],
                })),

            updateMessage: (id, updates) =>
                set((state) => ({
                    chatMessages: state.chatMessages.map((msg) =>
                        msg.id === id ? { ...msg, ...updates } : msg
                    ),
                })),

            clearMessages: () => set({ chatMessages: [] }),

            // Editor Actions
            setEditorState: (newState) =>
                set((state) => ({
                    editorState: { ...state.editorState, ...newState },
                })),

            // Execution Results
            addExecutionResult: (workflowId, result) =>
                set((state) => ({
                    executionResults: {
                        ...state.executionResults,
                        [workflowId]: result,
                    },
                })),

            clearExecutionResults: () => set({ executionResults: {} }),

            // Node Status Actions (Real-time execution updates)
            setNodeStatus: (nodeId, status) =>
                set((state) => ({
                    nodeStatuses: {
                        ...state.nodeStatuses,
                        [nodeId]: status,
                    },
                })),

            resetNodeStatuses: () => set({ nodeStatuses: {} }),

            // Advanced Execution States
            setNodeDirtyState: (nodeId, isDirty) =>
                set((state) => ({
                    nodeDirtyStates: {
                        ...state.nodeDirtyStates,
                        [nodeId]: isDirty,
                    },
                })),

            setIsComputing: (nodeId, computing) =>
                set((state) => ({
                    isComputing: {
                        ...state.isComputing,
                        [nodeId]: computing,
                    },
                })),

            setExecutionLock: (nodeId, locked) =>
                set((state) => ({
                    executionLocks: {
                        ...state.executionLocks,
                        [nodeId]: locked,
                    },
                })),

            clearExecutionLocks: () => set({ executionLocks: {} }),

            // Live Node Output Actions (streaming results)
            setNodeOutput: (nodeId, output) =>
                set((state) => ({
                    nodeOutputs: {
                        ...state.nodeOutputs,
                        [nodeId]: output,
                    },
                })),

            clearNodeOutputs: () => set({ nodeOutputs: {} }),

            // Run From Node Actions
            triggerRunFromNode: (nodeId, mode = 'chain') => set({ runFromNodeId: nodeId, runMode: mode }),
            clearRunFromNode: () => set({ runFromNodeId: null, runMode: null }),

            // Invalidates nodes and their descendants (Partial Execution Helper)
            invalidateNodes: (nodeIds) => {
                const state = get();
                if (!state.currentWorkflow) return;

                // 1. Identify the target nodes AND all their descendants (recursive)
                const { getDescendants } = require('../utils/graph-traversal');
                const allDirtyNodes = new Set<string>();

                nodeIds.forEach(id => {
                    // Include the target node itself — not just its children!
                    allDirtyNodes.add(id);
                    const descendants = getDescendants(id, state.currentWorkflow!.edges);
                    descendants.forEach((d: string) => allDirtyNodes.add(d));
                });

                // 2. Clear status and output for these nodes ONLY
                const newStatuses = { ...state.nodeStatuses };
                const newOutputs = { ...state.nodeOutputs };

                allDirtyNodes.forEach((id) => {
                    delete newStatuses[id];
                    delete newOutputs[id];
                });

                set({
                    nodeStatuses: newStatuses,
                    nodeOutputs: newOutputs,
                });
            },

            // Workspace view mode
            setIsCanvasMode: (v) => set({ isCanvasMode: v }),
            setIsCopilotMinimized: (v) => set({ isCopilotMinimized: v }),

            // Layout Engine Actions
            setLayoutEngine: (engine) => set({ layoutEngine: engine }),

            setIsLoading: (isLoading) => set({ isLoading }),
            setStatusMessage: (statusMessage) => set({ statusMessage }),
        }),
        {
            name: 'prism-ai-storage',
            storage: createJSONStorage(() => localStorage),
            // Partially serialize state - strictly block all massive ephemeral objects (workflows, messages, images) from hitting the 5MB localStorage limit.
            partialize: (state) => Object.fromEntries(
                Object.entries(state).filter(([key]) => ![
                    'activeSessionId',
                    'currentWorkflow',
                    'chatMessages',
                    'executionResults',
                    'nodeStatuses',
                    'nodeDirtyStates',
                    'isComputing',
                    'executionLocks',
                    'nodeOutputs',
                    'copiedNode',
                    'isLoading',
                    'statusMessage',
                    'isCopilotMinimized', // ephemeral per-session, reset on reload
                ].includes(key))
            ),
            // Clean slate on page refresh - session loading will restore state
            onRehydrateStorage: () => (state) => {
                if (state) {
                    state.activeSessionId = null;
                    state.chatMessages = [];
                    state.isDragging = false;
                    state.currentWorkflow = null;
                    state.nodeStatuses = {};
                    state.nodeDirtyStates = {};
                    state.isComputing = {};
                    state.executionLocks = {};
                    state.nodeOutputs = {};
                    state.executionResults = {};
                    state.isCopilotMinimized = false;
                    if (state.editorState) {
                        // editorState no longer has isCanvasOpen
                    }
                }
            },
        }
    )
);

export const useCurrentWorkflow = () => useAppStore((state) => state.currentWorkflow);
export const useChatMessages = () => useAppStore((state) => state.chatMessages);
export const useEditorState = () => useAppStore((state) => state.editorState);
