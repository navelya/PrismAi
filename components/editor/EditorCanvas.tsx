'use client';

import React, { useCallback, useRef, useEffect, useMemo, useState } from 'react';
import ReactFlow, {
    NodeMouseHandler,
    ReactFlowProvider,
    Edge,
    NodeDragHandler,
    NodeChange,
    getIncomers,
    getOutgoers,
    getConnectedEdges,
    Connection,
    Panel,
    useReactFlow,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { BaseGridLayers, SpotlightGridLayers } from './canvas/GridLayers';
import { CanvasToolbar } from './canvas/CanvasToolbar';
import { NodeType } from '@/lib/nodes/types';
import { useAppStore } from '@/lib/store/app-store';
import { Trash2, Copy } from 'lucide-react';
import { autoLayoutNodesAsync } from '@/lib/utils/graph-layout';
import CanvasContextMenu from './CanvasContextMenu';
import { stableNodeTypes, stableEdgeTypes } from './reactflow-types';
import { useTheme } from '@/components/theme/ThemeProvider';
import { sharedRegistry } from '@/lib/nodes/core/shared-registry';

interface EditorCanvasProps {
    nodes: any[];
    edges: any[];
    onNodesChange: any;
    onEdgesChange: any;
    onConnect: any;
    onNodeClick?: NodeMouseHandler;
    onDrop: (type: NodeType, position: { x: number; y: number }, nodeTypeId?: string, modelId?: number) => void;
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
    undo,
    redo,
    canUndo,
    canRedo,
    onNodeDragStart,
    onNodeDragStop,
    onDuplicate,
    onDelete,
}: EditorCanvasProps) {
    const reactFlowWrapper = useRef<HTMLDivElement>(null);
    const [reactFlowInstance, setReactFlowInstance] = React.useState<any>(null);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
    const [isPanMode, setIsPanMode] = useState(false);
    const [isMouseActive, setIsMouseActive] = useState(false);
    const mouseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const { resolvedTheme } = useTheme();

    const setIsDragging = useAppStore((state) => state.setIsDragging);
    const models = useAppStore((state) => state.models);
    const [liveNodePositions, setLiveNodePositions] = useState<Record<string, { x: number; y: number }>>({});
    const liveNodePositionsRef = useRef<Record<string, { x: number; y: number }>>({});
    const pendingLivePositionsRef = useRef<Record<string, { x: number; y: number }>>({});
    const liveDragRafIdRef = useRef<number | null>(null);

    // Stable primitive key — only changes when the actual set of DB node type IDs changes.
    // Using a string avoids the reference-equality trap that causes the #002 warning.
    const nodeTypeIds = useAppStore((state: any) =>
        (state.nodeTypes as any[]).map((nt) => nt.id).sort().join(',')
    );
    // Pre-build a Set for O(1) lookup inside isValidConnection
    const aiNodeTypeIds = useMemo(() => new Set(nodeTypeIds.split(',').filter(Boolean)), [nodeTypeIds]);

    // useReactFlow gives us always-fresh node/edge data from ReactFlow's own store.
    // This is critical: it bypasses the staleness of the `nodes` prop after model switches.
    const { getNode: getRFNode, getNodes: getRFNodes, getEdges: getRFEdges } = useReactFlow();

    const copyNode = useAppStore((state) => state.copyNode);
    const pasteNode = useAppStore((state) => state.pasteNode);

    const flushLivePositions = useCallback(() => {
        liveDragRafIdRef.current = null;
        const pendingUpdates = pendingLivePositionsRef.current;
        pendingLivePositionsRef.current = {};

        const pendingEntries = Object.entries(pendingUpdates);
        if (pendingEntries.length === 0) return;

        const nextLivePositions = { ...liveNodePositionsRef.current };
        let changed = false;

        pendingEntries.forEach(([id, position]) => {
            const previous = nextLivePositions[id];
            if (!previous || previous.x !== position.x || previous.y !== position.y) {
                nextLivePositions[id] = position;
                changed = true;
            }
        });

        if (changed) {
            liveNodePositionsRef.current = nextLivePositions;
            setLiveNodePositions(nextLivePositions);
        }
    }, []);

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


    // nodeTypes object for <ReactFlow nodeTypes={...}>.
    // Keyed off a stable string so useMemo only recreates when DB node types actually change.
    const nodeTypes = useMemo(() => {
        const dynamicTypes: Record<string, React.ComponentType<any>> = {};
        nodeTypeIds.split(',').filter(Boolean).forEach(ntId => {
            dynamicTypes[ntId] = stableNodeTypes.ai_generator;
        });
        return { ...stableNodeTypes, ...dynamicTypes };
    }, [nodeTypeIds]);
    
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
                const selectedNodes = getRFNodes().filter((n: any) => n.selected);
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
    }, [undo, redo, canUndo, canRedo, copyNode, pasteNode, getRFNodes]);

    // Handle node drag
    const handleNodeDrag: NodeDragHandler = useCallback((_event, node) => {
        pendingLivePositionsRef.current[node.id] = node.position;
        if (liveDragRafIdRef.current === null) {
            liveDragRafIdRef.current = requestAnimationFrame(flushLivePositions);
        }
    }, [flushLivePositions]);

    // Handle node drag start
    const handleNodeDragStart: NodeDragHandler = useCallback((event, node, nodes) => {
        setIsDragging(true);
        touchInteraction();
        if (onNodeDragStart) onNodeDragStart(event, node, nodes);
    }, [setIsDragging, onNodeDragStart, touchInteraction]);

    // Handle node drag stop
    const handleNodeDragStop: NodeDragHandler = useCallback((event, node, nodes) => {
        if (liveDragRafIdRef.current !== null) {
            cancelAnimationFrame(liveDragRafIdRef.current);
            liveDragRafIdRef.current = null;
        }
        flushLivePositions();

        const positionsMap = new Map<string, { x: number; y: number }>();
        Object.entries(liveNodePositionsRef.current).forEach(([id, pos]) => {
            positionsMap.set(id, pos);
        });
        if (positionsMap.size === 0) {
            positionsMap.set(node.id, node.position);
        }

        // 🛡️ SYNC FIX: Update the hook first (the owner of state)
        if (updatePositions && positionsMap.size > 0) {
            updatePositions(positionsMap);
        }

        liveNodePositionsRef.current = {};
        pendingLivePositionsRef.current = {};
        setLiveNodePositions({});
        setIsDragging(false);
        touchInteraction();

        if (onNodeDragStop) onNodeDragStop(event, node, nodes);
    }, [setIsDragging, onNodeDragStop, touchInteraction, updatePositions, flushLivePositions]);

    // Throttle high-frequency node change events (drag) to the next animation frame
    const pendingNodeChanges = useRef<Map<string, NodeChange>>(new Map());
    const nodeChangeRafId = useRef<number | null>(null);

    const flushNodeChanges = useCallback(() => {
        if (pendingNodeChanges.current.size > 0) {
            const changes = Array.from(pendingNodeChanges.current.values());
            pendingNodeChanges.current.clear();

            // Filter out position changes during drag - they are handled by liveNodePositions
            // BUT if we are NOT dragging (e.g. final drop), we must include them to sync React Flow's state
            const isDragging = useAppStore.getState().isDragging;
            const importantChanges = isDragging
                ? changes.filter(c => c.type !== 'position')
                : changes;

            if (importantChanges.length > 0) {
                onNodesChange(importantChanges);
            }
        }
        nodeChangeRafId.current = null;
    }, [onNodesChange]);

    const handleNodesChangeThrottled = useCallback((changes: NodeChange[]) => {
        changes.forEach((change, index) => {
            let key = `${change.type}:${index}`;
            if ('id' in change && change.id) {
                key = `${change.type}:${change.id}`;
            } else if (change.type === 'add' && 'item' in change && change.item?.id) {
                key = `add:${change.item.id}`;
            } else if (change.type === 'reset') {
                key = 'reset';
            }
            pendingNodeChanges.current.set(key, change);
        });

        if (nodeChangeRafId.current === null) {
            nodeChangeRafId.current = requestAnimationFrame(flushNodeChanges);
        }
    }, [flushNodeChanges]);

    // 🛡️ UX FIX: Prevent global browser zoom (Ctrl + MouseWheel) when interacting with the app.
    // This ensures that Ctrl+Scroll only zooms the canvas and doesn't scale the whole UI.
    useEffect(() => {
        const handleWheel = (event: WheelEvent) => {
            if (event.ctrlKey) {
                event.preventDefault();
            }
        };

        window.addEventListener('wheel', handleWheel, { passive: false });
        // Also capture cmd+scroll on mac if needed (though usually it's the same wheel event)
        return () => window.removeEventListener('wheel', handleWheel);
    }, []);

    useEffect(() => {
        return () => {
            if (nodeChangeRafId.current) {
                cancelAnimationFrame(nodeChangeRafId.current);
            }
            if (liveDragRafIdRef.current) {
                cancelAnimationFrame(liveDragRafIdRef.current);
            }
            if (mouseTimeoutRef.current) {
                clearTimeout(mouseTimeoutRef.current);
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

    // Global connection validator — single source of truth for ALL connection rules.
    // IMPORTANT: uses getRFNode/getRFNodes/getRFEdges (React Flow's internal store) NOT
    // the `nodes`/`edges` props, because those props can lag behind after a model switch.
    const isValidConnection = useCallback(
        (connection: Connection) => {
            if (connection.source === connection.target) return false;

            // Always-fresh node data from ReactFlow's internal store
            const sourceNode = getRFNode(connection.source!);
            const targetNode = getRFNode(connection.target!);
            if (!sourceNode || !targetNode) return false;

            // Cycle check (DFS) using fresh ReactFlow data
            const rfNodes = getRFNodes();
            const rfEdges = getRFEdges();
            const hasCycle = (node: any, visited = new Set<string>()): boolean => {
                if (visited.has(node.id)) return false;
                visited.add(node.id);
                for (const outgoer of getOutgoers(node, rfNodes, rfEdges)) {
                    if (outgoer.id === connection.source) return true;
                    if (hasCycle(outgoer, visited)) return true;
                }
                return false;
            };
            if (hasCycle(targetNode)) return false;

            // Helper: is this node type an AI generator?
            const isAiNode = (nodeType: string | undefined) =>
                !!nodeType && (nodeType === 'ai_generator' || aiNodeTypeIds.has(nodeType));

            // Helper: resolve a handle definition's wire type
            const resolveType = (def: any): string =>
                String(def?.type || def?.dataType || 'any').toLowerCase();

            // 1. Resolve source handle type
            const sourceHandleId = connection.sourceHandle;
            let sourceHandleDef: any = null;
            const sourceNodeType = sourceNode.type ?? '';

            if (isAiNode(sourceNodeType)) {
                const model = models.find((m: any) => Number(m.id) === Number(sourceNode.data?.config?.model_id));
                sourceHandleDef = model?.outputs_schema?.handles?.find(
                    (h: any) => (h.api_mapping_key || h.name) === sourceHandleId
                ) ?? model?.outputs_schema?.handles?.[0];
            } else {
                const def = sharedRegistry[sourceNodeType as keyof typeof sharedRegistry];
                const outputs = def?.handles?.outputs ?? [];
                sourceHandleDef = outputs.find((h: any) => h.id === sourceHandleId)
                    ?? (outputs.length === 1 ? outputs[0] : null);
            }

            // 2. Resolve target handle type and is_array
            const targetHandleId = connection.targetHandle;
            let targetHandleDef: any = null;
            const targetNodeType = targetNode.type ?? '';

            if (isAiNode(targetNodeType)) {
                const model = models.find((m: any) => Number(m.id) === Number(targetNode.data?.config?.model_id));
                targetHandleDef = model?.inputs_schema?.handles?.find(
                    (h: any) => (h.api_mapping_key || h.name) === targetHandleId
                ) ?? null;
            } else {
                const def = sharedRegistry[targetNodeType as keyof typeof sharedRegistry];
                const inputs = def?.handles?.inputs ?? [];
                targetHandleDef = inputs.find((h: any) => h.id === targetHandleId)
                    ?? inputs[0] ?? null;
            }

            // 3. Type compatibility
            const sourceType = resolveType(sourceHandleDef);
            const targetType = resolveType(targetHandleDef);

            if (sourceType !== 'any' && targetType !== 'any') {
                const normSource = sourceType.replace('_array', '');
                const normTarget = targetType.replace('_array', '');
                if (normSource !== normTarget) return false;
            }

            // 4. Connection limit (skip for array-type handles)
            const isArray = !!(targetHandleDef?.is_array) || targetType.endsWith('_array');
            if (!isArray) {
                const existing = rfEdges.filter(
                    (e: any) => e.target === connection.target && e.targetHandle === targetHandleId
                );
                if (existing.length >= 1) return false;
            }

            return true;
        },
        [getRFNode, getRFNodes, getRFEdges, models, aiNodeTypeIds]
    );

    // Context menu right-click handler
    const handleContextMenu = useCallback((event: React.MouseEvent) => {
        // Ignore our own synthetic events to prevent infinite loops
        if ((event.nativeEvent as any)._isSynthetic) return;
        
        event.preventDefault();
        // Only open if we're clicking on the canvas, not on nodes
        const target = event.target as HTMLElement;
        if (target.closest('.react-flow__node')) {
            return; // Clicked on a node, don't show context menu
        }
        setContextMenu({ x: event.clientX, y: event.clientY });
    }, []);

    // Handle node creation from context menu
    const handleContextMenuNodeSelect = useCallback((type: NodeType, position: { x: number; y: number }, nodeTypeId?: string, modelId?: number) => {
        if (reactFlowInstance && reactFlowWrapper.current) {
            // Convert screen coordinates to flow coordinates
            const flowPosition = reactFlowInstance.screenToFlowPosition({
                x: position.x,
                y: position.y,
            });
            onDrop(type, flowPosition, nodeTypeId, modelId);
        }
        setContextMenu(null);
    }, [reactFlowInstance, onDrop]);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (!reactFlowWrapper.current) return;

        setIsMouseActive(true);
        if (mouseTimeoutRef.current) {
            clearTimeout(mouseTimeoutRef.current);
        }
        mouseTimeoutRef.current = setTimeout(() => {
            setIsMouseActive(false);
        }, 600);

        const rect = reactFlowWrapper.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        reactFlowWrapper.current.style.setProperty('--mouse-x', `${x}px`);
        reactFlowWrapper.current.style.setProperty('--mouse-y', `${y}px`);
    }, []);

    const handleMouseLeave = useCallback(() => {
        setIsMouseActive(false);
        if (mouseTimeoutRef.current) {
            clearTimeout(mouseTimeoutRef.current);
        }
    }, []);

    return (
        <div
            ref={reactFlowWrapper}
            className="w-full h-full relative canvas-container"
            onContextMenu={handleContextMenu}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
        >

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
                {/* 1. Base Grid (Isolated for zero-lag zooming) */}
                <BaseGridLayers />

                {/* 3. Mouse Spotlight Grid (Isolated for zero-lag zooming) */}
                <SpotlightGridLayers isMouseActive={isMouseActive} />

                <CanvasToolbar
                    undo={handleUndo}
                    redo={handleRedo}
                    canUndo={canUndo}
                    canRedo={canRedo}
                    onAutoLayout={handleAutoLayout}
                    isPanMode={isPanMode}
                    onTogglePanMode={setIsPanMode}
                    onFitView={() => reactFlowInstance?.fitView({ padding: 0.3, duration: 800 })}
                    onZoomIn={() => reactFlowInstance?.zoomIn({ duration: 300 })}
                    onZoomOut={() => reactFlowInstance?.zoomOut({ duration: 300 })}
                    isNodesEmpty={nodes.length === 0}
                />

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
                    onSelectNode={handleContextMenuNodeSelect}
                    onClose={() => setContextMenu(null)}
                    models={useAppStore.getState().models}
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

