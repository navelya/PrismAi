import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Workflow, WorkflowNode } from '../nodes/types';

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
    // Workflow State
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
    deleteNode: (nodeId: string) => void;
    updateNodePosition: (nodeId: string, position: { x: number; y: number }) => void;

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
}

const MAX_HISTORY = 50; // Keep last 50 snapshots

// Create the store with persistence
export const useAppStore = create<AppState>()(
    persist(
        (set, get) => ({
            // Initial State
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

            // Workflow Actions
            setCurrentWorkflow: (workflow, saveToHistory = true) => {
                set({ currentWorkflow: workflow });
                if (saveToHistory && !get().isDragging) {
                    get().saveSnapshot();
                }
            },

            // History Actions
            saveSnapshot: () => {
                const state = get();
                if (state.isDragging) return; // Don't save during drag

                const snapshot: HistorySnapshot = {
                    workflow: state.currentWorkflow ? JSON.parse(JSON.stringify(state.currentWorkflow)) : null,
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
        }),
        {
            name: 'prism-ai-storage',
            storage: createJSONStorage(() => localStorage), // Changed to localStorage for persistence
            // Don't persist functions, only data
            partialize: (state) => ({
                currentWorkflow: state.currentWorkflow,
                history: state.history,
                historyIndex: state.historyIndex,
                chatMessages: state.chatMessages,
                editorState: state.editorState,
                executionResults: state.executionResults,
            }),
            // Clear messages on page refresh but keep other state
            onRehydrateStorage: () => (state) => {
                if (state) {
                    // Clear chat messages on page reload
                    state.chatMessages = [];
                    // Ensure isDragging is false on reload
                    state.isDragging = false;
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
