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
            console.log('[DEBUG] Session ID changed, clearing all state');
            store.clearAllState();
            store.setActiveSessionId(sessionId);
        }

        // If the store already has messages for this exact session, we likely JUST created it 
        // optimistically (or soft-navigated back). Skip loading to preserve optimistic UI.
        const hasMessages = useAppStore.getState().chatMessages.some(m => m.sessionId === sessionId);
        if (hasMessages) {
            console.log('[DEBUG] Store already has messages for session, skipping load to preserve optimistic UI');
            setIsSessionReady(true);
            return;
        }

        // Always reset ready state and load when ID changes
        setIsSessionReady(false);
        loadSession(sessionId).then(() => {
            setIsSessionReady(true);
        });
    }, [sessionId, loadSession]); // Removed isSessionReady from deps

    const shouldShowLoader = isLoading || !isSessionReady || !!error;

    if (!shouldShowLoader) return null;

    return (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-surface-primary/80 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-4">
                <Loader2 className="w-8 h-8 animate-spin text-accent-primary" />
                <p className="text-content-secondary font-medium">Loading conversation...</p>
            </div>
        </div>
    );
}
