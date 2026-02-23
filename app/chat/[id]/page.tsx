'use client';

import React, { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import ChatClientPage from '../ChatClientPage';
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

        // Warm Load Optimistic Bypass
        // If the store already specifically holds this sessionId, we just navigated here optimistically.
        if (store.activeSessionId === sessionId) {
            setIsSessionReady(true);
            return;
        }

        // Ghost Message Prevention => Wipe stale state BEFORE fetching.
        store.clearAllState();
        store.setActiveSessionId(sessionId); // set synchronously so Next render sees it

        // Cold Load
        setIsSessionReady(false);
        loadSession(sessionId).then(() => {
            setIsSessionReady(true);
        });
    }, [sessionId, loadSession]);

    const shouldShowLoader = isLoading || !isSessionReady || !!error;

    return (
        <div className="relative w-full h-full flex flex-col">
            <div className="flex-1 w-full h-full relative">
                <ChatClientPage key={`chat-client-${sessionId}`} sessionId={sessionId} />

                {shouldShowLoader && (
                    <div className="absolute inset-0 z-50 flex items-center justify-center bg-surface-primary">
                        <div className="flex flex-col items-center gap-4">
                            <Loader2 className="w-8 h-8 animate-spin text-accent-primary" />
                            <p className="text-content-secondary font-medium">Loading conversation...</p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
