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

    const { isCanvasOpen, splitRatio } = editorState;
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
            </div>

            {/* Resizable Divider */}
            {isCanvasOpen && workflow && (
                <div
                    className="flex items-center justify-center w-1 bg-gray-200 hover:bg-purple-400 cursor-e-resize group transition-colors relative"
                    onMouseDown={handleMouseDown}
                >
                    <div className="absolute inset-y-0 -left-1 -right-1" />
                    <GripVertical className="w-4 h-4 text-gray-400 group-hover:text-white transition-colors" />
                </div>
            )}

            {/* Editor Panel */}
            <div
                className={`h-full border-l border-gray-200 bg-white relative overflow-hidden transition-[width] duration-150 ease-out ${isCanvasOpen ? 'flex' : 'w-0'}`}
                style={{
                    width: isCanvasOpen ? `${100 - splitRatio}%` : '0',
                }}
            >
                {/* Editor is always rendered when workflow exists to preserve state */}
                {workflow && (
                    <div className="w-full h-full">
                        <SharedWorkflowEditor
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
                )}
            </div>

            {/* Toggle Button */}
            {workflow && (
                <button
                    onClick={toggleEditor}
                    className="absolute z-40 bottom-24 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-3 py-1.5 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-full shadow-sm hover:shadow-md hover:bg-white transition-all duration-200 text-gray-700 hover:text-gray-900 text-sm font-medium"
                    title={isCanvasOpen ? 'Hide workflow editor' : 'View workflow editor'}
                >
                    <Code2 className="w-4 h-4" />
                    <span>{isCanvasOpen ? 'Hide Editor' : 'Editor'}</span>
                </button>
            )}

            {/* Dragging Overlay */}
            {isDragging && <div className="fixed inset-0 z-50 cursor-e-resize" />}
        </div>
    );
}
