'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSession } from '@/lib/hooks/use-session';
import { useAppStore } from '@/lib/store/app-store';
import { Loader2 } from 'lucide-react';

export default function ActiveSessionPage({ params }: { params: { id: string } }) {
    const router = useRouter();
    const sessionId = (Array.isArray(params?.id) ? params.id[0] : params?.id) as string;

    const { loadSession, isLoading, error } = useSession();
    const [isSessionReady, setIsSessionReady] = useState(false);

    // 1. Safe Error Redirection
    useEffect(() => {
        if (error) {
            console.error('[DEBUG] Redirecting to /chat due to session error:', error);
            router.push('/chat');
        }
    }, [error, router]);

    // 2. Pure Session Loading Logic
    useEffect(() => {
        if (!sessionId) return;

        const store = useAppStore.getState();

        // Ghost Message Prevention => Wipe stale state IF the ID is different from what's currently in store.
        if (store.activeSessionId !== sessionId) {
            store.clearAllState();
            store.setActiveSessionId(sessionId);
        }

        // If the store already has messages for this exact session, we likely JUST created it 
        // optimistically (or soft-navigated back). Skip loading to preserve optimistic UI.
        const hasMessages = useAppStore.getState().chatMessages.some(m => m.sessionId === sessionId);
        if (hasMessages) {
            // We're not running loadSession, so release the session-loading guard
            // ourselves — otherwise it stays true (set by clearAllState / the slice
            // default) and the canvas loader never settles. The workflow is already
            // in the store, so the canvas can settle immediately.
            store.setIsLoadingSession(false);
            setIsSessionReady(true);
            return;
        }

        // Always reset ready state and load when ID changes
        setIsSessionReady(false);
        loadSession(sessionId).then(() => {
            setIsSessionReady(true);
        });
    }, [sessionId, loadSession]); // Removed isSessionReady from deps

    return null;
}
