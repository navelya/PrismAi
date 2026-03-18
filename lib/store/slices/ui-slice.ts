import { StateCreator } from 'zustand';
import { RootState, UISlice } from '../types';

export const createUISlice: StateCreator<RootState, [], [], UISlice> = (set, get) => ({
    editorState: {
        zoom: 0.8,
        viewport: { x: 0, y: 0 },
    },
    isLoading: false,
    statusMessage: null,
    isCanvasMode: false,
    isCopilotMinimized: false,
    lastInteraction: Date.now(),
    models: [],
    categories: [],
    nodeTypes: [],
    providers: [],
    isModelsLoading: false,
    runFromNodeId: null,
    runMode: null,

    setEditorState: (newState) =>
        set((state) => ({
            editorState: { ...state.editorState, ...newState },
        })),

    setIsLoading: (isLoading) => set({ isLoading }),
    setStatusMessage: (statusMessage) => set({ statusMessage }),
    setIsCanvasMode: (v) => set({ isCanvasMode: v }),
    setIsCopilotMinimized: (v) => set({ isCopilotMinimized: v }),
    touchInteraction: () => set({ lastInteraction: Date.now() }),

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

    triggerRunFromNode: (nodeId, mode = 'chain') => set({ runFromNodeId: nodeId, runMode: mode }),
    clearRunFromNode: () => set({ runFromNodeId: null, runMode: null }),

    deleteNodeWithAssets: async (nodeId: string) => {
        const state = get();
        const { activeSessionId, currentWorkflow, nodeOutputs } = state;

        state.cleanupNodeMetadata(nodeId);

        const targetNode = currentWorkflow?.nodes.find((n) => n.id === nodeId);
        const hasImagesInConfig = (targetNode?.data?.config as any)?.images?.length > 0;
        const hasImagesInOutput = nodeOutputs?.[nodeId]?.some?.((item: any) => item.url);
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
