'use client';

import React, { useEffect } from 'react';
import { useAppStore } from '@/lib/store/app-store';

export default function NewChatPage() {
    // Pure Creation Route: Ensure we start with a blank slate
    useEffect(() => {
        const store = useAppStore.getState();
        store.setActiveSessionId(null);
        store.clearAllState();
    }, []);

    // The layout handles the ChatClientPage rendering, this page is just a logic sink
    return null;
}
