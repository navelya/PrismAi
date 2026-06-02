import { StateCreator } from 'zustand';
import { RootState, LivePositionSlice } from '../types';

export const createLivePositionSlice: StateCreator<RootState, [], [], LivePositionSlice> = (set, get) => ({
    liveNodePositions: {},

    setLiveNodePosition: (nodeId, position) => {
        set((state) => {
            const previous = state.liveNodePositions[nodeId];
            if (previous && previous.x === position.x && previous.y === position.y) {
                return state;
            }

            return {
                liveNodePositions: {
                    ...state.liveNodePositions,
                    [nodeId]: position,
                },
            };
        });
    },

    clearLiveNodePositions: () => set({ liveNodePositions: {} }),

    clearLiveNodePosition: (nodeId) => {
        set((state) => {
            if (!(nodeId in state.liveNodePositions)) return state;
            const next = { ...state.liveNodePositions };
            delete next[nodeId];
            return { liveNodePositions: next };
        });
    },

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
