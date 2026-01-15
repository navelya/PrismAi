'use client';

import React, { useRef, useEffect } from 'react';
import { Code2, MessageSquare, GripVertical } from 'lucide-react';
import { Workflow } from '@/lib/nodes/types';
import SharedWorkflowEditor from '../editor/SharedWorkflowEditor';
import { useAppStore } from '@/lib/store/app-store';
import { useIsMobile } from '@/lib/hooks/use-mobile';

interface SplitViewProps {
    chatPanel: React.ReactNode;
    workflow: Workflow | null;
    onExecutionResult?: (result: any) => void;
}

export default function SplitView({ chatPanel, workflow, onExecutionResult }: SplitViewProps) {
    const isMobile = useIsMobile();

    // Use global store for editor state
    const editorState = useAppStore((state) => state.editorState);
    const setEditorState = useAppStore((state) => state.setEditorState);
    const chatMessages = useAppStore((state) => state.chatMessages);
    const currentWorkflow = useAppStore((state) => state.currentWorkflow);
    const activeSessionId = useAppStore((state) => state.activeSessionId);

    // Check if chat has any messages (for showing Editor button)
    const hasMessages = chatMessages.length > 0;

    // Check if any message has a workflow attached (for Editor button visibility after refresh)
    const hasWorkflowInMessages = chatMessages.some((msg: any) => msg.workflow?.nodes?.length > 0);

    // Determine if Editor button should be visible
    // Requires active session AND (has workflow prop, store workflow, or workflow in messages)
    const showEditorButton = activeSessionId && hasMessages && (workflow || currentWorkflow || hasWorkflowInMessages);

    console.log('[SplitView] activeSessionId:', activeSessionId, 'showEditorButton:', showEditorButton);

    const { isCanvasOpen, splitRatio } = editorState;

    // 🔍 DEBUG: Trace editor visibility decision
    console.log('[SplitView] 🔍 Render check:', {
        isCanvasOpen,
        workflowProp: workflow?.name ?? 'null',
        storeWorkflow: currentWorkflow?.name ?? 'null',
        willRenderEditor: isCanvasOpen && workflow,
    });
    const [isDragging, setIsDragging] = React.useState(false);
    const [activeTab, setActiveTab] = React.useState<'chat' | 'editor'>('chat');
    const containerRef = useRef<HTMLDivElement>(null);
    const rafIdRef = useRef<number | null>(null);

    // Handle mouse dragging for resizing
    const handleMouseDown = (e: React.MouseEvent) => {
        setIsDragging(true);
        e.preventDefault();
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging || !containerRef.current) return;

            // Cancel any pending animation frame
            if (rafIdRef.current !== null) {
                cancelAnimationFrame(rafIdRef.current);
            }

            // Throttle updates using requestAnimationFrame for smooth performance
            rafIdRef.current = requestAnimationFrame(() => {
                if (!containerRef.current) return;

                const container = containerRef.current;
                const containerRect = container.getBoundingClientRect();
                const newRatio = ((e.clientX - containerRect.left) / containerRect.width) * 100;

                if (newRatio >= 30 && newRatio <= 70) {
                    setEditorState({ splitRatio: newRatio });
                }
            });
        };

        const handleMouseUp = () => {
            setIsDragging(false);
            // Cancel any pending animation frame on mouse up
            if (rafIdRef.current !== null) {
                cancelAnimationFrame(rafIdRef.current);
                rafIdRef.current = null;
            }
        };

        if (isDragging) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            // Cleanup animation frame on unmount
            if (rafIdRef.current !== null) {
                cancelAnimationFrame(rafIdRef.current);
            }
        };
    }, [isDragging, setEditorState]);

    const toggleEditor = () => {
        setEditorState({ isCanvasOpen: !isCanvasOpen });
        if (!isCanvasOpen) {
            setActiveTab('editor');
        }
    };

    // Mobile: Chat-only experience - no editor access
    if (isMobile) {
        return (
            <div className="w-full h-full flex flex-col">
                {chatPanel}
            </div>
        );
    }

    // Desktop: Full split view experience
    return (
        <div ref={containerRef} className="relative w-full h-full flex flex-row">
            {/* Chat Panel */}
            <div
                className="h-full relative transition-[width] duration-150 ease-out"
                style={{
                    width: isCanvasOpen ? `${splitRatio}%` : '100%',
                }}
            >
                {chatPanel}

                {/* Toggle Button - show when chat has messages AND workflow exists (prop, store, or message) */}
                {showEditorButton && (
                    <button
                        onClick={toggleEditor}
                        className="absolute z-40 top-4 right-4 w-10 h-10 flex items-center justify-center bg-surface-elevated/90 backdrop-blur-sm border border-stroke-subtle rounded-full shadow-sm hover:shadow-md hover:bg-surface-elevated hover:border-accent-primary/30 transition-all duration-200 text-content-secondary hover:text-accent-primary group"
                        title={isCanvasOpen ? 'Hide workflow editor' : 'View workflow editor'}
                    >
                        <Code2 className="w-5 h-5 transition-transform group-hover:scale-110" />
                    </button>
                )}
            </div>

            {/* Resizable Divider - Only show when editor is open AND workflow exists */}
            {isCanvasOpen && workflow && (
                <div
                    className="flex items-center justify-center w-1 bg-stroke-subtle hover:bg-accent-primary cursor-e-resize group transition-colors relative"
                    onMouseDown={handleMouseDown}
                >
                    <div className="absolute inset-y-0 -left-1 -right-1" />
                    <GripVertical className="w-4 h-4 text-content-tertiary group-hover:text-content-inverted transition-colors" />
                </div>
            )}

            {/* Editor Panel - ONLY render when isCanvasOpen AND workflow exists */}
            {isCanvasOpen && workflow && (
                <div
                    className="h-full border-l border-stroke-subtle bg-surface-primary relative overflow-hidden flex transition-[width] duration-150 ease-out"
                    style={{
                        width: `${100 - splitRatio}%`,
                    }}
                >
                    <div className="w-full h-full">
                        <SharedWorkflowEditor
                            key={activeSessionId} // Force remount when session changes
                            workflow={workflow}
                            showToolbar={true}
                            showResultsPanel={false}
                            readOnly={false}
                            onExecutionComplete={(result) => {
                                if (onExecutionResult) {
                                    onExecutionResult(result);
                                }
                            }}
                        />
                    </div>
                </div>
            )}



            {/* Dragging Overlay */}
            {isDragging && <div className="fixed inset-0 z-50 cursor-e-resize" />}
        </div>
    );
}
