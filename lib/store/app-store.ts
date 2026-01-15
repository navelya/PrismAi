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

// History snapshot interface
interface HistorySnapshot {
    workflow: Workflow | null;
    timestamp: number;
}

// App state interface
interface AppState {
    // Session Context (which chat is active)
    activeSessionId: string | null;
    setActiveSessionId: (sessionId: string | null) => void;

    // Workflow State (belongs to active session)
    currentWorkflow: Workflow | null;
    setCurrentWorkflow: (workflow: Workflow | null, saveToHistory?: boolean) => void;

    // History State (Undo/Redo)
    history: HistorySnapshot[];
    historyIndex: number;
    isDragging: boolean;
    saveSnapshot: () => void;
    undo: () => void;
    redo: () => void;
    canUndo: () => boolean;
    canRedo: () => boolean;
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
            history: [],
            historyIndex: -1,
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
            layoutEngine: 'elk', // Default layout engine

            // Session Context Actions
            setActiveSessionId: (sessionId) => {
                console.log(`[Store] 🚨 setActiveSessionId called with: ${sessionId}`);
                if (sessionId) {
                    // Trace where this call originated
                    console.trace('[Store] Trace for setting session ID:');
                }
                set({ activeSessionId: sessionId });
            },
            setCurrentWorkflow: (workflow, saveToHistory = true) => {
                const isClearing = !workflow;
                const nodeCount = workflow?.nodes?.length ?? 0;
                console.log(`[Store] 🚨 setCurrentWorkflow called! Clearing: ${isClearing}, Nodes: ${nodeCount}`);
                if (!isClearing) {
                    // Only trace when SETTING a workflow, not when clearing
                    console.trace('[Store] Trace for setting workflow:');
                }

                set((state) => ({ currentWorkflow: workflow }));
                if (saveToHistory && !get().isDragging) {
                    get().saveSnapshot();
                }
            },

            // History Actions
            saveSnapshot: () => {
                const state = get();
                if (state.isDragging) return; // Don't save during drag

                // Create snapshot but strip large data (base64 images) to avoid localStorage quota
                let workflowForSnapshot = null;
                if (state.currentWorkflow) {
                    const strippedWorkflow = {
                        ...state.currentWorkflow,
                        nodes: state.currentWorkflow.nodes.map(node => {
                            // Strip base64 images from media_input nodes (they're too large for localStorage)
                            if (node.type === 'media_input' && (node.data?.config as any)?.images) {
                                return {
                                    ...node,
                                    data: {
                                        ...node.data,
                                        config: {
                                            ...node.data.config,
                                            images: [], // Empty the images array in snapshot
                                        },
                                    },
                                };
                            }
                            return node;
                        }),
                    };
                    workflowForSnapshot = JSON.parse(JSON.stringify(strippedWorkflow));
                }

                const snapshot: HistorySnapshot = {
                    workflow: workflowForSnapshot,
                    timestamp: Date.now(),
                };

                // Remove any "future" history if we've undone and are making a new change
                const newHistory = state.history.slice(0, state.historyIndex + 1);

                // Add new snapshot
                newHistory.push(snapshot);

                // Keep only last MAX_HISTORY snapshots (circular buffer)
                const trimmedHistory = newHistory.slice(-MAX_HISTORY);

                set({
                    history: trimmedHistory,
                    historyIndex: trimmedHistory.length - 1,
                });
            },

            undo: () => {
                const state = get();
                if (!state.canUndo()) return;

                const newIndex = state.historyIndex - 1;
                const snapshot = state.history[newIndex];

                set({
                    currentWorkflow: snapshot.workflow ? JSON.parse(JSON.stringify(snapshot.workflow)) : null,
                    historyIndex: newIndex,
                });
            },

            redo: () => {
                const state = get();
                if (!state.canRedo()) return;

                const newIndex = state.historyIndex + 1;
                const snapshot = state.history[newIndex];

                set({
                    currentWorkflow: snapshot.workflow ? JSON.parse(JSON.stringify(snapshot.workflow)) : null,
                    historyIndex: newIndex,
                });
            },

            canUndo: () => {
                const state = get();
                return state.historyIndex > 0;
            },

            canRedo: () => {
                const state = get();
                return state.historyIndex < state.history.length - 1;
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
                get().saveSnapshot();
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
                get().saveSnapshot();
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
                // Snapshot will be saved after drag ends
            },

            updateNodePositions: (positions) => {
                console.log('[Store] updateNodePositions called with:', positions);
                const state = get();
                console.log('[Store] Current workflow exists?', !!state.currentWorkflow);
                if (!state.currentWorkflow) return;

                console.log('[Store] Current nodes count:', state.currentWorkflow.nodes.length);
                const updatedWorkflow: Workflow = {
                    ...state.currentWorkflow,
                    nodes: state.currentWorkflow.nodes.map((node) => {
                        const newPosition = positions.get(node.id);
                        if (newPosition) {
                            console.log(`[Store] Updating node ${node.id} from`, node.position, 'to', newPosition);
                        }
                        return newPosition ? { ...node, position: newPosition } : node;
                    }),
                };

                console.log('[Store] Setting updated workflow');
                set({ currentWorkflow: updatedWorkflow });
                console.log('[Store] Workflow set, saving snapshot');
                // Save snapshot after batch update
                get().saveSnapshot();
                console.log('[Store] Snapshot saved');
            },

            // Chat Actions
            addMessage: (message) =>
                set((state) => ({
                    chatMessages: [...state.chatMessages, message],
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
                    state.history = [];
                    state.historyIndex = -1;
                    state.nodeStatuses = {};
                    state.nodeOutputs = {};
                    state.executionResults = {};

                    // Close editor on page reload (welcome screen default)
                    if (state.editorState) {
                        state.editorState.isCanvasOpen = false;
                    }

                    console.log('[Store] Rehydrated with activeSessionId:', state.activeSessionId);
                }
            },
        }
    )
);

// Selector hooks for better performance
export const useCurrentWorkflow = () => useAppStore((state) => state.currentWorkflow);
export const useChatMessages = () => useAppStore((state) => state.chatMessages);
export const useEditorState = () => useAppStore((state) => state.editorState);
export const useCanUndo = () => useAppStore((state) => state.canUndo());
export const useCanRedo = () => useAppStore((state) => state.canRedo());
