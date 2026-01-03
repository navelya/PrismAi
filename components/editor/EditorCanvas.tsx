'use client';

import React, { useCallback, useRef, useEffect } from 'react';
import ReactFlow, {
    Background,
    Controls,
    BackgroundVariant,
    MarkerType,
    NodeMouseHandler,
    ReactFlowProvider,
    Edge,
    NodeDragHandler,
} from 'reactflow';
import 'reactflow/dist/style.css';
import CustomNode from '../canvas/CustomNode';
import { NodeType } from '@/lib/nodes/types';
import { useAppStore } from '@/lib/store/app-store';
import { Undo2, Redo2 } from 'lucide-react';

interface EditorCanvasProps {
    nodes: any[];
    edges: any[];
    onNodesChange: any;
    onEdgesChange: any;
    onConnect: any;
    onNodeClick?: NodeMouseHandler;
    onDrop: (type: NodeType, position: { x: number; y: number }) => void;
    selectionMode?: boolean;
    onSelectionToggle?: () => void;
}

const nodeTypes = {
    scrape_images: CustomNode,
    remove_background: CustomNode,
    filter_sort: CustomNode,
    ai_generate_image: CustomNode,
};

function EditorCanvasInner({
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    onNodeClick,
    onDrop,
    selectionMode = false,
    onSelectionToggle,
}: EditorCanvasProps) {
    const reactFlowWrapper = useRef<HTMLDivElement>(null);
    const [reactFlowInstance, setReactFlowInstance] = React.useState<any>(null);

    // Get store actions for undo/redo
    const setIsDragging = useAppStore((state) => state.setIsDragging);
    const updateNodePosition = useAppStore((state) => state.updateNodePosition);
    const saveSnapshot = useAppStore((state) => state.saveSnapshot);
    const undo = useAppStore((state) => state.undo);
    const redo = useAppStore((state) => state.redo);
    const canUndo = useAppStore((state) => state.canUndo());
    const canRedo = useAppStore((state) => state.canRedo());

    // Keyboard shortcuts for undo/redo
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            // Check if we're in an input field
            const target = event.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
                return; // Don't intercept if typing in input
            }

            const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
            const ctrlKey = isMac ? event.metaKey : event.ctrlKey;

            // Undo: Ctrl+Z (Windows) or Cmd+Z (Mac)
            if (ctrlKey && event.key.toLowerCase() === 'z' && !event.shiftKey) {
                event.preventDefault();
                console.log('Undo shortcut pressed, canUndo:', canUndo);
                if (canUndo) {
                    undo();
                }
                return;
            }

            // Redo: Ctrl+Y (Windows) or Cmd+Shift+Z (Mac)
            if ((ctrlKey && event.key.toLowerCase() === 'y') || (ctrlKey && event.shiftKey && event.key.toLowerCase() === 'z')) {
                event.preventDefault();
                console.log('Redo shortcut pressed, canRedo:', canRedo);
                if (canRedo) {
                    redo();
                }
                return;
            }
        };

        document.addEventListener('keydown', handleKeyDown, true); // Use capture phase
        return () => document.removeEventListener('keydown', handleKeyDown, true);
    }, [undo, redo, canUndo, canRedo]);

    // Handle node drag start
    const handleNodeDragStart: NodeDragHandler = useCallback(() => {
        setIsDragging(true);
    }, [setIsDragging]);

    // Handle node drag stop - save snapshot with new position
    const handleNodeDragStop: NodeDragHandler = useCallback((event, node) => {
        setIsDragging(false);
        updateNodePosition(node.id, node.position);
        saveSnapshot();
    }, [setIsDragging, updateNodePosition, saveSnapshot]);

    // Handle undo button click
    const handleUndo = () => {
        console.log('Undo button clicked, canUndo:', canUndo);
        if (canUndo) {
            undo();
        }
    };

    // Handle redo button click
    const handleRedo = () => {
        console.log('Redo button clicked, canRedo:', canRedo);
        if (canRedo) {
            redo();
        }
    };

    const onDragOver = useCallback((event: React.DragEvent) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    }, []);

    const onDropHandler = useCallback(
        (event: React.DragEvent) => {
            event.preventDefault();

            const type = event.dataTransfer.getData('application/reactflow') as NodeType;
            if (!type || !reactFlowInstance) return;

            const position = reactFlowInstance.screenToFlowPosition({
                x: event.clientX,
                y: event.clientY,
            });

            onDrop(type, position);
        },
        [reactFlowInstance, onDrop]
    );

    // Handle edge click to remove connection
    const handleEdgeClick = useCallback(
        (event: React.MouseEvent, edge: Edge) => {
            event.stopPropagation();
            console.log('🔗 Edge clicked, removing:', edge.id);
            // Remove the clicked edge
            onEdgesChange([{ type: 'remove', id: edge.id }]);
        },
        [onEdgesChange]
    );

    return (
        <div ref={reactFlowWrapper} className="w-full h-full relative">
            {/* Undo/Redo Buttons - Top Left */}
            <div className="absolute top-4 left-4 z-[5] flex gap-2">
                <button
                    onClick={handleUndo}
                    disabled={!canUndo}
                    className="w-9 h-9 rounded-lg bg-white/90 backdrop-blur-sm border border-gray-200 
                               shadow-lg hover:shadow-xl transition-all duration-200
                               flex items-center justify-center
                               disabled:opacity-40 disabled:cursor-not-allowed
                               hover:bg-white disabled:hover:bg-white/90
                               group"
                    title="Undo (Ctrl+Z)"
                >
                    <Undo2
                        className={`w-4 h-4 transition-colors ${canUndo ? 'text-gray-700 group-hover:text-purple-600' : 'text-gray-400'}`}
                        suppressHydrationWarning
                    />
                </button>
                <button
                    onClick={handleRedo}
                    disabled={!canRedo}
                    className="w-9 h-9 rounded-lg bg-white/90 backdrop-blur-sm border border-gray-200 
                               shadow-lg hover:shadow-xl transition-all duration-200
                               flex items-center justify-center
                               disabled:opacity-40 disabled:cursor-not-allowed
                               hover:bg-white disabled:hover:bg-white/90
                               group"
                    title="Redo (Ctrl+Y)"
                >
                    <Redo2
                        className={`w-4 h-4 transition-colors ${canRedo ? 'text-gray-700 group-hover:text-purple-600' : 'text-gray-400'}`}
                        suppressHydrationWarning
                    />
                </button>
            </div>

            <ReactFlow
                nodes={nodes}
                edges={edges.map(e => ({
                    ...e,
                    type: 'smoothstep',
                    animated: true,
                    markerEnd: {
                        type: MarkerType.ArrowClosed,
                        width: 20,
                        height: 20,
                    },
                    style: {
                        strokeWidth: 2,
                        stroke: '#667eea',
                        cursor: 'pointer',
                    },
                }))}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onNodeClick={onNodeClick}
                onNodeDragStart={handleNodeDragStart}
                onNodeDragStop={handleNodeDragStop}
                onEdgeClick={handleEdgeClick}
                onInit={setReactFlowInstance}
                onDrop={onDropHandler}
                onDragOver={onDragOver}
                nodeTypes={nodeTypes}
                defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
                fitView
                fitViewOptions={{ padding: 0.3, maxZoom: 0.8 }}
                deleteKeyCode="Delete"
                selectionOnDrag={selectionMode}
                panOnDrag={!selectionMode}
                selectNodesOnDrag={false}
                connectionMode={"loose" as any}
                selectionMode={selectionMode ? 'partial' as any : undefined}
            >
                <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="#cbd5e1" />
                <Controls className="bg-white/80 backdrop-blur-sm border border-gray-200 rounded-lg shadow-lg">
                    {/* Custom Selection Mode Button */}
                    {onSelectionToggle && (
                        <button
                            onClick={onSelectionToggle}
                            className="react-flow__controls-button"
                            title={selectionMode ? 'Pan mode (click & drag canvas)' : 'Selection mode (drag to select)'}
                            style={{
                                backgroundColor: selectionMode ? '#f3e8ff' : 'transparent',
                                borderColor: selectionMode ? '#7c3aed' : 'transparent',
                                color: selectionMode ? '#7c3aed' : '#374151',
                            }}
                        >
                            <svg
                                xmlns="http://www.w3.org/2000/svg"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                style={{ width: 16, height: 16 }}
                            >
                                <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
                                <path d="M13 13l6 6" />
                            </svg>
                        </button>
                    )}
                </Controls>
            </ReactFlow>
        </div>
    );
}

export default function EditorCanvas(props: EditorCanvasProps) {
    return (
        <ReactFlowProvider>
            <EditorCanvasInner {...props} />
        </ReactFlowProvider>
    );
}
