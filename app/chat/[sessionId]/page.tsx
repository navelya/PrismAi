'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useParams, notFound } from 'next/navigation';
import ChatClientPage from '../ChatClientPage';
import { useSession } from '@/lib/hooks/use-session';
import { useAppStore } from '@/lib/store/app-store';
import { Loader2 } from 'lucide-react';

export default function SessionPage() {
    const params = useParams();
    const sessionId = params.sessionId as string;
    const { loadSession, isLoading, error } = useSession();
    const activeSessionId = useAppStore((state) => state.activeSessionId);

    console.log('[DEBUG] SessionPage Render:', { sessionId, isLoading, error, activeSessionId });

    // Track if we've triggered loading for this specific sessionId
    const loadingSessionIdRef = useRef<string | null>(null);
    const [isSessionReady, setIsSessionReady] = useState(false);

    // If session load failed, redirect gracefully instead of 404
    useEffect(() => {
        if (error) {
            console.error('[DEBUG] Redirecting to /chat due to session error:', error);
            window.location.href = '/chat';
        }
    }, [error]);

    useEffect(() => {
        if (sessionId && loadingSessionIdRef.current !== sessionId) {
            loadingSessionIdRef.current = sessionId;

            // ⚠️ OPTIMISTIC UI PRESERVATION
            // If the store ALREADY has this session active with messages, it means 
            // Next.js just did a soft client-side route transition from 'New Chat' -> '[id]'.
            // In this case, DO NOT run loadSession! 
            // loadSession clears the store and would destroy the live generation UI.
            const store = useAppStore.getState();
            if (store.activeSessionId === sessionId && store.chatMessages.length > 0) {
                console.log('[DEBUG] SessionPage: Optimistically bypassing loadSession for seamlessly created chat.');
                setIsSessionReady(true);
                return;
            }

            setIsSessionReady(false);  // Reset ready state for new session

            loadSession(sessionId).then(() => {
                setIsSessionReady(true);
            });
        }
    }, [sessionId, loadSession]);

    // Show loading if:
    // - We're still loading
    // - OR the active session doesn't match the URL (race condition protection)
    // - OR the session isn't ready yet
    // - OR there is a redirecting error
    const shouldShowLoader = isLoading || activeSessionId !== sessionId || !isSessionReady || !!error;

    if (shouldShowLoader) {
        return (
            <div className="h-full flex items-center justify-center bg-surface-primary">
                <div className="flex flex-col items-center gap-4">
                    <Loader2 className="w-8 h-8 animate-spin text-accent-primary" />
                    <p className="text-content-secondary">Loading session...</p>
                </div>
            </div>
        );
    }

    // Use ChatClientPage with compound key to force remount when session changes
    // The key includes sessionId AND a timestamp marker to ensure fresh mount
    return <ChatClientPage key={`session-${sessionId}`} sessionId={sessionId} />;
}
