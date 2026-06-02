import { StateCreator } from 'zustand';
import { RootState, CollabSlice } from '../types';

export const createCollabSlice: StateCreator<RootState, [], [], CollabSlice> = (set) => ({
    collabRole: null,
    presence: {},
    peerSelections: {},
    setCollabRole: (r) => set({ collabRole: r }),
    setPresence: (p) => set({ presence: p }),
    upsertCursor: (userId, cursor) => set((s) => ({
        presence: s.presence[userId]
            ? { ...s.presence, [userId]: { ...s.presence[userId], cursor } }
            : s.presence,
    })),
    setPeerSelection: (userId, sel) => set((s) => ({
        peerSelections: { ...s.peerSelections, [userId]: sel },
    })),
    clearPeerSelection: (userId) => set((s) => {
        if (!(userId in s.peerSelections)) return s;
        const n = { ...s.peerSelections };
        delete n[userId];
        return { peerSelections: n };
    }),
});
