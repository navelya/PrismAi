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
 * - isModelsLoading
 *
 * **What is NOT persisted (runtime/session state):**
 * - activeSessionId - Set fresh on session load
 * - currentWorkflow - Loaded from Supabase on demand
 * - chatMessages - Fetched from Supabase per session
 * - executionResults, nodeStatuses, nodeOutputs - DB-driven execution state.
 *   The DB (`node_results` table) is the SOLE source of truth; we never cache
 *   it client-side. On every load, getSessionExecutions fetches the current
 *   state and the realtime channel keeps it live thereafter. Until the fetch
 *   resolves, the canvas shows a "checking" indicator (see BaseNode.tsx),
 *   never a stale or invented status.
 * - copiedNode, liveNodePositions - Temporary UI state
 * - runFromNodeId, runMode - Trigger signals, MUST NOT survive refresh
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
                    executionStartTime: null,
                    nodeStatuses: {},
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
                    'nodeOutputs',
                    'activeExecutionId',
                    'copiedNode',
                    'isLoading',
                    'isLoadingSession',
                    'statusMessage',
                    'isCopilotMinimized',
                    'liveNodePositions',
                    // History does not need to survive a page refresh; persisting
                    // forces a JSON.stringify of every snapshot on every set(),
                    // including takeSnapshot()/setIsDragging() on drag start,
                    // causing visible drag-start lag.
                    'past',
                    'future',
                    // Transient UI flags. Writing localStorage every time the user
                    // touches a node is pure waste; onRehydrateStorage already
                    // resets isDragging to false anyway.
                    'isDragging',
                    'isWorkflowDirty',
                    // Ephemeral trigger signals — must NOT persist across refresh.
                    // If these survive rehydration, the useEffect in SharedWorkflowEditor
                    // re-fires the execution on every page load.
                    'runFromNodeId',
                    'runMode',
                    'menuTree',
                    'menuFlat',
                    'isMenuLoading',
                    // Ephemeral typing draft for the node label — must not persist.
                    'nodeLabelDraft',
                ].includes(key))
            ),
            onRehydrateStorage: () => (state) => {
                if (state) {
                    state.activeSessionId = null;
                    state.chatMessages = [];
                    state.isDragging = false;
                    state.nodeStatuses = {};
                    state.nodeOutputs = {};
                    state.executionResults = {};
                    state.activeExecutionId = null;
                    state.executionStartTime = null;
                    state.isCopilotMinimized = false;
                    state.isLoadingSession = false;
                    state.runFromNodeId = null;
                    state.runMode = null;
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
