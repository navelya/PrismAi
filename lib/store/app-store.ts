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
 * - activeSessionId, activeExecutionId — last-known session/execution pointer
 * - nodeStatuses, nodeOutputs — last-known DB state for the current session.
 *   The DB (`node_results` table) is the source of truth; we cache the latest
 *   view client-side so refresh / back-nav paints the correct status on the
 *   first frame instead of flashing 'idle'. The page-level session-id check
 *   ([app/chat/[id]/page.tsx]) wipes them when the URL session id ≠ persisted
 *   activeSessionId, so a stale session's status never bleeds into a new one.
 *
 * **What is NOT persisted (runtime/session state):**
 * - currentWorkflow - Loaded from Supabase on demand
 * - chatMessages - Fetched from Supabase per session
 * - executionResults - Summary state, recomputed on load
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
                    // activeSessionId, activeExecutionId, nodeStatuses, nodeOutputs
                    // are intentionally PERSISTED — see store doc comment.
                    'currentWorkflow',
                    'chatMessages',
                    'executionResults',
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
                ].includes(key))
            ),
            onRehydrateStorage: () => (state) => {
                if (state) {
                    // activeSessionId, activeExecutionId, nodeStatuses, nodeOutputs
                    // intentionally NOT cleared — the page-level session-id mismatch
                    // check ([app/chat/[id]/page.tsx]) wipes them via clearAllState
                    // when the URL session ≠ persisted session, so a stale session's
                    // state never bleeds into a new one.
                    state.chatMessages = [];
                    state.isDragging = false;
                    state.executionResults = {};
                    // executionStartTime drives elapsed-time UI; a stale value would
                    // claim the current run took hours. Always reset on load.
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
