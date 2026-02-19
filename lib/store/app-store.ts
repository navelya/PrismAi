import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Workflow, WorkflowNode, NodeStatus } from '../nodes/types';
import { LayoutEngine } from '../utils/graph-layout';

// Message interface
interface Message {
    id: string;
    type: 'user' | 'assistant';
    content: string;
    result?: any;
    workflow?: Workflow;
    timestamp: Date;
}

// Editor state interface
interface EditorState {
    isCanvasOpen: boolean;
    splitRatio: number;
    zoom: number;
    viewport: { x: number; y: number };
}

// App state interface
interface AppState {
    // Session Context (which chat is active)
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

    // Live Node Outputs (streaming results)
    nodeOutputs: Record<string, any>;
    setNodeOutput: (nodeId: string, output: any) => void;
    clearNodeOutputs: () => void;

    // Run From Node (partial execution trigger)
    runFromNodeId: string | null;
    triggerRunFromNode: (nodeId: string) => void;
    clearRunFromNode: () => void;

    // Invalidates nodes and their descendants (Partial Execution Helper)
    invalidateNodes: (nodeIds: string[]) => void;

    // Layout Engine Preference
    layoutEngine: LayoutEngine;
    setLayoutEngine: (engine: LayoutEngine) => void;
}

const MAX_HISTORY = 50; // Keep last 50 snapshots

// Create the store with persistence
export const useAppStore = create<AppState>()(
    persist(
        (set, get) => ({
            // Initial State
            activeSessionId: null, // No active session initially
            currentWorkflow: null,
            isDragging: false,
            chatMessages: [],
            editorState: {
                isCanvasOpen: false,
                splitRatio: 50,
                zoom: 0.8,
                viewport: { x: 0, y: 0 },
            },
            executionResults: {},
            nodeStatuses: {}, // Initialize empty status map
            nodeOutputs: {}, // Initialize empty outputs map
            copiedNode: null, // Initialize copied node as null
            runFromNodeId: null, // No partial execution pending
            layoutEngine: 'elk', // Default layout engine

            // Session Context Actions
            setActiveSessionId: (sessionId) => {
                set({ activeSessionId: sessionId });
            },
            setCurrentWorkflow: (workflow) => {
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
            triggerRunFromNode: (nodeId) => set({ runFromNodeId: nodeId }),
            clearRunFromNode: () => set({ runFromNodeId: null }),

            // Invalidates nodes and their descendants (Partial Execution Helper)
            invalidateNodes: (nodeIds) => {
                const state = get();
                if (!state.currentWorkflow) return;

                // 1. Identify all descendants (recursive)
                const { getDescendants } = require('../utils/graph-traversal');
                const allDirtyNodes = new Set<string>();

                nodeIds.forEach(id => {
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
                    // Do NOT trigger runFromNodeId automatically
                });
            },

            // Layout Engine Actions
            setLayoutEngine: (engine) => set({ layoutEngine: engine }),
        }),
        {
            name: 'prism-ai-storage',
            storage: createJSONStorage(() => localStorage),
            // Only persist minimal state - workflows load on-demand from DB
            partialize: (state) => ({
                // Session context - persist so Editor knows which chat was last active
                activeSessionId: state.activeSessionId,
                // Don't persist currentWorkflow - it loads from DB per-session
                // Don't persist chatMessages or executionResults - too large
                editorState: state.editorState,
                layoutEngine: state.layoutEngine, // Persist layout preference
            }),
            // Clean slate on page refresh - session loading will restore state
            onRehydrateStorage: () => (state) => {
                if (state) {
                    // Clear transient state on page reload
                    state.chatMessages = [];
                    state.isDragging = false;

                    // Clear workflow - will be loaded from DB based on activeSessionId
                    state.currentWorkflow = null;
                    state.nodeStatuses = {};
                    state.nodeOutputs = {};
                    state.executionResults = {};

                    // Close editor on page reload (welcome screen default)
                    if (state.editorState) {
                        state.editorState.isCanvasOpen = false;
                    }
                }
            },
        }
    )
);

export const useCurrentWorkflow = () => useAppStore((state) => state.currentWorkflow);
export const useChatMessages = () => useAppStore((state) => state.chatMessages);
export const useEditorState = () => useAppStore((state) => state.editorState);
