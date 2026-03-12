'use client';

import React, { useCallback, useRef, useEffect, useMemo, useState } from 'react';
import ReactFlow, {
    Background,
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
import { NodeType } from '@/lib/nodes/types';
import { clientRegistry } from '@/lib/nodes/core/client-registry';
import { sharedRegistry } from '@/lib/nodes/core/shared-registry';
import { useAppStore } from '@/lib/store/app-store';
import { Undo2, Redo2, Network, Trash2, Copy, Hand, Minus, Plus, Maximize2 } from 'lucide-react';
import { autoLayoutNodesAsync } from '@/lib/utils/graph-layout';
import CanvasContextMenu from './CanvasContextMenu';
import { useTheme } from '@/components/theme/ThemeProvider';

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

const nodeTypes = Object.entries(clientRegistry).reduce((acc, [type, def]) => {
    if (def.component) {
        acc[type] = def.component;
    }
    return acc;
}, {} as Record<string, React.ComponentType<any>>);

const edgeTypes = {};

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

    // Store Actions needed for Copy/Paste/Delete (can these be lifted too? yes but for now keep them or lift them)
    // The user instruction was "keep the buttons as they are and just replace the logic behind them".
    // The Toolbar buttons use handleUndo/handleRedo.
    // The keyboard shortcuts use undo/redo.
    const setIsDragging = useAppStore((state) => state.setIsDragging);
    // Removed old history actions
    const copyNode = useAppStore((state) => state.copyNode);
    const pasteNode = useAppStore((state) => state.pasteNode);


    // Get selected nodes
    const selectedNodes = useMemo(() => nodes.filter((n: any) => n.selected), [nodes]);
    const multiSelectCount = selectedNodes.length;

    // Edge style that uses CSS variables - recomputes when theme changes
    const edgeStyle = useMemo(() => ({
        strokeWidth: 2,
        stroke: 'rgb(var(--canvas-edge))',
        cursor: 'pointer',
    }), [resolvedTheme]);

    const touchInteraction = useAppStore((state) => state.touchInteraction);

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

        document.addEventListener('keydown', handleKeyDown, true); // Use capture phase
        return () => document.removeEventListener('keydown', handleKeyDown, true);
    }, [undo, redo, canUndo, canRedo, nodes, copyNode, pasteNode]);

    // Handle node drag start
    const handleNodeDragStart: NodeDragHandler = useCallback((event, node, nodes) => {
        setIsDragging(true);
        touchInteraction();
        if (onNodeDragStart) onNodeDragStart(event, node, nodes);
    }, [setIsDragging, onNodeDragStart, touchInteraction]);

    // Handle node drag stop
    const handleNodeDragStop: NodeDragHandler = useCallback((event, node, nodes) => {
        setIsDragging(false);
        touchInteraction();
        if (onNodeDragStop) onNodeDragStop(event, node, nodes);
    }, [setIsDragging, onNodeDragStop, touchInteraction]);

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

        // Log a sample position
        const firstEntry = Array.from(newPositions.entries())[0];


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

            const sourceNode = nodes.find((node: any) => node.id === connection.source);
            const targetNode = nodes.find((node: any) => node.id === connection.target);
            if (!sourceNode || !targetNode) return false;

            // Dynamic Validation using Shared Registry Mapping
            const sourceDef = sharedRegistry[sourceNode.type];
            const targetDef = sharedRegistry[targetNode.type];

            if (sourceDef && targetDef) {
                // Find specifics for Handles, else assume defaults
                const sourceOutput = sourceDef.handles.outputs.find(h => h.id === connection.sourceHandle) || sourceDef.handles.outputs[0];
                const targetInput = targetDef.handles.inputs.find(h => h.id === connection.targetHandle) || targetDef.handles.inputs[0];

                if (sourceOutput && targetInput) {
                    const sourceType = sourceOutput.dataType;
                    const expectedType = targetInput.expectedType;

                    if (sourceType !== 'any' && expectedType !== 'any') {
                        if (Array.isArray(expectedType)) {
                            if (!expectedType.includes(sourceType as any)) {
                                return false; // Mismatched specific handles
                            }
                        } else if (sourceType !== expectedType) {
                            return false; // Mismatched specific handles
                        }
                    }
                }
            }

            // Check if this connection would create a cycle

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

    return (
        <div ref={reactFlowWrapper} className="w-full h-full relative" onContextMenu={handleContextMenu}>
            {/* Toolbar now inside ReactFlow via Panel */}
            <ReactFlow
                nodes={nodes}
                edges={edges.map(e => ({
                    ...e,
                    type: 'default',
                    animated: false,
                    style: edgeStyle,
                }))}
                onNodesChange={(changes) => {
                    onNodesChange(changes);
                }}
                onEdgesChange={(changes) => {
                    onEdgesChange(changes);
                }}
                onConnect={(connection) => {
                    touchInteraction();
                    onConnect(connection);
                }}
                onNodeClick={onNodeClick}
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
                    size={1}
                    style={{ backgroundColor: 'rgb(var(--canvas-bg))' }}
                    color="rgb(var(--canvas-dots))"
                />

                {/* Unified Floating Bottom Toolbar */}
                <Panel position="bottom-center" className="!mb-4">
                    <div className="flex items-center gap-1 px-2 py-1.5 rounded-lg bg-surface-elevated/90 backdrop-blur-md border border-stroke-subtle shadow-xl">
                        {/* History Group */}
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

                        {/* Canvas Group */}
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

                        {/* Zoom Group */}
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

// ─────────────────────────────────────────────────────────────────────────────
// Toolbar Helper Components
// ─────────────────────────────────────────────────────────────────────────────

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

