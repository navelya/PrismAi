'use client';

import { useRef, useLayoutEffect } from 'react';
import ChatInterface from '@/components/chat/ChatInterface';
import SplitView from '@/components/layout/SplitView';
import { useAppStore } from '@/lib/store/app-store';

interface ChatClientPageProps {
    initialUserName?: string;
    sessionId?: string; // Optional - null for new chat
}

export default function ChatClientPage({ initialUserName, sessionId }: ChatClientPageProps) {
    // Use global store instead of local state
    const currentWorkflow = useAppStore((state) => state.currentWorkflow);
    const setCurrentWorkflow = useAppStore((state) => state.setCurrentWorkflow);
    const activeSessionId = useAppStore((state) => state.activeSessionId);
    const setEditorState = useAppStore((state) => state.setEditorState);

    // ⚠️ CRITICAL UX FIX: Strict React State Isolation
    // When navigating between chats, we MUST completely reset the global store 
    // to prevent cross-chat state contamination (loading states leaking over).
    useLayoutEffect(() => {
        const store = useAppStore.getState();

        // Scenario 1: Navigating to a 'New Chat' (null sessionId)
        if (!sessionId) {
            store.clearAllState();
        }
        // Scenario 2: Navigating to a different existing chat
        else if (sessionId !== store.activeSessionId) {
            store.clearAllState();
            store.setActiveSessionId(sessionId);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sessionId]); // ONLY run when Next.js Route (URL prop) changes!

    const addResultRef = useRef<((result: any) => void) | null>(null);

    const handleChatReady = (addResult: (result: any) => void) => {
        addResultRef.current = addResult;
    };

    const handleExecutionResult = (result: any) => {
        if (addResultRef.current) {
            addResultRef.current(result);
        }
    };

    return (
        <div className="w-full h-full">
            <SplitView
                chatPanel={
                    <ChatInterface
                        onWorkflowGenerated={setCurrentWorkflow}
                        currentWorkflow={currentWorkflow}
                        onReady={handleChatReady}
                        userName={initialUserName}
                    />
                }
                workflow={currentWorkflow}
                onExecutionResult={handleExecutionResult}
            />
        </div>
    );
}

