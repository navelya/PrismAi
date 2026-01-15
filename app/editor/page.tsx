'use client';

import { useLayoutEffect } from 'react';
import SharedWorkflowEditor from '@/components/editor/SharedWorkflowEditor';
import { useAppStore } from '@/lib/store/app-store';
import { useIsMobile } from '@/lib/hooks/use-mobile';
import { Monitor, MessageSquare, ArrowRight, Workflow } from 'lucide-react';
import Link from 'next/link';

export default function EditorPage() {
    const isMobile = useIsMobile();

    // Session context - which chat owns this editor
    const activeSessionId = useAppStore((state) => state.activeSessionId);
    const currentWorkflow = useAppStore((state) => state.currentWorkflow);
    const setCurrentWorkflow = useAppStore((state) => state.setCurrentWorkflow);

    // ⚠️ CRITICAL: Force clear workflow if there's no active session (new chat scenario)
    // This ensures stale workflows don't appear in the editor for new chats
    useLayoutEffect(() => {
        if (!activeSessionId && currentWorkflow) {
            console.log('[EditorPage] 🧹 No active session - clearing stale workflow');
            setCurrentWorkflow(null);
        }
    }, [activeSessionId, currentWorkflow, setCurrentWorkflow]);

    // Mobile: Show message that editor requires desktop
    if (isMobile) {
        return (
            <div className="w-full h-full flex items-center justify-center bg-surface-secondary p-6">
                <div className="max-w-md text-center">
                    <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-premium flex items-center justify-center">
                        <Monitor className="w-10 h-10 text-content-inverted" />
                    </div>
                    <h1 className="text-2xl font-bold text-content-primary mb-3">
                        Desktop Only
                    </h1>
                    <p className="text-content-secondary mb-8 leading-relaxed">
                        The visual workflow editor requires a larger screen for the best experience.
                        Please use a desktop or tablet device.
                    </p>
                    <div className="space-y-3">
                        <Link
                            href="/chat"
                            className="flex items-center justify-center gap-2 w-full px-6 py-3 bg-gradient-premium text-content-inverted font-medium rounded-xl hover:scale-105 transition-all shadow-lg shadow-accent-primary/25"
                        >
                            <MessageSquare className="w-5 h-5" />
                            Use Chat Instead
                            <ArrowRight className="w-4 h-4" />
                        </Link>
                        <p className="text-sm text-content-tertiary">
                            Create workflows using natural language in the chat
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    // No active session: Show empty state prompting user to start a chat
    if (!activeSessionId) {
        return (
            <div className="w-full h-full flex items-center justify-center bg-surface-primary">
                <div className="max-w-md text-center">
                    <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-surface-secondary flex items-center justify-center">
                        <Workflow className="w-10 h-10 text-content-tertiary" />
                    </div>
                    <h1 className="text-2xl font-bold text-content-primary mb-3">
                        No Active Chat
                    </h1>
                    <p className="text-content-secondary mb-8 leading-relaxed">
                        Start a chat to create or view a workflow. Each chat has its own editor canvas.
                    </p>
                    <Link
                        href="/chat"
                        className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-premium text-content-inverted font-medium rounded-xl hover:scale-105 transition-all shadow-lg shadow-accent-primary/25"
                    >
                        <MessageSquare className="w-5 h-5" />
                        Start a Chat
                        <ArrowRight className="w-4 h-4" />
                    </Link>
                </div>
            </div>
        );
    }

    // Active session but no workflow yet (fresh new chat): Show empty editor prompt
    if (!currentWorkflow) {
        return (
            <div className="w-full h-full flex items-center justify-center bg-surface-primary">
                <div className="max-w-md text-center">
                    <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-surface-secondary flex items-center justify-center">
                        <Workflow className="w-10 h-10 text-content-tertiary" />
                    </div>
                    <h1 className="text-2xl font-bold text-content-primary mb-3">
                        No Workflow Yet
                    </h1>
                    <p className="text-content-secondary mb-8 leading-relaxed">
                        This chat doesn&apos;t have a workflow yet. Use the chat to create one, or drag nodes from the palette to build manually.
                    </p>
                    <Link
                        href={`/chat/${activeSessionId}`}
                        className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-premium text-content-inverted font-medium rounded-xl hover:scale-105 transition-all shadow-lg shadow-accent-primary/25"
                    >
                        <MessageSquare className="w-5 h-5" />
                        Go to Chat
                        <ArrowRight className="w-4 h-4" />
                    </Link>
                </div>
            </div>
        );
    }

    // Desktop with active session AND workflow: Full editor experience
    return (
        <div className="w-full h-full bg-surface-primary">
            <SharedWorkflowEditor
                key={activeSessionId} // Force remount when session changes
                workflow={currentWorkflow}
            />
        </div>
    );
}
