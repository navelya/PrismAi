import { StateCreator } from 'zustand';
import { RootState, ExecutionSlice, PartialIterationEntry } from '../types';

export const createExecutionSlice: StateCreator<RootState, [], [], ExecutionSlice> = (set, get) => ({
    executionResults: {},
    activeExecutionId: null,
    executionStartTime: null,
    nodeStatuses: {},
    nodeOutputs: {},
    nodeOutputExecutions: {},
    nodeErrors: {},
    optimisticCreditDelta: 0,
    pendingCharges: {},
    partialIterationResults: {},

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

    setNodeOutput: (nodeId, output, executionId) =>
        set((state) => {
            const nextExecutions = { ...state.nodeOutputExecutions };
            // Stamp (or clear) the producing execution alongside the output so the
            // chat-run freeze can tell this run's output from a stale prior one.
            if (output == null) {
                delete nextExecutions[nodeId];
            } else if (executionId) {
                nextExecutions[nodeId] = executionId;
            } else {
                // Output set without a known execution (source re-seed, optimistic
                // path) — drop any stale stamp rather than keep a wrong one.
                delete nextExecutions[nodeId];
            }
            return {
                nodeOutputs: {
                    ...state.nodeOutputs,
                    [nodeId]: output,
                },
                nodeOutputExecutions: nextExecutions,
            };
        }),

    clearNodeOutputs: () => set({ nodeOutputs: {}, nodeOutputExecutions: {} }),

    addPartialIterationResult: (nodeId, executionId, item) =>
        set((state) => {
            const prev = state.partialIterationResults[nodeId];
            // A new execution for this node supersedes any stale partials.
            const base: PartialIterationEntry =
                prev && prev.executionId === executionId
                    ? prev
                    : { executionId, items: [] };
            // Update in place if this prediction_index already arrived (webhook
            // retry); otherwise append in arrival (completion) order.
            const existingIdx = base.items.findIndex((it) => it.index === item.index);
            const items =
                existingIdx >= 0
                    ? base.items.map((it, i) => (i === existingIdx ? item : it))
                    : [...base.items, item];
            return {
                partialIterationResults: {
                    ...state.partialIterationResults,
                    [nodeId]: { executionId, items },
                },
            };
        }),

    clearPartialIterationResults: (nodeId) =>
        set((state) => {
            if (!state.partialIterationResults[nodeId]) return state;
            const next = { ...state.partialIterationResults };
            delete next[nodeId];
            return { partialIterationResults: next };
        }),

    cleanupNodeMetadata: (nodeId: string) => {
        const { nodeStatuses, nodeOutputs, nodeOutputExecutions, nodeErrors, partialIterationResults } = get();

        const newStatuses = { ...nodeStatuses };
        const newOutputs = { ...nodeOutputs };
        const newOutputExecutions = { ...nodeOutputExecutions };
        const newErrors = { ...nodeErrors };
        const newPartials = { ...partialIterationResults };

        delete newStatuses[nodeId];
        delete newOutputs[nodeId];
        delete newOutputExecutions[nodeId];
        delete newErrors[nodeId];
        delete newPartials[nodeId];

        set({
            nodeStatuses: newStatuses,
            nodeOutputs: newOutputs,
            nodeOutputExecutions: newOutputExecutions,
            nodeErrors: newErrors,
            partialIterationResults: newPartials,
        });
    },

    invalidateNodes: (nodeIds) => {
        const state = get();

        const newStatuses = { ...state.nodeStatuses };
        const newOutputs = { ...state.nodeOutputs };
        const newOutputExecutions = { ...state.nodeOutputExecutions };
        const newErrors = { ...state.nodeErrors };
        const newPartials = { ...state.partialIterationResults };

        nodeIds.forEach((id) => {
            delete newStatuses[id];
            delete newOutputs[id];
            delete newOutputExecutions[id];
            delete newErrors[id];
            delete newPartials[id];
        });

        set({
            nodeStatuses: newStatuses,
            nodeOutputs: newOutputs,
            nodeOutputExecutions: newOutputExecutions,
            nodeErrors: newErrors,
            partialIterationResults: newPartials,
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
