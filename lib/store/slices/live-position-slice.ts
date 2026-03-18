import { StateCreator } from 'zustand';
import { RootState, LivePositionSlice } from '../types';

export const createLivePositionSlice: StateCreator<RootState, [], [], LivePositionSlice> = (set, get) => ({
    liveNodePositions: {},

    setLiveNodePosition: (nodeId, position) => {
        set((state) => ({
            liveNodePositions: {
                ...state.liveNodePositions,
                [nodeId]: position,
            },
        }));
    },

    clearLiveNodePositions: () => set({ liveNodePositions: {} }),

    syncLivePositionsToWorkflow: () => {
        const { liveNodePositions, currentWorkflow, updateNodePositions } = get();
        if (!currentWorkflow || Object.keys(liveNodePositions).length === 0) return;

        const positionsMap = new Map<string, { x: number; y: number }>();
        Object.entries(liveNodePositions).forEach(([id, pos]) => {
            positionsMap.set(id, pos);
        });

        updateNodePositions(positionsMap);
        set({ liveNodePositions: {} });
    },
});
