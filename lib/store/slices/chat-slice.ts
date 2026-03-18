import { StateCreator } from 'zustand';
import { RootState, ChatSlice } from '../types';

export const createChatSlice: StateCreator<RootState, [], [], ChatSlice> = (set) => ({
    chatMessages: [],
    chatScrollTop: 9999999,

    addMessage: (message) =>
        set((state) => ({
            chatMessages: [
                ...state.chatMessages,
                { ...message, sessionId: message.sessionId || state.activeSessionId || undefined }
            ],
        })),

    updateMessage: (id, updates) =>
        set((state) => ({
            chatMessages: state.chatMessages.map((msg) =>
                msg.id === id ? { ...msg, ...updates } : msg
            ),
        })),

    clearMessages: () => set({ chatMessages: [] }),
    setChatScrollTop: (pos) => set({ chatScrollTop: pos }),
});
