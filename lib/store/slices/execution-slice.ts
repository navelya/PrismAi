import { StateCreator } from 'zustand';
import { RootState, ExecutionSlice } from '../types';

export const createExecutionSlice: StateCreator<RootState, [], [], ExecutionSlice> = (set, get) => ({
    executionResults: {},
    activeExecutionId: null,
    executionStartTime: null,
    nodeStatuses: {},
    nodeOutputs: {},
    nodeErrors: {},
    optimisticCreditDelta: 0,
    pendingCharges: {},

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
        const { nodeStatuses } = get();
        
        // Check if any node has a "live" status (pending/running)
        // 'success', 'error', 'completed', 'failed', 'idle' are all terminal/inactive states
        const hasLiveStatuses = Object.values(nodeStatuses).some(
            (status: any) => status === 'pending' || status === 'running'
        );
        
        return hasLiveStatuses;
    },

    setNodeStatus: (nodeId, status) =>
        set((state) => {
            // Only update if the status actually changed to prevent redundant renders
            if (state.nodeStatuses[nodeId] === status) return state;
            
            return {
                nodeStatuses: {
                    ...state.nodeStatuses,
                    [nodeId]: status,
                },
            };
        }),

    setNodeError: (nodeId, error) =>
        set((state) => {
            const current = state.nodeErrors[nodeId];
            // No-op when nothing changes (avoids redundant renders). The `null`
            // path clears any existing message.
            if (error) {
                if (current === error) return state;
                return { nodeErrors: { ...state.nodeErrors, [nodeId]: error } };
            }
            if (current === undefined) return state;
            const next = { ...state.nodeErrors };
            delete next[nodeId];
            return { nodeErrors: next };
        }),

    resetNodeStatuses: () => set({ nodeStatuses: {}, nodeErrors: {} }),

    setNodeOutput: (nodeId, output) =>
        set((state) => ({
            nodeOutputs: {
                ...state.nodeOutputs,
                [nodeId]: output,
            },
        })),

    clearNodeOutputs: () => set({ nodeOutputs: {} }),

    cleanupNodeMetadata: (nodeId: string) => {
        const { nodeStatuses, nodeOutputs, nodeErrors } = get();

        const newStatuses = { ...nodeStatuses };
        const newOutputs = { ...nodeOutputs };
        const newErrors = { ...nodeErrors };

        delete newStatuses[nodeId];
        delete newOutputs[nodeId];
        delete newErrors[nodeId];

        set({
            nodeStatuses: newStatuses,
            nodeOutputs: newOutputs,
            nodeErrors: newErrors,
        });
    },

    invalidateNodes: (nodeIds) => {
        const state = get();

        const newStatuses = { ...state.nodeStatuses };
        const newOutputs = { ...state.nodeOutputs };
        const newErrors = { ...state.nodeErrors };

        nodeIds.forEach((id) => {
            delete newStatuses[id];
            delete newOutputs[id];
            delete newErrors[id];
        });

        set({
            nodeStatuses: newStatuses,
            nodeOutputs: newOutputs,
            nodeErrors: newErrors,
        });
    },

    applyOptimisticCharge: (executionId, cost, nodeIds) =>
        set((state) => {
            if (!(cost > 0)) return state;
            return {
                optimisticCreditDelta: state.optimisticCreditDelta - cost,
                pendingCharges: {
                    ...state.pendingCharges,
                    [executionId]: { cost, nodeIds },
                },
            };
        }),

    settleOptimisticCharge: (executionId, failed) =>
        set((state) => {
            const rec = state.pendingCharges[executionId];
            if (!rec) return state;
            const nextCharges = { ...state.pendingCharges };
            delete nextCharges[executionId];
            return {
                // On failure, reverse the decrement so the balance pops back up
                // immediately. On success, leave the delta — the server's debit
                // realtime has (or will) reset it to 0 via resetOptimisticDelta.
                optimisticCreditDelta: failed
                    ? state.optimisticCreditDelta + rec.cost
                    : state.optimisticCreditDelta,
                pendingCharges: nextCharges,
            };
        }),

    resetOptimisticDelta: () => set({ optimisticCreditDelta: 0 }),
});
