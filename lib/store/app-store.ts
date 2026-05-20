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
                    // Match the slice default — clearing state shouldn't make the
                    // chat flash its empty/welcome view between a session navigation
                    // and the subsequent loadSession() call.
                    isLoadingSession: true,
                    statusMessage: null,
                    isCopilotMinimized: false,
                    models: [],
                    categories: [],
                    nodeTypes: [],
                    providers: [],
                    isModelsLoading: false,
                    runFromNodeId: null,
                    runMode: null,
                    runSelectionIds: null,
                    liveNodePositions: {},
                    selectedChatModel: undefined,
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
                    // Canvas mode is the default starting position for every
                    // page load — never restore a stale "fullscreen chat" value
                    // from a previous session.
                    'isCanvasMode',
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
                    'runSelectionIds',
                    // One-shot pan/select trigger from the Run-error popover. If it
                    // survives rehydration, the canvas would re-center on that node
                    // on every page load.
                    'pendingCenterNodeId',
                    // Transient flash window for per-node validation badges. Never
                    // persisted — refresh should always start with a clean canvas.
                    'errorFlashActive',
                    'menuTree',
                    'menuFlat',
                    'isMenuLoading',
                    // Ephemeral typing draft for the node label — must not persist.
                    'nodeLabelDraft',
                    // Ephemeral hover signal during drag-into-group — must not persist.
                    'dragHoverGroupId',
                    // Bulk-download progress — transient; never persist.
                    'bulkDownloads',
                    // AI-turn tracker — drives the camera-fit after a chat
                    // response. Resurrecting it on refresh would replay the
                    // last turn's zoom against unrelated state.
                    'aiTurn',
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
                    state.isCanvasMode = true;
                    // Keep the slice default (true) on rehydration so a refreshed
                    // session page renders skeletons until loadSession() resolves.
                    state.runFromNodeId = null;
                    state.runMode = null;
                    state.runSelectionIds = null;
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
