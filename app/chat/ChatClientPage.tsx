'use client';

import { useRef } from 'react';
import ChatInterface from '@/components/chat/ChatInterface';
import WorkspaceLayout from '@/components/layout/WorkspaceLayout';
import { useAppStore } from '@/lib/store/app-store';
import { useExecutionChannel } from '@/lib/hooks/use-execution-channel';
import { Workflow } from '@/lib/nodes/types';

interface ChatClientPageProps {
    initialUserName?: string;
    sessionId?: string;
}

export default function ChatClientPage({ initialUserName, sessionId }: ChatClientPageProps) {
    const currentWorkflow = useAppStore((state) => state.currentWorkflow);
    const setCurrentWorkflow = useAppStore((state) => state.setCurrentWorkflow);
    const activeSessionId = useAppStore((state) => state.activeSessionId);

    const addResultRef = useRef<((result: any) => void) | null>(null);

    // V3: Mount execution channel at layout level using activeSessionId from store
    // Listens to node_results table for real-time updates for the entire session
    useExecutionChannel(activeSessionId);

    const handleChatReady = (addResult: (result: any) => void) => {
        addResultRef.current = addResult;
    };

    const handleExecutionResult = (result: any) => {
        if (addResultRef.current) {
            addResultRef.current(result);
        }
    };

    const handleWorkflowGenerated = (workflow: Workflow) => {
        setCurrentWorkflow(workflow, false);
    };

    return (
        <div className="w-full h-full">
            <WorkspaceLayout
                chatPanel={
                    <ChatInterface
                        onWorkflowGenerated={handleWorkflowGenerated}
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
