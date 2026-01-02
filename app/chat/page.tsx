'use client';

import { useRef } from 'react';
import ChatInterface from '@/components/chat/ChatInterface';
import SplitView from '@/components/layout/SplitView';
import { useAppStore } from '@/lib/store/app-store';

export default function ChatPage() {
    // Use global store instead of local state
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
            <SplitView
                chatPanel={
                    <ChatInterface
                        onWorkflowGenerated={setCurrentWorkflow}
                        currentWorkflow={currentWorkflow}
                        onReady={handleChatReady}
                    />
                }
                workflow={currentWorkflow}
                onExecutionResult={handleExecutionResult}
            />
        </div>
    );
}
