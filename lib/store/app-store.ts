import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createWorkflowSlice } from './slices/workflow-slice';
import { createChatSlice } from './slices/chat-slice';
import { createExecutionSlice } from './slices/execution-slice';
import { createUISlice } from './slices/ui-slice';
import { createLivePositionSlice } from './slices/live-position-slice';
import { RootState, Message, WorkflowSlice, ChatSlice, ExecutionSlice, UISlice, LivePositionSlice } from './types';

export { type Message };

/**
 * Prism AI Global State Store
 * 
 * Multi-slice Zustand store with localStorage persistence.
 * 
 * Storage Strategy:
 * 
 * **What IS persisted to localStorage (via Zustand persist):**
 * - editorState (zoom, viewport)
 * - isCanvasMode
 * - models, categories, nodeTypes, providers (catalog cache)
 * - isDragging (UI state)
 * - isModelsLoading
 * - runFromNodeId, runMode
 * 
 * **What is NOT persisted (runtime/session state):**
 * - activeSessionId - Set fresh on session load
 * - currentWorkflow - Loaded from Supabase on demand
 * - chatMessages - Fetched from Supabase per session
 * - executionResults, nodeStatuses, nodeOutputs - Ephemeral execution state
 * - copiedNode, liveNodePositions - Temporary UI state
 * 
 * **Why separate from IndexedDB backups?**
 * - localStorage (this): UI preferences, fast sync access
 * - IndexedDB (localforage): Large workflow snapshots, async operations
 * - Supabase: Canonical source of truth, cross-device sync
 */

export const useAppStore = create<RootState>()(
    persist(
        (set, get, api) => ({
            ...createWorkflowSlice(set, get, api),
            ...createChatSlice(set, get, api),
            ...createExecutionSlice(set, get, api),
            ...createUISlice(set, get, api),
            ...createLivePositionSlice(set, get, api),

            clearAllState: () => {
                set({
                    activeSessionId: null,
                    currentWorkflow: null,
                    isDragging: false,
                    copiedNode: null,
                    chatMessages: [],
                    chatScrollTop: 9999999,
                    executionResults: {},
                    activeExecutionId: null,
                    nodeStatuses: {},
                    nodeDirtyStates: {},
                    isComputing: {},
                    executionLocks: {},
                    nodeOutputs: {},
                    editorState: {
                        zoom: 1,
                        viewport: { x: 0, y: 0 },
                    },
                    isLoading: false,
                    isLoadingSession: false,
                    statusMessage: null,
                    isCanvasMode: false,
                    isCopilotMinimized: false,
                    models: [],
                    categories: [],
                    nodeTypes: [],
                    providers: [],
                    isModelsLoading: false,
                    runFromNodeId: null,
                    runMode: null,
                    liveNodePositions: {},
                });
            },
        }),
        {
            name: 'prism-ai-storage',
            storage: createJSONStorage(() => localStorage),
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
                    'activeExecutionId',
                    'copiedNode',
                    'isLoading',
                    'isLoadingSession',
                    'statusMessage',
                    'isCopilotMinimized',
                    'liveNodePositions',
                ].includes(key))
            ),
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
                    state.activeExecutionId = null;
                    state.isCopilotMinimized = false;
                    state.isLoadingSession = false;
                }
            },
        }
    )
);

// Re-export nested selectors for convenience/BC
import { useShallow } from 'zustand/react/shallow';

export const useCurrentWorkflow = () => useAppStore((state) => state.currentWorkflow);
export const useChatMessages = () => useAppStore(useShallow((state) => {
    if (!state.activeSessionId) return state.chatMessages;
    return state.chatMessages.filter(m => m.sessionId === state.activeSessionId);
}));
export const useEditorState = () => useAppStore((state) => state.editorState);
