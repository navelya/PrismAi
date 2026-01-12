'use client';

import SharedWorkflowEditor from '@/components/editor/SharedWorkflowEditor';
import { useAppStore } from '@/lib/store/app-store';
import { useIsMobile } from '@/lib/hooks/use-mobile';
import { Monitor, MessageSquare, ArrowRight } from 'lucide-react';
import Link from 'next/link';

export default function EditorPage() {
    const isMobile = useIsMobile();

    // Use global store for workflow
    const currentWorkflow = useAppStore((state) => state.currentWorkflow);
    const setCurrentWorkflow = useAppStore((state) => state.setCurrentWorkflow);

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

    // Desktop: Full editor experience
    return (
        <div className="w-full h-full bg-surface-primary">
            <SharedWorkflowEditor
                workflow={currentWorkflow}
            />
        </div>
    );
}
