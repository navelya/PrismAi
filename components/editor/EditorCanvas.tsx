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
    applyNodeChanges,
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
import {
    PendingConnection,
    getNodeHandleType,
} from '@/lib/editor/handle-compatibility';

// Stable references for <ReactFlow> object props — see
// https://reactflow.dev/learn/advanced-use/performance. Hoisted to module
// scope so they never change identity across renders.
const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 0.8 } as const;
const FIT_VIEW_OPTIONS = { padding: 0.3, maxZoom: 0.8 } as const;
const PRO_OPTIONS = { hideAttribution: true } as const;
const preventDefault = (e: React.DragEvent) => e.preventDefault();

interface EditorCanvasProps {
    nodes: any[];
    edges: any[];
    onNodesChange: any;
    onEdgesChange: any;
    onConnect: any;
    onNodeClick?: NodeMouseHandler;
    onDrop: (
        type: NodeType,
        position: { x: number; y: number },
        nodeTypeId?: string,
        modelId?: number,
        initialConfig?: Record<string, any>,
        autoConnect?: PendingConnection,
    ) => void;
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

const EditorCanvasInner = ({
    nodes: propNodes,
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
}: EditorCanvasProps) => {
    const reactFlowWrapper = useRef<HTMLDivElement>(null);
    const [reactFlowInstance, setReactFlowInstance] = React.useState<any>(null);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
    const [pendingConnection, setPendingConnection] = useState<PendingConnection | null>(null);
    // Screen-space anchor for the source handle of the dragged wire — used to
    // draw a static line from the handle to the open menu while the user picks.
    const [pendingWireAnchor, setPendingWireAnchor] = useState<{ x: number; y: number } | null>(null);
    // Holds the in-flight connection origin between onConnectStart and onConnectEnd.
    const connectStartRef = useRef<{ nodeId: string; handleId: string | null; handleType: 'source' | 'target' } | null>(null);
    // Timestamp of the last wire-drop menu open. React Flow can fire onPaneClick
    // right after a wire drop on the pane — ignore those clicks for a short window
    // so they don't immediately close the menu we just opened.
    const wireDropOpenedAtRef = useRef<number>(0);
    const [isPanMode, setIsPanMode] = useState(false);
    const [isMouseActive, setIsMouseActive] = useState(false);
    const mouseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const wrapperRectRef = useRef<{ left: number; top: number } | null>(null);
    const { resolvedTheme } = useTheme();

    const setIsDragging = useAppStore((state) => state.setIsDragging);
    const models = useAppStore((state) => state.models);
    
    // 🚀 THE CORE FIX: Local state for nodes during interaction
    const [localNodes, setLocalNodes] = useState(propNodes);
    
    // Sync local nodes when prop nodes change externally (but NOT while dragging)
    const isDraggingRef = useRef(false);
    useEffect(() => {
        if (!isDraggingRef.current) {
            setLocalNodes(propNodes);
        }
    }, [propNodes]);

    const { getRFNode, getRFNodes, getRFEdges } = {
        getRFNode: (id: string) => reactFlowInstance?.getNode(id),
        getRFNodes: () => reactFlowInstance?.getNodes() || [],
        getRFEdges: () => reactFlowInstance?.getEdges() || [],
    };

    const copyNode = useAppStore((state) => state.copyNode);
    const pasteNode = useAppStore((state) => state.pasteNode);

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

    // stableNodeTypes is a Proxy defined at module scope — see reactflow-types.ts.
    // Unknown ids resolve to AIGeneratorNode, so we don't need to rebuild this
    // object when ai_generator node type ids load.
    const nodeTypes = stableNodeTypes;
    const edgeTypes = stableEdgeTypes;

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

            const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
            const ctrlKey = isMac ? event.metaKey : event.ctrlKey;

            if (ctrlKey && event.key.toLowerCase() === 'z' && !event.shiftKey) {
                event.preventDefault();
                if (canUndo) undo?.();
                return;
            }

            if ((ctrlKey && event.key.toLowerCase() === 'y') || (ctrlKey && event.shiftKey && event.key.toLowerCase() === 'z')) {
                event.preventDefault();
                if (canRedo) redo?.();
                return;
            }
        };

        document.addEventListener('keydown', handleKeyDown, true);
        return () => document.removeEventListener('keydown', handleKeyDown, true);
    }, [undo, redo, canUndo, canRedo]);

    const handleNodesChange = useCallback((changes: NodeChange[]) => {
        // Update local state immediately for zero-lag UI
        setLocalNodes((nds) => applyNodeChanges(changes, nds));

        // Only propagate non-position changes to the global store immediately.
        // Position changes are batched and sent onDragStop.
        const structuralChanges = changes.filter(c => c.type !== 'position');
        if (structuralChanges.length > 0) {
            onNodesChange(structuralChanges);
        }
    }, [onNodesChange]);

    const handleNodeDragStart: NodeDragHandler = useCallback((event, node, nodes) => {
        isDraggingRef.current = true;
        setIsDragging(true);

        // 🚀 Z-INDEX FIX: Update local state immediately so the node
        // pops to the front the millisecond you grab it.
        setLocalNodes(nds => {
            const maxZ = Math.max(0, ...nds.map(n => n.zIndex || 0));
            if ((node.zIndex || 0) >= maxZ && maxZ > 0) return nds;
            return nds.map(n => n.id === node.id ? { ...n, zIndex: maxZ + 1 } : n);
        });

        if (onNodeDragStart) onNodeDragStart(event, node, nodes);
    }, [onNodeDragStart, setIsDragging]);

    const handleNodeDragStop: NodeDragHandler = useCallback((event, node, nodes) => {
        isDraggingRef.current = false;
        setIsDragging(false);

        // Sync final positions to global store
        const positionsMap = new Map<string, { x: number; y: number }>();
        nodes.forEach(n => positionsMap.set(n.id, n.position));

        if (updatePositions) {
            updatePositions(positionsMap);
        }

        // Commit the z-index pop applied locally in handleNodeDragStart so it
        // survives the next prop sync. Doing it here instead of drag-start
        // keeps the global store write away from the moment of interaction.
        useAppStore.getState().bringNodeToFront(node.id);

        touchInteraction();
        if (onNodeDragStop) onNodeDragStop(event, node, nodes);
    }, [setIsDragging, onNodeDragStop, touchInteraction, updatePositions]);

    const handleEdgesChange = useCallback((changes: any) => {
        touchInteraction();
        onEdgesChange(changes);
    }, [touchInteraction, onEdgesChange]);

    const handleConnect = useCallback((connection: Connection) => {
        touchInteraction();
        onConnect(connection);
    }, [touchInteraction, onConnect]);

    // Capture the originating side of a connection drag so we can filter the
    // context menu by data-type compatibility when it ends on empty canvas.
    const handleConnectStart = useCallback((_event: any, params: { nodeId: string | null; handleId: string | null; handleType: 'source' | 'target' | null }) => {
        if (!params.nodeId || !params.handleType) return;
        connectStartRef.current = {
            nodeId: params.nodeId,
            handleId: params.handleId,
            handleType: params.handleType,
        };
    }, []);

    // Wire dropped on canvas (not on a handle/node) → open the filtered context
    // menu so the user can pick a compatible node and have it auto-wired.
    const handleConnectEnd = useCallback((event: MouseEvent | TouchEvent) => {
        const start = connectStartRef.current;
        connectStartRef.current = null;
        if (!start) return;

        const clientX = 'clientX' in event
            ? (event as MouseEvent).clientX
            : (event as TouchEvent).changedTouches?.[0]?.clientX ?? 0;
        const clientY = 'clientY' in event
            ? (event as MouseEvent).clientY
            : (event as TouchEvent).changedTouches?.[0]?.clientY ?? 0;

        // Use the element under the actual drop point (event.target during a
        // connection drag is often the SVG connection line itself, not the pane).
        const elAtPoint = document.elementFromPoint(clientX, clientY) as Element | null;
        const target = elAtPoint || (event.target as Element | null);

        // If we dropped on a handle, React Flow's onConnect already handled it.
        // If we dropped on a node body but not a handle, we also don't want to
        // spawn a new node. Anything else (pane, grid, viewport) is fair game.
        if (target?.closest?.('.react-flow__handle')) return;
        if (target?.closest?.('.react-flow__node')) return;

        const sourceNode = reactFlowInstance?.getNode(start.nodeId);
        const models = useAppStore.getState().models;
        const handleInfo = getNodeHandleType(sourceNode, start.handleId, start.handleType, models, sharedRegistry);
        // If we can't resolve the source handle's type, fall back to 'any' so
        // the user still gets a menu (just not type-filtered).
        const dataType = handleInfo?.type ?? 'any';

        // Snapshot the source handle's screen position so we can draw a static
        // wire from it to the menu while the user picks a node.
        const handleSelector = start.handleId
            ? `.react-flow__handle[data-nodeid="${start.nodeId}"][data-handleid="${start.handleId}"]`
            : `.react-flow__handle[data-nodeid="${start.nodeId}"].${start.handleType}`;
        const handleEl = document.querySelector(handleSelector) as HTMLElement | null;
        const handleRect = handleEl?.getBoundingClientRect();
        const wrapperRect = reactFlowWrapper.current?.getBoundingClientRect();
        if (handleRect && wrapperRect) {
            setPendingWireAnchor({
                x: handleRect.left + handleRect.width / 2 - wrapperRect.left,
                y: handleRect.top + handleRect.height / 2 - wrapperRect.top,
            });
        }

        setPendingConnection({
            nodeId: start.nodeId,
            handleId: start.handleId,
            handleType: start.handleType,
            dataType,
            isArray: handleInfo?.isArray,
        });
        setContextMenu({ x: clientX, y: clientY });
        wireDropOpenedAtRef.current = Date.now();
    }, [reactFlowInstance]);

    const handleEdgeClick = useCallback((e: React.MouseEvent, edge: Edge) => {
        e.stopPropagation();
        touchInteraction();
        onEdgesChange([{ type: 'remove', id: edge.id }]);
    }, [touchInteraction, onEdgesChange]);

    const handleDrop = useCallback((event: React.DragEvent) => {
        event.preventDefault();
        const rawData = event.dataTransfer.getData('application/reactflow');
        if (!rawData || !reactFlowInstance) return;
        try {
            const payload = JSON.parse(rawData);
            const position = reactFlowInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY });
            onDrop(payload.type, position, payload.node_type_id, undefined, payload.initialConfig);
        } catch (e) { /* fallback */ }
    }, [reactFlowInstance, onDrop]);

    const handleNodesDelete = useCallback((deleted: any[]) => {
        touchInteraction();
        onDelete?.(deleted.map(n => n.id));
    }, [touchInteraction, onDelete]);

    const handleIsValidConnection = useCallback((connection: Connection) => {
        if (connection.source === connection.target) return false;
        return true;
    }, []);

    const handlePaneClick = useCallback(() => {
        // Ignore the trailing pane click that React Flow fires immediately after
        // a wire-drop on the pane — otherwise it closes the menu we just opened.
        if (Date.now() - wireDropOpenedAtRef.current < 300) return;
        setContextMenu(null);
        setPendingConnection(null);
        setPendingWireAnchor(null);
    }, []);

    useEffect(() => {
        const updateRect = () => {
            if (!reactFlowWrapper.current) return;
            const r = reactFlowWrapper.current.getBoundingClientRect();
            wrapperRectRef.current = { left: r.left, top: r.top };
        };
        updateRect();
        window.addEventListener('resize', updateRect);
        return () => window.removeEventListener('resize', updateRect);
    }, []);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        if (!reactFlowWrapper.current) return;
        setIsMouseActive(true);
        if (mouseTimeoutRef.current) clearTimeout(mouseTimeoutRef.current);
        mouseTimeoutRef.current = setTimeout(() => setIsMouseActive(false), 600);

        const rect = wrapperRectRef.current;
        if (!rect) return;
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        reactFlowWrapper.current.style.setProperty('--mouse-x', `${x}px`);
        reactFlowWrapper.current.style.setProperty('--mouse-y', `${y}px`);
    }, []);

    return (
        <div
            ref={reactFlowWrapper}
            className="w-full h-full relative canvas-container"
            onContextMenu={(e) => {
                // CanvasContextMenu dispatches a synthetic contextmenu event on mount
                // (to drive Radix's Trigger). Don't treat that as a fresh user gesture
                // — otherwise it wipes the pendingConnection we just set on wire-drop.
                if ((e.nativeEvent as any)._isSynthetic) return;
                e.preventDefault();
                if ((e.target as HTMLElement).closest('.react-flow__node')) return;
                setPendingConnection(null);
                setPendingWireAnchor(null);
                setContextMenu({ x: e.clientX, y: e.clientY });
            }}
            onMouseMove={handleMouseMove}
            onMouseLeave={() => setIsMouseActive(false)}
        >
            <ReactFlow
                nodes={localNodes}
                edges={memoizedEdges}
                onNodesChange={handleNodesChange}
                onEdgesChange={handleEdgesChange}
                onConnect={handleConnect}
                onConnectStart={handleConnectStart}
                onConnectEnd={handleConnectEnd}
                onNodeClick={onNodeClick}
                onNodeDragStart={handleNodeDragStart}
                onNodeDragStop={handleNodeDragStop}
                onEdgeClick={handleEdgeClick}
                onInit={setReactFlowInstance}
                onDrop={handleDrop}
                onDragOver={preventDefault}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                defaultViewport={DEFAULT_VIEWPORT}
                fitView
                fitViewOptions={FIT_VIEW_OPTIONS}
                minZoom={0.1}
                maxZoom={2}
                nodeDragThreshold={0}
                deleteKeyCode="Delete"
                onNodesDelete={handleNodesDelete}
                isValidConnection={handleIsValidConnection}
                panOnScroll={true}
                zoomOnScroll={false}
                zoomOnPinch={true}
                selectNodesOnDrag={false}
                connectionMode={"loose" as any}
                onPaneClick={handlePaneClick}
                proOptions={PRO_OPTIONS}
            >
                <BaseGridLayers />
                <SpotlightGridLayers isMouseActive={isMouseActive} />
                <CanvasToolbar
                    undo={undo}
                    redo={redo}
                    canUndo={canUndo}
                    canRedo={canRedo}
                    onAutoLayout={async () => {
                        if (localNodes.length === 0 || !updatePositions) return;
                        const newPositions = await autoLayoutNodesAsync(localNodes, edges);
                        updatePositions(newPositions);
                    }}
                    isPanMode={isPanMode}
                    onTogglePanMode={setIsPanMode}
                    onFitView={() => reactFlowInstance?.fitView({ padding: 0.3, duration: 800 })}
                    onZoomIn={() => reactFlowInstance?.zoomIn({ duration: 300 })}
                    onZoomOut={() => reactFlowInstance?.zoomOut({ duration: 300 })}
                    isNodesEmpty={localNodes.length === 0}
                />
            </ReactFlow>

            {/* Static "ghost" wire from the source handle to the open menu while
                the user picks a node. The SVG covers the wrapper but lets clicks
                through (pointer-events: none). */}
            {pendingConnection && pendingWireAnchor && contextMenu && wrapperRectRef.current && (
                <svg
                    className="absolute inset-0 pointer-events-none z-[40]"
                    width="100%"
                    height="100%"
                    style={{ overflow: 'visible' }}
                >
                    <path
                        d={(() => {
                            const sx = pendingWireAnchor.x;
                            const sy = pendingWireAnchor.y;
                            const tx = contextMenu.x - wrapperRectRef.current.left;
                            const ty = contextMenu.y - wrapperRectRef.current.top;
                            const dx = Math.max(40, Math.abs(tx - sx) * 0.5);
                            const c1x = pendingConnection.handleType === 'source' ? sx + dx : sx - dx;
                            const c2x = pendingConnection.handleType === 'source' ? tx - dx : tx + dx;
                            return `M ${sx} ${sy} C ${c1x} ${sy}, ${c2x} ${ty}, ${tx} ${ty}`;
                        })()}
                        fill="none"
                        stroke="rgb(var(--canvas-edge))"
                        strokeWidth={2}
                    />
                </svg>
            )}

            {contextMenu && (
                <CanvasContextMenu
                    position={contextMenu}
                    pendingConnection={pendingConnection}
                    onSelectNode={(type, pos, tid, mid) => {
                        const flowPos = reactFlowInstance.screenToFlowPosition({ x: pos.x, y: pos.y });
                        onDrop(type, flowPos, tid, mid, undefined, pendingConnection || undefined);
                        setContextMenu(null);
                        setPendingConnection(null);
                        setPendingWireAnchor(null);
                    }}
                    onClose={() => {
                        setContextMenu(null);
                        setPendingConnection(null);
                        setPendingWireAnchor(null);
                    }}
                    models={models}
                />
            )}
        </div>
    );
};

export default function EditorCanvas(props: EditorCanvasProps) {
    return (
        <ReactFlowProvider>
            <EditorCanvasInner {...props} />
        </ReactFlowProvider>
    );
}
