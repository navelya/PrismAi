'use client';

import React, { useRef, useEffect } from 'react';
import { Code2, MessageSquare, GripVertical } from 'lucide-react';
import { Workflow } from '@/lib/nodes/types';
import SharedWorkflowEditor from '../editor/SharedWorkflowEditor';
import { useAppStore } from '@/lib/store/app-store';

interface SplitViewProps {
    chatPanel: React.ReactNode;
    workflow: Workflow | null;
    onExecutionResult?: (result: any) => void;
}

export default function SplitView({ chatPanel, workflow, onExecutionResult }: SplitViewProps) {
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

    return (
        <div ref={containerRef} className="relative w-full h-full flex flex-col md:flex-row">
            {/* Mobile: Tab Switcher */}
            {workflow && isCanvasOpen && (
                <div className="md:hidden flex border-b border-gray-200 bg-white">
                    <button
                        onClick={() => setActiveTab('chat')}
                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${activeTab === 'chat'
                            ? 'text-purple-600 border-b-2 border-purple-600'
                            : 'text-gray-600 hover:text-gray-900'
                            }`}
                    >
                        <MessageSquare className="w-4 h-4" />
                        Chat
                    </button>
                    <button
                        onClick={() => setActiveTab('editor')}
                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${activeTab === 'editor'
                            ? 'text-purple-600 border-b-2 border-purple-600'
                            : 'text-gray-600 hover:text-gray-900'
                            }`}
                    >
                        <Code2 className="w-4 h-4" />
                        Editor
                    </button>
                </div>
            )}

            {/* Chat Panel */}
            <div
                className={`h-full relative transition-all duration-300 ease-in-out ${isCanvasOpen && activeTab === 'editor' ? 'hidden md:block' : 'block'
                    }`}
                style={{
                    width: isCanvasOpen ? `${splitRatio}%` : '100%',
                }}
            >
                {chatPanel}
            </div>

            {/* Desktop: Resizable Divider */}
            {isCanvasOpen && workflow && (
                <div
                    className="hidden md:flex items-center justify-center w-1 bg-gray-200 hover:bg-purple-400 cursor-e-resize group transition-colors relative"
                    onMouseDown={handleMouseDown}
                >
                    <div className="absolute inset-y-0 -left-1 -right-1" />
                    <GripVertical className="w-4 h-4 text-gray-400 group-hover:text-white transition-colors" />
                </div>
            )}

            {/* Editor Panel */}
            <div
                className={`h-full border-l border-gray-200 bg-white relative overflow-hidden transition-all duration-300 ease-in-out ${isCanvasOpen && activeTab === 'chat' ? 'hidden md:flex' : isCanvasOpen ? 'flex' : 'w-0'
                    }`}
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
                    className="absolute bottom-24 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2 px-3 py-1.5 bg-white/90 backdrop-blur-sm border border-gray-200 rounded-full shadow-sm hover:shadow-md hover:bg-white transition-all duration-200 text-gray-700 hover:text-gray-900 text-sm font-medium"
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
