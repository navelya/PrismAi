'use client';

import { useRef } from 'react';
import ChatInterface from '@/components/chat/ChatInterface';
import WorkspaceLayout from '@/components/layout/WorkspaceLayout';
import { useAppStore } from '@/lib/store/app-store';

interface ChatClientPageProps {
    initialUserName?: string;
    sessionId?: string;
}

export default function ChatClientPage({ initialUserName, sessionId }: ChatClientPageProps) {
    const currentWorkflow = useAppStore((state) => state.currentWorkflow);
    const setCurrentWorkflow = useAppStore((state) => state.setCurrentWorkflow);

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
            <WorkspaceLayout
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
