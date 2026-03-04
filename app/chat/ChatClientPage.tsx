'use client';

import { useRef } from 'react';
import ChatInterface from '@/components/chat/ChatInterface';
import WorkspaceLayout from '@/components/layout/WorkspaceLayout';
import { useAppStore } from '@/lib/store/app-store';
import { useExecutionChannel } from '@/lib/hooks/use-execution-channel';

interface ChatClientPageProps {
    initialUserName?: string;
    sessionId?: string;
}

export default function ChatClientPage({ initialUserName, sessionId }: ChatClientPageProps) {
    const currentWorkflow = useAppStore((state) => state.currentWorkflow);
    const setCurrentWorkflow = useAppStore((state) => state.setCurrentWorkflow);

    const addResultRef = useRef<((result: any) => void) | null>(null);

    // Mount execution channel at layout level — NEVER unmounts with Copilot/ChatInterface.
    // This is the critical fix for live status updates surviving the FAB minimize swap.
    useExecutionChannel(sessionId);

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
