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

    // ⚠️ CRITICAL: Force close editor and clear workflow for NEW CHAT (no sessionId)
    // This runs synchronously BEFORE render to prevent stale editor from flashing
    useLayoutEffect(() => {
        if (!sessionId) {
            console.log('[ChatClientPage] 🆕 New chat detected - forcing editor closed');
            // Force close editor
            setEditorState({ isCanvasOpen: false });
            // Clear any stale workflow
            setCurrentWorkflow(null);
            // ⚠️ CRITICAL: Ensure activeSessionId is null for new chat
            // This corrects any stale state from localStorage rehydration
            useAppStore.getState().setActiveSessionId(null);
        }
    }, [sessionId, setEditorState, setCurrentWorkflow]);

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

