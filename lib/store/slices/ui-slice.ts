import { StateCreator } from 'zustand';
import { RootState, UISlice, DEFAULT_CHAT_PREFERENCES } from '../types';
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
    isChatFullscreen: false,
    isMobileCanvasOpen: false,
    lastInteraction: Date.now(),
    nodeLabelDraft: null,
    models: [],
    categories: [],
    nodeTypes: [],
    providers: [],
    dataTypes: [],
    isModelsLoading: false,
    templates: [],
    isTemplatesLoading: false,
    templatesLoaded: false,
    templateWorkflows: {},
    templateWorkflowLoading: {},
    creditBreakdown: null,
    isCreditBreakdownLoading: false,
    sidebarExpanded: false,
    accountModalOpen: false,
    accountModalTab: 'profile',
    userName: null,
    currentUser: null,
    versions: [],
    versionsLoading: false,
    versionsCanvasId: null,
    runFromNodeId: null,
    runMode: null,
    runSelectionIds: null,
    runPreconfirmed: false,
    maxAutoRunCredits: 10,
    autoRunEnabled: true,
    chatPreferences: { ...DEFAULT_CHAT_PREFERENCES },
    hasSeenAutoRunIntro: false,
    autoRunIntro: null,
    autoRunConfigOpen: false,
    menuTree: [],
    menuFlat: [],
    isMenuLoading: false,
    dragHoverGroupId: null,

    aiTurn: null,
    beginAiTurn: () =>
        set({ aiTurn: { active: true, touchedNodeIds: [], addedNodeIds: [], patchTick: 0 } }),
    recordAiPatch: (patch) => {
        if (!patch) return;
        const current = get().aiTurn;
        if (!current || !current.active) return;

        const next = new Set(current.touchedNodeIds);
        // addedNodeIds tracks ONLY created nodes — the re-layout must reposition
        // these and leave updated/endpoint (existing) nodes anchored in place.
        const added = new Set(current.addedNodeIds);
        for (const n of patch.addedNodes || []) { next.add(n.id); added.add(n.id); }
        for (const u of patch.updatedNodes || []) next.add(u.id);
        for (const e of patch.addedEdges || []) {
            if (e.source) next.add(e.source);
            if (e.target) next.add(e.target);
        }

        set({
            aiTurn: {
                active: true,
                touchedNodeIds: Array.from(next),
                addedNodeIds: Array.from(added),
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
    setIsChatFullscreen: (v) => set({ isChatFullscreen: v }),
    setIsMobileCanvasOpen: (v) => set({ isMobileCanvasOpen: v }),
    touchInteraction: () => set({ lastInteraction: Date.now() }),
    setNodeLabelDraft: (draft) => set({ nodeLabelDraft: draft }),

    fetchModelCatalog: async () => {
        // Stale-while-revalidate: the persisted catalog (if any) is already
        // rendering, so we revalidate in the background instead of early-
        // returning. The early-return left clients pinned to the localStorage
        // snapshot, so an admin edit to a model's inputs_schema/handles never
        // showed on the canvas — even after a hard refresh, which clears the
        // HTTP cache but NOT localStorage. Only show the loader on a cold start
        // (no cache) and only overwrite `models` once fresh data lands, so a
        // warm canvas never flashes an empty handle list.
        const hasCache = get().models.length > 0;
        if (!hasCache) set({ isModelsLoading: true });
        try {
            const response = await fetch('/api/models/list');
            const data = await response.json();
            if (data.models) set({ models: data.models });
        } catch (error) {
            console.error('Failed to fetch model catalog:', error);
        } finally {
            if (!hasCache) set({ isModelsLoading: false });
        }
    },

    fetchModels: async () => {
        // Stale-while-revalidate — see fetchModelCatalog. Always refetch so
        // model edits surface after one normal reload; keep the cached `models`
        // until fresh data arrives so the handle list never blanks.
        try {
            const response = await fetch('/api/models/list');
            const data = await response.json();
            if (data.models) set({ models: data.models });
        } catch (error) {
            console.error('Failed to fetch models:', error);
        }
    },

    // Catalog fetchers below are stale-while-revalidate, NOT early-return.
    // These lists are persisted to localStorage (see app-store persist), which
    // survives a hard refresh (only the HTTP cache is cleared). A `length > 0`
    // early-return therefore pinned clients to the localStorage snapshot
    // forever: a newly added provider/category/node-type/data-type never
    // surfaced — the add-node panel browses models *through* their provider
    // row, so a model on a brand-new (and thus missing) provider was also
    // unreachable. Always refetch and overwrite once fresh data lands; keep the
    // cached list until then so a warm panel never flashes empty. This mirrors
    // the same fix already applied to fetchModelCatalog/fetchModels above.
    fetchCategories: async () => {
        try {
            const { modelsAdminApi } = await import('@/lib/api/admin');
            const data = await modelsAdminApi.listCategories();
            if (data) set({ categories: data });
        } catch (error) {
            console.error('Failed to fetch categories:', error);
        }
    },

    fetchNodeTypes: async () => {
        try {
            const { modelsAdminApi } = await import('@/lib/api/admin');
            const data = await modelsAdminApi.listNodeTypes();
            if (data) set({ nodeTypes: data });
        } catch (error) {
            console.error('Failed to fetch node types:', error);
        }
    },

    fetchProviders: async () => {
        try {
            const { modelsAdminApi } = await import('@/lib/api/admin');
            const data = await modelsAdminApi.listProviders();
            if (data) set({ providers: data });
        } catch (error) {
            console.error('Failed to fetch providers:', error);
        }
    },
    fetchDataTypes: async () => {
        try {
            const { modelsAdminApi } = await import('@/lib/api/admin');
            const data = await modelsAdminApi.listDataTypes();
            if (data) set({ dataTypes: data });
        } catch (error) {
            console.error('Failed to fetch data types:', error);
        }
    },

    // Templates: load once per app session (early-return when already loaded).
    // `force` refetches after an admin mutation so the gallery/modal stay current.
    fetchTemplates: async (force = false) => {
        if (!force && get().templatesLoaded) return;
        if (!get().templatesLoaded) set({ isTemplatesLoading: true });
        try {
            const res = await fetch('/api/templates');
            const data = await res.json();
            if (res.ok) set({ templates: data.templates || [], templatesLoaded: true });
        } catch (error) {
            console.error('Failed to fetch templates:', error);
        } finally {
            set({ isTemplatesLoading: false });
        }
    },

    // A template's workflow graph: fetched once on first detail-open, cached by id.
    fetchTemplateWorkflow: async (id: string) => {
        if (!id || get().templateWorkflows[id] || get().templateWorkflowLoading[id]) return;
        set((s) => ({ templateWorkflowLoading: { ...s.templateWorkflowLoading, [id]: true } }));
        try {
            const res = await fetch(`/api/templates/${id}`);
            const data = await res.json();
            const wf = data?.template?.workflow ?? { nodes: [], edges: [] };
            set((s) => ({ templateWorkflows: { ...s.templateWorkflows, [id]: wf } }));
        } catch (error) {
            console.error('Failed to fetch template workflow:', error);
        } finally {
            set((s) => ({ templateWorkflowLoading: { ...s.templateWorkflowLoading, [id]: false } }));
        }
    },

    // Drop a cached template graph so the next detail-open refetches it (used
    // after an admin edits a template's workflow).
    invalidateTemplateWorkflow: (id: string) => set((s) => {
        const next = { ...s.templateWorkflows };
        delete next[id];
        return { templateWorkflows: next };
    }),

    // Credit breakdown: preloaded on app open; show the loader only on a cold
    // fetch so a silent refresh (e.g. hover) never blanks the popover.
    fetchCreditBreakdown: async () => {
        if (!get().creditBreakdown) set({ isCreditBreakdownLoading: true });
        try {
            const res = await fetch('/api/billing/credit-breakdown');
            if (res.ok) set({ creditBreakdown: await res.json() });
        } catch {
            // Soft-fail: keep any prior data.
        } finally {
            set({ isCreditBreakdownLoading: false });
        }
    },

    setSidebarExpanded: (expanded: boolean) => set({ sidebarExpanded: expanded }),

    openAccountModal: (tab) =>
        set(tab ? { accountModalOpen: true, accountModalTab: tab } : { accountModalOpen: true }),
    closeAccountModal: () => set({ accountModalOpen: false }),

    // Display name: load once on app open. `userApi.me()` is itself promise-cached,
    // so this never refetches; the early-return just skips the redundant work once
    // the name is in the store.
    fetchUserName: async () => {
        if (get().userName) return;
        try {
            const { userApi } = await import('@/lib/api/client');
            const { user } = await userApi.me();
            const name = user?.user_metadata?.display_name || user?.user_metadata?.full_name;
            if (name) set({ userName: name });
        } catch {
            // Soft-fail: welcome falls back to the generic greeting.
        }
    },

    // Full user object — keep `userName` in sync from the same source so the two
    // never diverge.
    setCurrentUser: (user) =>
        set({
            currentUser: user,
            userName:
                user?.user_metadata?.display_name ||
                user?.user_metadata?.full_name ||
                get().userName,
        }),

    // Preloaded once on app open (shares the cached `me()` call with fetchUserName).
    // Skips the network when we already have the user unless `force` is passed —
    // the account modal forces a refresh after profile edits so the store stays
    // current, but a plain open just reads what's already here (no reload).
    fetchCurrentUser: async (force = false) => {
        if (!force && get().currentUser) return;
        try {
            const { userApi } = await import('@/lib/api/client');
            const { user } = await userApi.me();
            if (user) get().setCurrentUser(user);
        } catch {
            // Soft-fail: the modal shows whatever it last had.
        }
    },

    // Versions: load once per canvas. Switching canvases clears + reloads; a
    // forced refresh (bus event) updates in place without blanking the list.
    fetchVersions: async (canvasId: string, force = false) => {
        if (!canvasId) return;
        if (!force && get().versionsCanvasId === canvasId) return;
        const switching = get().versionsCanvasId !== canvasId;
        if (switching) set({ versionsLoading: true, versions: [] });
        try {
            const res = await fetch(`/api/versions?canvasId=${encodeURIComponent(canvasId)}`, { cache: 'no-store' });
            const data = await res.json();
            if (res.ok) set({ versions: data.versions || [], versionsCanvasId: canvasId });
        } catch (error) {
            console.error('Failed to fetch versions:', error);
        } finally {
            set({ versionsLoading: false });
        }
    },

    triggerRunFromNode: (nodeId, mode = 'chain') => set({ runFromNodeId: nodeId, runMode: mode, runSelectionIds: null, runPreconfirmed: false }),
    triggerRunSelection: (nodeIds, opts) => {
        // Optimistically mark the targets 'pending' in the SAME tick we set the
        // run signal. commitExecution will flip them to 'running' a moment later,
        // but until it does these nodes still carry their PREVIOUS run's
        // 'success' status + stale output — which would let InlineRunResults
        // flash the old image for a frame before the skeleton. Seeding 'pending'
        // here closes that gap (and gives instant canvas feedback).
        const cur = get().nodeStatuses;
        const nextStatuses = { ...cur };
        for (const id of nodeIds) nextStatuses[id] = 'pending';
        // Drop each target's PREVIOUS run output (and its execution stamp) in the
        // same tick. Seeding 'pending' alone left the stale image sitting in
        // nodeOutputs, where the chat-run freeze would snapshot it the instant the
        // node settled — so the chat showed the old result while the canvas (which
        // renders from its per-execution outputs collection) showed the new one.
        const nextOutputs = { ...get().nodeOutputs };
        const nextOutputExecutions = { ...get().nodeOutputExecutions };
        for (const id of nodeIds) {
            delete nextOutputs[id];
            delete nextOutputExecutions[id];
        }
        set({
            // runFromNodeId stays non-null so the existing SharedWorkflowEditor effect
            // (which gates on `if (!runFromNodeId || !runMode) return`) still fires.
            // The first id is a stable sentinel; the actual targets live in runSelectionIds.
            runFromNodeId: nodeIds[0] ?? null,
            runMode: 'selection',
            runSelectionIds: nodeIds,
            runPreconfirmed: opts?.preconfirmed ?? false,
            nodeStatuses: nextStatuses,
            nodeOutputs: nextOutputs,
            nodeOutputExecutions: nextOutputExecutions,
        });
    },
    clearRunFromNode: () => set({ runFromNodeId: null, runMode: null, runSelectionIds: null, runPreconfirmed: false }),
    setMaxAutoRunCredits: (n) => set({ maxAutoRunCredits: Number.isFinite(n) && n >= 0 ? n : 0 }),
    setAutoRunEnabled: (v) => set({ autoRunEnabled: !!v }),
    setChatPreference: (key, value) =>
        set((state) => ({
            chatPreferences: { ...state.chatPreferences, [key]: value || 'auto' },
        })),
    setHasSeenAutoRunIntro: (v) => set({ hasSeenAutoRunIntro: v }),
    openAutoRunIntro: (payload) => set({ autoRunIntro: payload }),
    closeAutoRunIntro: () => set({ autoRunIntro: null }),
    openAutoRunConfig: () => set({ autoRunConfigOpen: true }),
    closeAutoRunConfig: () => set({ autoRunConfigOpen: false }),

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
                    // Only the EPHEMERAL `thumbnails/` folder is wiped here. Permanent
                    // AI outputs live under `results/{nodeId}` (see the Replicate v2
                    // webhook) and must survive node deletion — do NOT delete those.
                    const folderPath = `${user.id}/${activeSessionId}/thumbnails/${nodeId}`;
                    await uploadApi.deleteFolder(folderPath);
                }
            } catch (err) {
                console.error('Failed to cleanup node assets in background:', err);
            }
        })();
    },
});
