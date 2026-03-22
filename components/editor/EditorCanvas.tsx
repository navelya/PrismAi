'use client';

import React, { useCallback, useRef, useEffect, useMemo, useState } from 'react';
import ReactFlow, {
    Background,
    BackgroundVariant,
    NodeMouseHandler,
    ReactFlowProvider,
    Edge,
    NodeDragHandler,
    NodeChange,
    getIncomers,
    getOutgoers,
    getConnectedEdges,
    useReactFlow,
    Connection,
    Panel,
    useViewport,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { NodeType } from '@/lib/nodes/types';
import { clientRegistry, FallbackNode } from '@/lib/nodes/core/client-registry';
import { sharedRegistry } from '@/lib/nodes/core/shared-registry';
import { useAppStore } from '@/lib/store/app-store';
import { Undo2, Redo2, Network, Trash2, Copy, Hand, Minus, Plus, Maximize2 } from 'lucide-react';
import { autoLayoutNodesAsync } from '@/lib/utils/graph-layout';
import CanvasContextMenu from './CanvasContextMenu';
import { stableNodeTypes, stableEdgeTypes } from './reactflow-types';
import { useTheme } from '@/components/theme/ThemeProvider';

interface EditorCanvasProps {
    nodes: any[];
    edges: any[];
    onNodesChange: any;
    onEdgesChange: any;
    onConnect: any;
    onNodeClick?: NodeMouseHandler;
    onDrop: (type: NodeType, position: { x: number; y: number }, nodeTypeId?: string) => void;
    updatePositions?: (positions: Map<string, { x: number; y: number }>) => void;
    selectionMode?: boolean;
    onSelectionToggle?: () => void;
    // Undo/Redo Props
    undo?: () => void;
    redo?: () => void;
    canUndo?: boolean;
    canRedo?: boolean;
    // Drag Handlers
    onNodeDragStart?: NodeDragHandler;
    onNodeDragStop?: NodeDragHandler;
    // Action Handlers
    onDuplicate?: (nodes: any[], edges: any[]) => void;
    onDelete?: (nodeIds: string[]) => void;
    onCopy?: (nodeId: string) => void;
    onPaste?: () => void;
}

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
    // Undo/Redo & Props
    undo,
    redo,
    canUndo,
    canRedo,
    onNodeDragStart,
    onNodeDragStop,
    onDuplicate,
    onDelete,
    onCopy,
    onPaste,
}: EditorCanvasProps) {
    const reactFlowWrapper = useRef<HTMLDivElement>(null);
    const [reactFlowInstance, setReactFlowInstance] = React.useState<any>(null);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
    const [isPanMode, setIsPanMode] = useState(false);

    // Theme context for dynamic updates
    const { resolvedTheme } = useTheme();

    const setIsDragging = useAppStore((state) => state.setIsDragging);
    const setLiveNodePosition = useAppStore((state) => state.setLiveNodePosition);
    const syncLivePositionsToWorkflow = useAppStore((state) => state.syncLivePositionsToWorkflow);
    const liveNodePositions = useAppStore((state) => state.liveNodePositions);

    const copyNode = useAppStore((state) => state.copyNode);
    const pasteNode = useAppStore((state) => state.pasteNode);

    // Overlay live positions for buttery smooth dragging
    const displayNodes = useMemo(() => {
        return nodes.map((node) => {
            const livePos = liveNodePositions[node.id];
            if (livePos) {
                return { ...node, position: livePos };
            }
            return node;
        });
    }, [nodes, liveNodePositions]);

    // Get selected nodes
    const selectedNodes = useMemo(() => nodes.filter((n: any) => n.selected), [nodes]);
    const multiSelectCount = selectedNodes.length;

    // Edge style that uses CSS variables - recomputes when theme changes
    const edgeStyle = useMemo(() => ({
        strokeWidth: 2,
        stroke: 'rgb(var(--canvas-edge))',
        cursor: 'pointer',
    }), [resolvedTheme]);

    const memoizedEdges = useMemo(() => edges.map(e => ({
        ...e,
        type: 'default',
        animated: false,
        style: edgeStyle,
    })), [edges, edgeStyle]);

    const touchInteraction = useAppStore((state) => state.touchInteraction);
    
    // 🛡️ STABILITY FIX: Memoize nodeTypes and edgeTypes at top level to maintain ref identity
    const nodeTypes = useMemo(() => stableNodeTypes, []);
    const edgeTypes = useMemo(() => stableEdgeTypes, []);

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
                if (canUndo) {
                    undo?.();
                }
                return;
            }

            // Redo: Ctrl+Y (Windows) or Cmd+Shift+Z (Mac)
            if ((ctrlKey && event.key.toLowerCase() === 'y') || (ctrlKey && event.shiftKey && event.key.toLowerCase() === 'z')) {
                event.preventDefault();
                if (canRedo) {
                    redo?.();
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
                }
                return;
            }

            // Paste: Ctrl+V - paste copied node
            if (ctrlKey && event.key.toLowerCase() === 'v') {
                event.preventDefault();
                pasteNode();
                return;
            }
        };

        document.addEventListener('keydown', handleKeyDown, true);
        return () => {
            document.removeEventListener('keydown', handleKeyDown, true);
        };
    }, [undo, redo, canUndo, canRedo, nodes, copyNode, pasteNode]);

    // Handle node drag
    const handleNodeDrag: NodeDragHandler = useCallback((event, node) => {
        setLiveNodePosition(node.id, node.position);
    }, [setLiveNodePosition]);

    // Handle node drag start
    const handleNodeDragStart: NodeDragHandler = useCallback((event, node, nodes) => {
        setIsDragging(true);
        touchInteraction();
        if (onNodeDragStart) onNodeDragStart(event, node, nodes);
    }, [setIsDragging, onNodeDragStart, touchInteraction]);

    // Handle node drag stop
    const handleNodeDragStop: NodeDragHandler = useCallback((event, node, nodes) => {
        // Collect final positions from liveNodePositions slice
        const state = useAppStore.getState();
        const positionsMap = new Map<string, { x: number; y: number }>();
        Object.entries(state.liveNodePositions).forEach(([id, pos]) => {
            positionsMap.set(id, pos);
        });

        // 🛡️ SYNC FIX: Update the hook first (the owner of state)
        if (updatePositions && positionsMap.size > 0) {
            updatePositions(positionsMap);
        }

        // Now clear and stop
        state.clearLiveNodePositions();
        setIsDragging(false);
        touchInteraction();
        
        if (onNodeDragStop) onNodeDragStop(event, node, nodes);
    }, [setIsDragging, onNodeDragStop, touchInteraction, updatePositions]);

    // Throttle high-frequency node change events (drag) to the next animation frame
    const pendingNodeChanges = useRef<NodeChange[] | null>(null);
    const rafId = useRef<number | null>(null);

    const flushNodeChanges = useCallback(() => {
        if (pendingNodeChanges.current && pendingNodeChanges.current.length > 0) {
            // Filter out position changes during drag - they are handled by liveNodePositions
            // BUT if we are NOT dragging (e.g. final drop), we must include them to sync React Flow's state
            const isDragging = useAppStore.getState().isDragging;
            const importantChanges = isDragging 
                ? pendingNodeChanges.current.filter(c => c.type !== 'position')
                : pendingNodeChanges.current;

            if (importantChanges.length > 0) {
                onNodesChange(importantChanges);
            }
        }
        pendingNodeChanges.current = null;
        rafId.current = null;
    }, [onNodesChange]);

    const handleNodesChangeThrottled = useCallback((changes: NodeChange[]) => {
        if (pendingNodeChanges.current) {
            pendingNodeChanges.current = pendingNodeChanges.current.concat(changes);
        } else {
            pendingNodeChanges.current = changes;
        }
        if (rafId.current === null) {
            rafId.current = requestAnimationFrame(flushNodeChanges);
        }
    }, [flushNodeChanges]);

    useEffect(() => {
        return () => {
            if (rafId.current) {
                cancelAnimationFrame(rafId.current);
            }
        };
    }, []);

    // Handle undo button click
    const handleUndo = () => {
        if (canUndo && undo) {
            undo();
        }
    };

    // Handle redo button click
    const handleRedo = () => {
        if (canRedo && redo) {
            redo();
        }
    };

    // Handle auto-layout button click (async for ELK.js)
    const handleAutoLayout = async () => {
        if (nodes.length === 0 || !updatePositions) return;

        // Calculate new positions using selected layout engine
        const newPositions = await autoLayoutNodesAsync(nodes, edges);

        // Update positions directly in the canvas (bypasses store to avoid re-render loop)
        updatePositions(newPositions);

        // Smooth fit view after layout
        setTimeout(() => {
            reactFlowInstance?.fitView({ duration: 800, padding: 0.3 });
        }, 50);
    };

    const onDragOver = useCallback((event: React.DragEvent) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
    }, []);

    const onDropHandler = useCallback(
        (event: React.DragEvent) => {
            event.preventDefault();

            const rawData = event.dataTransfer.getData('application/reactflow');
            if (!rawData || !reactFlowInstance) return;

            let type: NodeType;
            let nodeTypeId: string | undefined;

            try {
                // Attempt to parse as JSON (structured drop)
                const payload = JSON.parse(rawData);
                type = payload.type;
                nodeTypeId = payload.node_type_id;
            } catch (e) {
                // Fallback for simple string drop (legacy/utility)
                type = rawData as NodeType;
            }

            const position = reactFlowInstance.screenToFlowPosition({
                x: event.clientX,
                y: event.clientY,
            });

            onDrop(type, position, nodeTypeId);
        },
        [reactFlowInstance, onDrop]
    );

    // Handle edge click to remove connection
    const handleEdgeClick = useCallback(
        (event: React.MouseEvent, edge: Edge) => {
            event.stopPropagation();
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

    // Prevent cycles and invalid handle connections
    const isValidConnection = useCallback(
        (connection: Connection) => {
            // Don't allow self-connections
            if (connection.source === connection.target) return false;

            const targetNode = nodes.find((node: any) => node.id === connection.target);
            if (!targetNode) return false;

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

            return !hasCycle(targetNode);
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

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (!reactFlowWrapper.current) return;
        const rect = reactFlowWrapper.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        reactFlowWrapper.current.style.setProperty('--mouse-x', `${x}px`);
        reactFlowWrapper.current.style.setProperty('--mouse-y', `${y}px`);
    }, []);

    return (
        <div 
            ref={reactFlowWrapper} 
            className="w-full h-full relative canvas-container" 
            onContextMenu={handleContextMenu}
            onMouseMove={handleMouseMove}
        >
            <div className="canvas-spotlight" />
            <ReactFlow
                nodes={displayNodes}
                edges={memoizedEdges}
                onNodesChange={handleNodesChangeThrottled}
                onEdgesChange={(changes) => {
                    onEdgesChange(changes);
                }}
                onConnect={(connection) => {
                    touchInteraction();
                    onConnect(connection);
                }}
                onNodeClick={onNodeClick}
                onNodeDrag={handleNodeDrag}
                onNodeDragStart={handleNodeDragStart}
                onNodeDragStop={handleNodeDragStop}
                onEdgeClick={handleEdgeClick}
                onInit={setReactFlowInstance}
                onDrop={onDropHandler}
                onDragOver={onDragOver}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}

                defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
                fitView
                fitViewOptions={{ padding: 0.3, maxZoom: 0.8 }}
                minZoom={0.1}
                maxZoom={2}
                deleteKeyCode="Delete"
                onNodesDelete={(deleted) => {
                    touchInteraction();
                    onNodesDelete(deleted);
                }}
                isValidConnection={isValidConnection}
                selectionOnDrag={!isPanMode}
                panOnDrag={isPanMode ? [0, 1] : [1]}
                panOnScroll={true}
                zoomOnScroll={false}
                zoomOnPinch={true}
                selectNodesOnDrag={false}
                connectionMode={"loose" as any}
                selectionMode={'partial' as any}
                onPaneClick={() => setContextMenu(null)}
                onMoveStart={() => setContextMenu(null)}
                proOptions={{ hideAttribution: true }}
            >
                <Background
                    variant={BackgroundVariant.Dots}
                    gap={16}
                    size={1.5}
                    style={{ backgroundColor: 'rgb(var(--canvas-bg))' }}
                    color="rgba(255, 255, 255, 0.18)"
                />

                <Panel position="bottom-center" className="!mb-4">
                    <div className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-surface-elevated/90 backdrop-blur-md border border-stroke-subtle shadow-xl">
                        <ToolbarButton
                            icon={Undo2}
                            onClick={handleUndo}
                            disabled={!canUndo}
                            title="Undo (Ctrl+Z)"
                        />
                        <ToolbarButton
                            icon={Redo2}
                            onClick={handleRedo}
                            disabled={!canRedo}
                            title="Redo (Ctrl+Y)"
                        />
                        <ToolbarDivider />

                        <ToolbarButton
                            icon={Network}
                            onClick={handleAutoLayout}
                            disabled={nodes.length === 0}
                            title="Auto Layout"
                        />
                        <ToolbarButton
                            icon={Hand}
                            onClick={() => setIsPanMode(!isPanMode)}
                            active={isPanMode}
                            title={isPanMode ? 'Exit Pan Mode' : 'Pan Mode'}
                        />
                        <ToolbarButton
                            icon={Maximize2}
                            onClick={() => reactFlowInstance?.fitView({ padding: 0.3, duration: 800 })}
                            title="Fit View"
                        />
                        <ToolbarDivider />

                        <ToolbarButton
                            icon={Minus}
                            onClick={() => reactFlowInstance?.zoomOut({ duration: 300 })}
                            title="Zoom Out"
                        />
                        <ZoomDisplay />
                        <ToolbarButton
                            icon={Plus}
                            onClick={() => reactFlowInstance?.zoomIn({ duration: 300 })}
                            title="Zoom In"
                        />
                    </div>
                </Panel>

                {multiSelectCount >= 2 && reactFlowInstance && (() => {
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
                                        if (selectedNodes.length > 0) {
                                            const selectedIds = new Set(selectedNodes.map((n: any) => n.id));
                                            const idMap = new Map<string, string>();
                                            const newNodes: any[] = [];
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
                                                        y: (node.position?.y || 0),
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

                                            if (onDuplicate) {
                                                onDuplicate(newNodes, newEdges);
                                            }
                                        }
                                    }}
                                    className="p-1.5 rounded bg-surface-elevated/95 border border-stroke-subtle text-content-secondary hover:bg-interactive-hover hover:text-accent-primary hover:border-accent-primary/30 transition-colors shadow-md"
                                    title="Copy selected nodes"
                                >
                                    <Copy className="w-4 h-4" />
                                </button>
                                <button
                                    onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); }}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (onDelete) {
                                            const ids = selectedNodes.map((n: any) => n.id);
                                            onDelete(ids);
                                        }
                                    }}
                                    className="p-1.5 rounded bg-surface-elevated/95 border border-stroke-subtle text-accent-error hover:bg-accent-error/10 hover:border-accent-error/30 transition-colors shadow-md"
                                    title="Delete selected nodes"
                                >
                                    <Trash2 className="w-4 h-4" />
                                </button>
                            </div>
                        </Panel>
                    );
                })()}
            </ReactFlow>

            {contextMenu && reactFlowWrapper.current && (
                <CanvasContextMenu
                    position={contextMenu}
                    canvasBounds={reactFlowWrapper.current.getBoundingClientRect()}
                    onSelectNode={handleContextMenuNodeSelect}
                    onClose={() => setContextMenu(null)}
                />
            )}
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

import { Tooltip } from '@/components/ui/Tooltip';

interface ToolbarButtonProps {
    icon: React.ComponentType<{ className?: string }>;
    onClick: () => void;
    disabled?: boolean;
    active?: boolean;
    title?: string;
}

function ToolbarButton({ icon: Icon, onClick, disabled, active, title }: ToolbarButtonProps) {
    const button = (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`
                w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-200
                ${disabled
                    ? 'opacity-40 cursor-not-allowed text-content-tertiary'
                    : active
                        ? 'bg-accent-primary text-content-inverted'
                        : 'text-content-primary hover:bg-surface-tertiary hover:text-accent-primary'
                }
            `}
        >
            <Icon className="w-4 h-4" />
        </button>
    );

    if (title && !disabled) {
        return (
            <Tooltip content={title} position="top">
                {button}
            </Tooltip>
        );
    }

    return button;
}

function ToolbarDivider() {
    return <div className="w-px h-5 bg-stroke-subtle mx-1" />;
}

function ZoomDisplay() {
    const { zoom } = useViewport();
    return (
        <span className="px-2 text-xs font-medium text-content-secondary min-w-[40px] text-center tabular-nums">
            {Math.round(zoom * 100)}%
        </span>
    );
}
