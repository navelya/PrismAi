import { StateCreator } from 'zustand';
import { RootState, UISlice } from '../types';
import { toLegacyRenderableOutput } from '@/lib/workflow/result-format';

export const createUISlice: StateCreator<RootState, [], [], UISlice> = (set, get) => ({
    editorState: {
        zoom: 0.8,
        viewport: { x: 0, y: 0 },
    },
    isLoading: false,
    // Default true so a session page renders skeletons on the very first paint
    // instead of flashing the empty/welcome state before loadSession() runs.
    // The welcome page (no session) clears this via clearAllState().
    isLoadingSession: true,
    statusMessage: null,
    isCanvasMode: true,
    isCopilotMinimized: false,
    lastInteraction: Date.now(),
    nodeLabelDraft: null,
    models: [],
    categories: [],
    nodeTypes: [],
    providers: [],
    dataTypes: [],
    isModelsLoading: false,
    runFromNodeId: null,
    runMode: null,
    menuTree: [],
    menuFlat: [],
    isMenuLoading: false,
    dragHoverGroupId: null,

    aiTurn: null,
    beginAiTurn: () =>
        set({ aiTurn: { active: true, touchedNodeIds: [], patchTick: 0 } }),
    recordAiPatch: (patch) => {
        if (!patch) return;
        const current = get().aiTurn;
        if (!current || !current.active) return;

        const next = new Set(current.touchedNodeIds);
        for (const n of patch.addedNodes || []) next.add(n.id);
        for (const u of patch.updatedNodes || []) next.add(u.id);
        for (const e of patch.addedEdges || []) {
            if (e.source) next.add(e.source);
            if (e.target) next.add(e.target);
        }

        set({
            aiTurn: {
                active: true,
                touchedNodeIds: Array.from(next),
                patchTick: current.patchTick + 1,
            },
        });
    },
    endAiTurn: () => {
        const current = get().aiTurn;
        if (!current) return;
        set({ aiTurn: { ...current, active: false } });
    },

    // Bulk-download progress (multi-select toolbar → "Download selected").
    // Map keyed by per-call operation id so concurrent downloads each get
    // their own pill in the EditorToolbar next to the Run button.
    bulkDownloads: {},
    setBulkDownloadProgress: (id, state) =>
        set((s) => ({ bulkDownloads: { ...s.bulkDownloads, [id]: state } })),
    clearBulkDownload: (id) =>
        set((s) => {
            if (!(id in s.bulkDownloads)) return s;
            const next = { ...s.bulkDownloads };
            delete next[id];
            return { bulkDownloads: next };
        }),

    setEditorState: (newState) =>
        set((state) => ({
            editorState: { ...state.editorState, ...newState },
        })),

    setIsLoading: (isLoading) => set({ isLoading }),
    setIsLoadingSession: (isLoadingSession) => set({ isLoadingSession }),
    setStatusMessage: (statusMessage) => set({ statusMessage }),
    setIsCanvasMode: (v) => set({ isCanvasMode: v }),
    setIsCopilotMinimized: (v) => set({ isCopilotMinimized: v }),
    touchInteraction: () => set({ lastInteraction: Date.now() }),
    setNodeLabelDraft: (draft) => set({ nodeLabelDraft: draft }),

    fetchModelCatalog: async () => {
        if (get().models.length > 0) return;
        set({ isModelsLoading: true });
        try {
            const response = await fetch('/api/models/list');
            const data = await response.json();
            set({ models: data.models || [], isModelsLoading: false });
        } catch (error) {
            console.error('Failed to fetch model catalog:', error);
            set({ isModelsLoading: false });
        }
    },

    fetchModels: async () => {
        if (get().models.length > 0) return;
        try {
            const response = await fetch('/api/models/list');
            const data = await response.json();
            set({ models: data.models || [] });
        } catch (error) {
            console.error('Failed to fetch models:', error);
        }
    },

    fetchCategories: async () => {
        if (get().categories.length > 0) return;
        try {
            const { modelsAdminApi } = await import('@/lib/api/admin');
            const data = await modelsAdminApi.listCategories();
            set({ categories: data || [] });
        } catch (error) {
            console.error('Failed to fetch categories:', error);
        }
    },

    fetchNodeTypes: async () => {
        if (get().nodeTypes.length > 0) return;
        try {
            const { modelsAdminApi } = await import('@/lib/api/admin');
            const data = await modelsAdminApi.listNodeTypes();
            set({ nodeTypes: data || [] });
        } catch (error) {
            console.error('Failed to fetch node types:', error);
        }
    },

    fetchProviders: async () => {
        if (get().providers.length > 0) return;
        try {
            const { modelsAdminApi } = await import('@/lib/api/admin');
            const data = await modelsAdminApi.listProviders();
            set({ providers: data || [] });
        } catch (error) {
            console.error('Failed to fetch providers:', error);
        }
    },
    fetchDataTypes: async () => {
        if (get().dataTypes.length > 0) return;
        try {
            const { modelsAdminApi } = await import('@/lib/api/admin');
            const data = await modelsAdminApi.listDataTypes();
            set({ dataTypes: data || [] });
        } catch (error) {
            console.error('Failed to fetch data types:', error);
        }
    },

    triggerRunFromNode: (nodeId, mode = 'chain') => set({ runFromNodeId: nodeId, runMode: mode }),
    clearRunFromNode: () => set({ runFromNodeId: null, runMode: null }),

    setDragHoverGroupId: (id) => {
        // Drag handlers call this on every frame; skip the store write (and
        // its subscriber-notify loop) when the value is unchanged.
        if (get().dragHoverGroupId === id) return;
        set({ dragHoverGroupId: id });
    },

    fetchMenuData: async (force = false) => {
        if (!force && get().menuTree.length > 0) return;
        set({ isMenuLoading: true });
        try {
            const response = await fetch('/api/canvas/context-menu', { cache: 'no-store' });
            const data = await response.json();
            set({ 
                menuTree: data.tree || [], 
                menuFlat: data.flat || [],
                isMenuLoading: false 
            });
        } catch (error) {
            console.error('Failed to fetch menu data:', error);
            set({ isMenuLoading: false });
        }
    },

    deleteNodeWithAssets: async (nodeId: string) => {
        const state = get();
        const { activeSessionId, currentWorkflow, nodeOutputs } = state;

        state.cleanupNodeMetadata(nodeId);

        const targetNode = currentWorkflow?.nodes.find((n) => n.id === nodeId);
        const hasImagesInConfig = (targetNode?.data?.config as any)?.images?.length > 0;
        const output = toLegacyRenderableOutput(nodeOutputs?.[nodeId]);
        const hasImagesInOutput = Array.isArray(output) && output.some((item: any) => item?.url);
        const hasAssets = hasImagesInConfig || hasImagesInOutput;

        if (!hasAssets) return;

        (async () => {
            try {
                const { userApi, uploadApi } = await import('@/lib/api/client');
                const { user } = await userApi.me();
                if (user && activeSessionId) {
                    const folderPath = `${user.id}/${activeSessionId}/thumbnails/${nodeId}`;
                    await uploadApi.deleteFolder(folderPath);
                }
            } catch (err) {
                console.error('Failed to cleanup node assets in background:', err);
            }
        })();
    },
});
