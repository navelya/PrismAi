'use client';

import React, { useEffect } from 'react';
import ChatClientPage from './ChatClientPage';
import { useAppStore } from '@/lib/store/app-store';

export default function NewChatPage() {
    // Pure Creation Route: Ensure we start with a blank slate
    useEffect(() => {
        const store = useAppStore.getState();
        store.setActiveSessionId(null);
        store.clearAllState();
    }, []);

    // Renders the ChatClientPage with no sessionId, naturally triggering the "Welcome" UI
    return (
        <div className="w-full h-full relative">
            <ChatClientPage key="chat-client-new" />
        </div>
    );
}
