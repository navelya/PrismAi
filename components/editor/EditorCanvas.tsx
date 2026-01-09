'use client';

import React, { useCallback, useRef, useEffect, useMemo, useState } from 'react';
import ReactFlow, {
    Background,
    Controls,
    BackgroundVariant,
    NodeMouseHandler,
    ReactFlowProvider,
    Edge,
    NodeDragHandler,
    getIncomers,
    getOutgoers,
    getConnectedEdges,
    useReactFlow,
    Connection,
    Panel,
    useViewport,
} from 'reactflow';
import 'reactflow/dist/style.css';
import CustomNode from '../canvas/CustomNode';
import { NodeType } from '@/lib/nodes/types';
import { useAppStore } from '@/lib/store/app-store';
import { Undo2, Redo2, Network, Trash2, Copy } from 'lucide-react';
import { autoLayoutNodesAsync } from '@/lib/utils/graph-layout';
import CanvasContextMenu from './CanvasContextMenu';

interface EditorCanvasProps {
    nodes: any[];
    edges: any[];
    onNodesChange: any;
    onEdgesChange: any;
    onConnect: any;
    onNodeClick?: NodeMouseHandler;
    onDrop: (type: NodeType, position: { x: number; y: number }) => void;
    updatePositions?: (positions: Map<string, { x: number; y: number }>) => void;
    selectionMode?: boolean;
    onSelectionToggle?: () => void;
}

const nodeTypes = {
    scrape_images: CustomNode,
    remove_background: CustomNode,
    filter_sort: CustomNode,
    ai_generate_image: CustomNode,
    upscale_image: CustomNode,
    merge_image: CustomNode,
};

function EditorCanvasInner({
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onConnect,
    onNodeClick,
    onDrop,
    updatePositions,
    selectionMode = false,
    onSelectionToggle,
}: EditorCanvasProps) {
    const reactFlowWrapper = useRef<HTMLDivElement>(null);
    const [reactFlowInstance, setReactFlowInstance] = React.useState<any>(null);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

    // Get store actions for undo/redo and copy/paste
    const setIsDragging = useAppStore((state) => state.setIsDragging);
    const updateNodePosition = useAppStore((state) => state.updateNodePosition);
    const saveSnapshot = useAppStore((state) => state.saveSnapshot);
    const undo = useAppStore((state) => state.undo);
    const redo = useAppStore((state) => state.redo);
    const canUndo = useAppStore((state) => state.canUndo());
    const canRedo = useAppStore((state) => state.canRedo());
    const copyNode = useAppStore((state) => state.copyNode);
    const pasteNode = useAppStore((state) => state.pasteNode);
    const deleteNode = useAppStore((state) => state.deleteNode);
    const layoutEngine = useAppStore((state) => state.layoutEngine);

    // Get selected nodes
    const selectedNodes = useMemo(() => nodes.filter((n: any) => n.selected), [nodes]);
    const multiSelectCount = selectedNodes.length;

    // Track viewport changes to update button positions on zoom/pan
    const viewport = useViewport();

    // Get setNodes for programmatic selection
    const { setNodes } = useReactFlow();

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

            // Copy: Ctrl+C - copy selected node
            if (ctrlKey && event.key.toLowerCase() === 'c') {
                // Get selected nodes from React Flow
                const selectedNodes = nodes.filter((n: any) => n.selected);
                if (selectedNodes.length === 1) {
                    event.preventDefault();
                    copyNode(selectedNodes[0].id);
                    console.log('Node copied:', selectedNodes[0].id);
                }
                return;
            }

            // Paste: Ctrl+V - paste copied node
            if (ctrlKey && event.key.toLowerCase() === 'v') {
                event.preventDefault();
                pasteNode();
                console.log('Node pasted');
                return;
            }
        };

        document.addEventListener('keydown', handleKeyDown, true); // Use capture phase
        return () => document.removeEventListener('keydown', handleKeyDown, true);
    }, [undo, redo, canUndo, canRedo, nodes, copyNode, pasteNode]);

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

    // Handle auto-layout button click (async for ELK.js)
    const handleAutoLayout = async () => {
        console.log('Auto-layout clicked, nodes:', nodes.length, 'edges:', edges.length, 'engine:', layoutEngine);
        if (nodes.length === 0 || !updatePositions) return;

        // Calculate new positions using selected layout engine
        const newPositions = await autoLayoutNodesAsync(nodes, edges, layoutEngine);
        console.log('Calculated positions:', newPositions);
        console.log('Positions Map size:', newPositions.size);

        // Log a sample position
        const firstEntry = Array.from(newPositions.entries())[0];
        if (firstEntry) {
            console.log('Sample position:', firstEntry);
        }

        // Update positions directly in the canvas (bypasses store to avoid re-render loop)
        console.log('Calling updatePositions directly...');
        updatePositions(newPositions);
        console.log('Positions updated!');
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

    // Handle node deletion - reconnect incomers to outgoers (delete middle node)
    const onNodesDelete = useCallback(
        (deleted: any[]) => {
            // For each deleted node, connect its incomers to its outgoers
            const newEdges = deleted.reduce((acc, node) => {
                const incomers = getIncomers(node, nodes, acc);
                const outgoers = getOutgoers(node, nodes, acc);
                const connectedEdges = getConnectedEdges([node], acc);

                // Remove edges connected to deleted node
                const remainingEdges = acc.filter((edge: Edge) => !connectedEdges.includes(edge));

                // Create new edges to bridge the gap
                const createdEdges = incomers.flatMap(({ id: source }) =>
                    outgoers.map(({ id: target }) => ({
                        id: `${source}->${target}`,
                        source,
                        target,
                        type: 'default',
                        animated: true,
                    }))
                );

                return [...remainingEdges, ...createdEdges];
            }, edges);

            // Update edges through the onChange callback
            onEdgesChange(
                edges.filter((e: Edge) => !newEdges.find((ne: Edge) => ne.id === e.id))
                    .map((e: Edge) => ({ type: 'remove' as const, id: e.id }))
            );

            // Add the new bridging edges
            newEdges.filter((ne: Edge) => !edges.find((e: Edge) => e.id === ne.id))
                .forEach((edge: Edge) => {
                    onConnect({ source: edge.source, target: edge.target, sourceHandle: null, targetHandle: null });
                });
        },
        [nodes, edges, onEdgesChange, onConnect]
    );

    // Prevent cycles - check if new connection would create a cycle
    const isValidConnection = useCallback(
        (connection: Connection) => {
            // Don't allow self-connections
            if (connection.source === connection.target) return false;

            // Check if this connection would create a cycle
            const target = nodes.find((node: any) => node.id === connection.target);
            if (!target) return false;

            // DFS to check for cycle
            const hasCycle = (node: any, visited = new Set<string>()): boolean => {
                if (visited.has(node.id)) return false;
                visited.add(node.id);

                for (const outgoer of getOutgoers(node, nodes, edges)) {
                    if (outgoer.id === connection.source) return true;
                    if (hasCycle(outgoer, visited)) return true;
                }
                return false;
            };

            return !hasCycle(target);
        },
        [nodes, edges]
    );

    // Context menu right-click handler
    const handleContextMenu = useCallback((event: React.MouseEvent) => {
        event.preventDefault();
        // Only open if we're clicking on the canvas, not on nodes
        const target = event.target as HTMLElement;
        if (target.closest('.react-flow__node')) {
            return; // Clicked on a node, don't show context menu
        }
        setContextMenu({ x: event.clientX, y: event.clientY });
    }, []);

    // Handle node creation from context menu
    const handleContextMenuNodeSelect = useCallback((type: NodeType, position: { x: number; y: number }) => {
        if (reactFlowInstance && reactFlowWrapper.current) {
            // Convert screen coordinates to flow coordinates
            const flowPosition = reactFlowInstance.screenToFlowPosition({
                x: position.x,
                y: position.y,
            });
            onDrop(type, flowPosition);
        }
        setContextMenu(null);
    }, [reactFlowInstance, onDrop]);

    return (
        <div ref={reactFlowWrapper} className="w-full h-full relative" onContextMenu={handleContextMenu}>
            {/* Toolbar now inside ReactFlow via Panel */}
            <ReactFlow
                nodes={nodes}
                edges={edges.map(e => ({
                    ...e,
                    type: 'default',
                    animated: true,
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
                onNodesDelete={onNodesDelete}
                isValidConnection={isValidConnection}
                selectionOnDrag={true}
                panOnDrag={[1]}
                selectNodesOnDrag={false}
                connectionMode={"loose" as any}
                selectionMode={'partial' as any}
            >
                <Background variant={BackgroundVariant.Dots} gap={16} size={1} style={{ backgroundColor: 'rgb(var(--canvas-bg))' }} color="rgb(var(--canvas-dots))" />
                <Controls className="bg-white/80 dark:bg-gray-800/80 backdrop-blur-sm border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg" />

                {/* Undo/Redo/Layout Panel - Inside ReactFlow to not break selection */}
                <Panel position="top-left" className="flex gap-2 !m-4">
                    <button
                        onClick={handleUndo}
                        disabled={!canUndo}
                        suppressHydrationWarning
                        className="w-9 h-9 rounded-lg bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm border border-gray-200 dark:border-gray-700
                                   shadow-lg hover:shadow-xl transition-all duration-200
                                   flex items-center justify-center
                                   disabled:opacity-40 disabled:cursor-not-allowed
                                   hover:bg-white dark:hover:bg-gray-700 group"
                        title="Undo (Ctrl+Z)"
                    >
                        <Undo2 className={`w-4 h-4 transition-colors ${canUndo ? 'text-gray-700 dark:text-gray-300 group-hover:text-purple-600' : 'text-gray-400 dark:text-gray-600'}`} suppressHydrationWarning />
                    </button>
                    <button
                        onClick={handleRedo}
                        disabled={!canRedo}
                        className="w-9 h-9 rounded-lg bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm border border-gray-200 dark:border-gray-700
                                   shadow-lg hover:shadow-xl transition-all duration-200
                                   flex items-center justify-center
                                   disabled:opacity-40 disabled:cursor-not-allowed
                                   hover:bg-white dark:hover:bg-gray-700 group"
                        title="Redo (Ctrl+Y)"
                    >
                        <Redo2 className={`w-4 h-4 transition-colors ${canRedo ? 'text-gray-700 dark:text-gray-300 group-hover:text-purple-600' : 'text-gray-400 dark:text-gray-600'}`} />
                    </button>
                    <button
                        onClick={handleAutoLayout}
                        disabled={nodes.length === 0}
                        className="w-9 h-9 rounded-lg bg-white/90 dark:bg-gray-800/90 backdrop-blur-sm border border-gray-200 dark:border-gray-700
                                   shadow-lg hover:shadow-xl transition-all duration-200
                                   flex items-center justify-center
                                   disabled:opacity-40 disabled:cursor-not-allowed
                                   hover:bg-white dark:hover:bg-gray-700 group"
                        title="Auto Layout"
                    >
                        <Network className={`w-4 h-4 transition-colors ${nodes.length > 0 ? 'text-gray-700 dark:text-gray-300 group-hover:text-purple-600' : 'text-gray-400 dark:text-gray-600'}`} />
                    </button>
                </Panel>

                {/* Selection Action Buttons - Positioned relative to selection bounding box */}
                {multiSelectCount >= 2 && reactFlowInstance && (() => {
                    // Calculate selection bounding box
                    const NODE_WIDTH = 200;
                    const NODE_HEIGHT = 80;

                    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                    const selectedNodeIds = selectedNodes.map((n: any) => n.id);
                    selectedNodes.forEach((node: any) => {
                        const x = node.position?.x || 0;
                        const y = node.position?.y || 0;
                        minX = Math.min(minX, x);
                        minY = Math.min(minY, y);
                        maxX = Math.max(maxX, x + NODE_WIDTH);
                        maxY = Math.max(maxY, y + NODE_HEIGHT);
                    });

                    const groupWidth = maxX - minX;

                    // Convert flow position to screen position for button placement
                    const screenPos = reactFlowInstance.flowToScreenPosition({ x: maxX, y: minY });
                    const wrapperRect = reactFlowWrapper.current?.getBoundingClientRect();
                    const left = screenPos.x - (wrapperRect?.left || 0);
                    const top = screenPos.y - (wrapperRect?.top || 0) - 36;

                    return (
                        <Panel
                            position="top-left"
                            style={{
                                position: 'absolute',
                                left: Math.max(8, left - 64),
                                top: Math.max(8, top),
                                margin: 0,
                            }}
                        >
                            <div className="flex gap-1">
                                <button
                                    onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        e.preventDefault();

                                        // Copy entire group to the RIGHT of the selection box
                                        if (selectedNodes.length > 0) {
                                            const selectedIds = new Set(selectedNodes.map((n: any) => n.id));
                                            const idMap = new Map<string, string>();
                                            const newNodes: any[] = [];

                                            // Offset = group width + 50px gap
                                            const offsetX = groupWidth + 50;

                                            selectedNodes.forEach((node: any, index: number) => {
                                                const newId = `node_${Date.now()}_${index}`;
                                                idMap.set(node.id, newId);
                                                newNodes.push({
                                                    ...JSON.parse(JSON.stringify(node)),
                                                    id: newId,
                                                    selected: false,
                                                    position: {
                                                        x: (node.position?.x || 0) + offsetX,
                                                        y: (node.position?.y || 0), // Same Y, offset X
                                                    },
                                                });
                                            });

                                            const newEdges: any[] = [];
                                            edges.forEach((edge: any) => {
                                                if (selectedIds.has(edge.source) && selectedIds.has(edge.target)) {
                                                    newEdges.push({
                                                        ...edge,
                                                        id: `edge_${Date.now()}_${edge.id}`,
                                                        source: idMap.get(edge.source),
                                                        target: idMap.get(edge.target),
                                                    });
                                                }
                                            });

                                            const state = useAppStore.getState();
                                            if (state.currentWorkflow) {
                                                // Just add new nodes - don't touch existing nodes
                                                // This preserves ReactFlow's internal selection state
                                                useAppStore.setState({
                                                    currentWorkflow: {
                                                        ...state.currentWorkflow,
                                                        nodes: [...state.currentWorkflow.nodes, ...newNodes],
                                                        edges: [...(state.currentWorkflow.edges || []), ...newEdges],
                                                    }
                                                });
                                                saveSnapshot();
                                            }
                                        }
                                    }}
                                    className="p-1.5 rounded bg-white/95 border border-gray-200 text-gray-600 hover:bg-purple-50 hover:text-purple-600 hover:border-purple-300 transition-colors shadow-md"
                                    title="Copy selected nodes"
                                >
                                    <Copy className="w-4 h-4" />
                                </button>
                                <button
                                    onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        selectedNodes.forEach((node: any) => deleteNode(node.id));
                                    }}
                                    className="p-1.5 rounded bg-white/95 border border-gray-200 text-red-500 hover:bg-red-50 hover:border-red-300 transition-colors shadow-md"
                                    title="Delete selected nodes"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        </Panel>
                    );
                })()}
            </ReactFlow>

            {/* Context Menu */}
            {
                contextMenu && reactFlowWrapper.current && (
                    <CanvasContextMenu
                        position={contextMenu}
                        canvasBounds={reactFlowWrapper.current.getBoundingClientRect()}
                        onSelectNode={handleContextMenuNodeSelect}
                        onClose={() => setContextMenu(null)}
                    />
                )
            }
        </div >
    );
}

export default function EditorCanvas(props: EditorCanvasProps) {
    return (
        <ReactFlowProvider>
            <EditorCanvasInner {...props} />
        </ReactFlowProvider>
    );
}
