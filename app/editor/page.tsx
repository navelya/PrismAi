'use client';

import SharedWorkflowEditor from '@/components/editor/SharedWorkflowEditor';
import { useAppStore } from '@/lib/store/app-store';

export default function EditorPage() {
    // Use global store for workflow
    const currentWorkflow = useAppStore((state) => state.currentWorkflow);
    const setCurrentWorkflow = useAppStore((state) => state.setCurrentWorkflow);

    return (
        <div className="w-full h-full">
            <SharedWorkflowEditor
                workflow={currentWorkflow}
                onWorkflowChange={setCurrentWorkflow}
            />
        </div>
    );
}
