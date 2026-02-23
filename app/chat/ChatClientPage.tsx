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
    const setEditorState = useAppStore((state) => state.setEditorState);

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
                        sessionId={sessionId}
                    />
                }
                workflow={currentWorkflow}
                onExecutionResult={handleExecutionResult}
                sessionId={sessionId}
            />
        </div>
    );
}

