import { StateCreator } from 'zustand';
import { RootState, CollabSlice } from '../types';

export const createCollabSlice: StateCreator<RootState, [], [], CollabSlice> = (set) => ({
    collabRole: null,
    presence: {},
    setCollabRole: (r) => set({ collabRole: r }),
    setPresence: (p) => set({ presence: p }),
    upsertCursor: (userId, cursor) => set((s) => ({
        presence: s.presence[userId]
            ? { ...s.presence, [userId]: { ...s.presence[userId], cursor } }
            : s.presence,
    })),
});
