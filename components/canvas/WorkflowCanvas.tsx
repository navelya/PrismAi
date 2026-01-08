'use client';

import React, { useCallback, useEffect } from 'react';
import ReactFlow, {
    Node,
    Edge,
    Controls,
    Background,
    useNodesState,
    useEdgesState,
    BackgroundVariant,
    MarkerType,
    NodeDragHandler,
} from 'reactflow';
import 'reactflow/dist/style.css';
import CustomNode from './CustomNode';
import { Workflow } from '@/lib/nodes/types';
import { useAppStore } from '@/lib/store/app-store';
import { Undo2, Redo2 } from 'lucide-react';

interface WorkflowCanvasProps {
    workflow: Workflow | null;
}

const nodeTypes = {
    scrape_images: CustomNode,
    remove_background: CustomNode,
    filter_sort: CustomNode,
    ai_generate_image: CustomNode,
    upscale_image: CustomNode,
    merge_image: CustomNode,
};

export default function WorkflowCanvas({ workflow }: WorkflowCanvasProps) {
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);

    // Get store actions
    const setIsDragging = useAppStore((state) => state.setIsDragging);
    const updateNodePosition = useAppStore((state) => state.updateNodePosition);
    const saveSnapshot = useAppStore((state) => state.saveSnapshot);
    const undo = useAppStore((state) => state.undo);
    const redo = useAppStore((state) => state.redo);
    const canUndo = useAppStore((state) => state.canUndo());
    const canRedo = useAppStore((state) => state.canRedo());

    // Update nodes and edges when workflow changes
    useEffect(() => {
        if (workflow && workflow.nodes) {
            const flowNodes: Node[] = workflow.nodes.map(node => ({
                id: node.id,
                type: node.type,
                position: node.position,
                data: node.data,
            }));

            const flowEdges: Edge[] = (workflow.edges || []).map(edge => ({
                id: edge.id,
                source: edge.source,
                target: edge.target,
                sourceHandle: edge.sourceHandle,
                targetHandle: edge.targetHandle,
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
                },
            }));

            setNodes(flowNodes);
            setEdges(flowEdges);
        } else {
            setNodes([]);
            setEdges([]);
        }
    }, [workflow, setNodes, setEdges]);

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

    return (
        <div className="w-full h-full bg-gradient-to-br from-slate-50 to-slate-100 relative">
            {/* Undo/Redo Buttons - Top Left */}
            <div className="absolute top-4 left-4 z-10 flex gap-2">
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
                    <Undo2 className={`w-4 h-4 transition-colors ${canUndo ? 'text-gray-700 group-hover:text-purple-600' : 'text-gray-400'}`} />
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
                    <Redo2 className={`w-4 h-4 transition-colors ${canRedo ? 'text-gray-700 group-hover:text-purple-600' : 'text-gray-400'}`} />
                </button>
            </div>

            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeDragStart={handleNodeDragStart}
                onNodeDragStop={handleNodeDragStop}
                nodeTypes={nodeTypes}
                fitView
                minZoom={0.5}
                maxZoom={1.5}
                defaultViewport={{ x: 0, y: 0, zoom: 1 }}
            >
                <Background
                    variant={BackgroundVariant.Dots}
                    gap={16}
                    size={1}
                    color="#cbd5e1"
                />
                <Controls
                    className="bg-white/80 backdrop-blur-sm border border-gray-200 rounded-lg shadow-lg"
                />
            </ReactFlow>
        </div>
    );
}
