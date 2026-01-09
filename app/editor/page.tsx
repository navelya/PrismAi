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
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 p-6">
                <div className="max-w-md text-center">
                    <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-gradient-to-br from-purple-100 to-indigo-100 flex items-center justify-center">
                        <Monitor className="w-10 h-10 text-purple-600" />
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900 mb-3">
                        Desktop Only
                    </h1>
                    <p className="text-gray-600 mb-8 leading-relaxed">
                        The visual workflow editor requires a larger screen for the best experience.
                        Please use a desktop or tablet device.
                    </p>
                    <div className="space-y-3">
                        <Link
                            href="/chat"
                            className="flex items-center justify-center gap-2 w-full px-6 py-3 bg-gradient-to-r from-purple-600 to-indigo-600 text-white font-medium rounded-xl hover:from-purple-700 hover:to-indigo-700 transition-all shadow-lg hover:shadow-xl"
                        >
                            <MessageSquare className="w-5 h-5" />
                            Use Chat Instead
                            <ArrowRight className="w-4 h-4" />
                        </Link>
                        <p className="text-sm text-gray-500">
                            Create workflows using natural language in the chat
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    // Desktop: Full editor experience
    return (
        <div className="w-full h-full">
            <SharedWorkflowEditor
                workflow={currentWorkflow}
                onWorkflowChange={setCurrentWorkflow}
            />
        </div>
    );
}
