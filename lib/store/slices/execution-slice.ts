import { StateCreator } from 'zustand';
import { RootState, ExecutionSlice } from '../types';

export const createExecutionSlice: StateCreator<RootState, [], [], ExecutionSlice> = (set, get) => ({
    executionResults: {},
    activeExecutionId: null,
    executionStartTime: null,
    nodeStatuses: {},
    nodeDirtyStates: {},
    isComputing: {},
    executionLocks: {},
    nodeOutputs: {},

    addExecutionResult: (workflowId, result) =>
        set((state) => ({
            executionResults: {
                ...state.executionResults,
                [workflowId]: result,
            },
        })),

    clearExecutionResults: () => set({ executionResults: {} }),
    setActiveExecutionId: (id) => set({ activeExecutionId: id }),
    setExecutionStartTime: (time) => set({ executionStartTime: time }),

    // Check if execution is truly active based on node statuses
    isExecutionActive: () => {
        const { nodeStatuses, executionStartTime } = get();
        
        // If no execution has started, return false
        if (!executionStartTime) return false;
        
        // Check if any node has a "live" status (pending/running)
        const hasLiveStatuses = Object.values(nodeStatuses).some(
            (status: any) => status === 'pending' || status === 'running'
        );
        
        // Also check if execution started very recently (within 5 seconds)
        // This handles race conditions where statuses haven't updated yet
        const recentlyStarted = Date.now() - executionStartTime < 5000;
        
        return hasLiveStatuses || recentlyStarted;
    },

    setNodeStatus: (nodeId, status) =>
        set((state) => ({
            nodeStatuses: {
                ...state.nodeStatuses,
                [nodeId]: status,
            },
        })),

    resetNodeStatuses: () => set({ nodeStatuses: {} }),

    setNodeDirtyState: (nodeId, isDirty) =>
        set((state) => ({
            nodeDirtyStates: {
                ...state.nodeDirtyStates,
                [nodeId]: isDirty,
            },
        })),

    setIsComputing: (nodeId, computing) =>
        set((state) => ({
            isComputing: {
                ...state.isComputing,
                [nodeId]: computing,
            },
        })),

    setExecutionLock: (nodeId, locked) =>
        set((state) => ({
            executionLocks: {
                ...state.executionLocks,
                [nodeId]: locked,
            },
        })),

    clearExecutionLocks: () => set({ executionLocks: {} }),

    setNodeOutput: (nodeId, output) =>
        set((state) => ({
            nodeOutputs: {
                ...state.nodeOutputs,
                [nodeId]: output,
            },
        })),

    clearNodeOutputs: () => set({ nodeOutputs: {} }),

    cleanupNodeMetadata: (nodeId: string) => {
        const { nodeStatuses, nodeOutputs, nodeDirtyStates, isComputing, executionLocks } = get();

        const newStatuses = { ...nodeStatuses };
        const newOutputs = { ...nodeOutputs };
        const newDirty = { ...nodeDirtyStates };
        const newComputing = { ...isComputing };
        const newLocks = { ...executionLocks };

        delete newStatuses[nodeId];
        delete newOutputs[nodeId];
        delete newDirty[nodeId];
        delete newComputing[nodeId];
        delete newLocks[nodeId];

        set({
            nodeStatuses: newStatuses,
            nodeOutputs: newOutputs,
            nodeDirtyStates: newDirty,
            isComputing: newComputing,
            executionLocks: newLocks
        });
    },

    invalidateNodes: (nodeIds) => {
        const state = get();
        const currentWorkflow = state.currentWorkflow;
        if (!currentWorkflow) return;

        const { getDescendants } = require('../../utils/graph-traversal');
        const allDirtyNodes = new Set<string>();

        nodeIds.forEach(id => {
            allDirtyNodes.add(id);
            const descendants = getDescendants(id, currentWorkflow.edges);
            descendants.forEach((d: string) => allDirtyNodes.add(d));
        });

        const newStatuses = { ...state.nodeStatuses };
        const newOutputs = { ...state.nodeOutputs };

        allDirtyNodes.forEach((id) => {
            delete newStatuses[id];
            delete newOutputs[id];
        });

        set({
            nodeStatuses: newStatuses,
            nodeOutputs: newOutputs,
        });
    },
});
