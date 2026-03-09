'use client';

import { useState, useCallback, useEffect, useRef, useLayoutEffect } from 'react';
import { applyNodeChanges, applyEdgeChanges, addEdge, Connection, Edge, NodeChange, EdgeChange, NodeDragHandler } from 'reactflow';
import type { Node } from 'reactflow';
import { WorkflowNode, WorkflowEdge, Workflow, NodeType } from '@/lib/nodes/types';
import { createNodeFromType } from '@/lib/editor/node-factory';
import { generateEdgeId } from '@/lib/utils';
import { autoLayoutNodesAsync } from '@/lib/utils/graph-layout';
import { stableStringify } from '@/lib/utils/stable-stringify';
import { useUndoRedo } from '@/lib/hooks/use-undo-redo';

import { useAppStore } from '@/lib/store/app-store';

// Types for the internal state of the hook
interface EditorState {
    nodes: any[];
    edges: any[];
    name: string;
}

export function useWorkflowEditor(initialWorkflow?: Workflow | null) {
    const nodeStatuses = useAppStore((state) => state.nodeStatuses);
    const nodeOutputs = useAppStore((state) => state.nodeOutputs);
    const touchInteraction = useAppStore((state) => state.touchInteraction);

    // Create a stable identity for the workflow to detect changes
    const getWorkflowIdentity = (wf: Workflow | null | undefined) => {
        if (!wf) return 'empty';
        // ⚠️ CRITICAL: Do NOT use node/edge counts here. 
        // Local state updates (add/delete) change counts, which would trigger a history RESET if we included them.
        // We only want to reset history if we truly switched to a DIFFERENT workflow document.
        if (wf.id) return `id:${wf.id}`;
        return `name:${wf.name}`; // Fallback for unsaved/new workflows
    };

    const currentIdentity = getWorkflowIdentity(initialWorkflow);
    const prevIdentityRef = useRef<string | null>(null);

    // Compute initial values
    const getInitialNodes = (wf: Workflow | null | undefined) => {
        if (!wf?.nodes) return [];
        return wf.nodes.map(n => ({
            id: n.id,
            type: n.type,
            position: n.position || { x: 0, y: 0 },
            data: n.data,
            zIndex: n.zIndex || 0,
            // selected: false, // Ensure selected state is not initially set from legacy data if possible? ReactFlow handles selection internally on nodes.
        }));
    };

    const getInitialEdges = (wf: Workflow | null | undefined) => {
        if (!wf?.edges) return [];
        return wf.edges.map(e => ({
            id: e.id,
            source: e.source,
            target: e.target,
            type: 'smoothstep',
            animated: true,
            sourceHandle: e.sourceHandle,
            targetHandle: e.targetHandle,
        }));
    };

    const initialEditorState: EditorState = {
        nodes: getInitialNodes(initialWorkflow),
        edges: getInitialEdges(initialWorkflow),
        name: initialWorkflow?.name || 'Untitled Workflow',
    };

    // Initialize Undo/Redo Hook
    const {
        state: editorState,
        set: setEditorState,
        undo,
        redo,
        canUndo,
        canRedo,
        reset: resetEditorState,
        history: debugHistory // For debugging if needed
    } = useUndoRedo<EditorState>(initialEditorState, { limit: 50, enableShortcuts: false }); // Shortcuts handled by EditorCanvas listeners or global?
    // Handling shortcuts in EditorCanvas or a global listener is better. EditorCanvas has a listener.
    // So we don't enable shortcuts here to avoid conflict if not focused?
    // Actually EditorCanvas listener calls these undo/redo methods.

    const [selectedNode, setSelectedNode] = useState<string | null>(null);

    // Track the last workflow we loaded to avoid re-rendering during drag
    const lastLoadedWorkflowRef = useRef<string | null>(null);

    // ⭐ CRITICAL FIX: Use useLayoutEffect for SYNCHRONOUS state reset before paint
    useLayoutEffect(() => {
        // Skip the first render (when prevIdentityRef is null)
        if (prevIdentityRef.current === null) {
            prevIdentityRef.current = currentIdentity;
            return;
        }

        // Only reset if identity actually changed
        if (prevIdentityRef.current !== currentIdentity) {
            prevIdentityRef.current = currentIdentity;
            lastLoadedWorkflowRef.current = null;

            const newState: EditorState = {
                nodes: getInitialNodes(initialWorkflow),
                edges: getInitialEdges(initialWorkflow),
                name: initialWorkflow?.name || 'Untitled Workflow',
            };

            resetEditorState(newState);
            setSelectedNode(null);
        }
    }, [currentIdentity, initialWorkflow, resetEditorState]);

    // ⭐ Main effect to update state when workflow changes from outside (e.g. loaded from DB)
    useEffect(() => {
        if (initialWorkflow && initialWorkflow.nodes && initialWorkflow.nodes.length > 0) {
            const sortedNodes = [...initialWorkflow.nodes].sort((a, b) => a.id.localeCompare(b.id));
            const configHash = stableStringify(sortedNodes.map(n => ({ id: n.id, data: n.data })));
            const workflowId = `${initialWorkflow.name}-${initialWorkflow.nodes.length}-${initialWorkflow.edges.length}-${configHash}`;

            if (lastLoadedWorkflowRef.current !== workflowId) {
                lastLoadedWorkflowRef.current = workflowId;

                // Process Nodes (Dedupe & Layout)
                const uniqueNodes = new Map();
                initialWorkflow.nodes.forEach(n => {
                    if (!uniqueNodes.has(n.id)) {
                        uniqueNodes.set(n.id, {
                            id: n.id,
                            type: n.type,
                            position: n.position || { x: 0, y: 0 },
                            data: n.data,
                            zIndex: n.zIndex || 0,
                        });
                    }
                });
                const newNodes = Array.from(uniqueNodes.values());

                const uniqueEdges = new Map();
                initialWorkflow.edges.forEach(e => {
                    const edgeId = e.id || `e-${e.source}-${e.target}`;
                    if (!uniqueEdges.has(edgeId)) {
                        uniqueEdges.set(edgeId, {
                            id: edgeId,
                            source: e.source,
                            target: e.target,
                            sourceHandle: e.sourceHandle,
                            targetHandle: e.targetHandle,
                            type: 'smoothstep',
                            animated: true,
                        });
                    }
                });
                const newEdges = Array.from(uniqueEdges.values());

                const needsLayout = newNodes.length > 0 && newNodes.every(n => {
                    // קוד הגנתי: אם מסיבה כלשהי (היסטוריה ישנה או שגיאת AI) אין מיקום, נשתמש ב-0,0
                    const pos = n.position || { x: 0, y: 0 };
                    return (pos.x === 0 && pos.y === 0) || (pos.x === 0 && pos.y === 100);
                });

                if (needsLayout) {
                    autoLayoutNodesAsync(newNodes, newEdges).then(layoutedPositions => {
                        const layoutedNodes = newNodes.map(n => {
                            const pos = layoutedPositions.get(n.id);
                            return pos ? { ...n, position: pos } : n;
                        });
                        setEditorState({ nodes: layoutedNodes, edges: newEdges, name: initialWorkflow.name }, { history: 'replace' });
                    });
                } else {
                    setEditorState({ nodes: newNodes, edges: newEdges, name: initialWorkflow.name }, { history: 'replace' });
                }
            }
        }
    }, [initialWorkflow, setEditorState, resetEditorState]);

    // 👑 SYNC OUTPUTS: Watch the global store for node outputs (thumbnails/results) 
    // and sync them into the local 'nodes' array data. This is CRITICAL for 
    // persistence, as the editor's auto-save uses this local data. 
    // We specifically do NOT sync 'nodeStatuses' here to avoid the rendering 
    // feedback loop bug — status is handled directly by CustomNode.tsx.
    useEffect(() => {
        const outputIds = Object.keys(nodeOutputs);
        if (outputIds.length === 0) return;

        setEditorState((prev) => {
            let changed = false;
            const newNodes = prev.nodes.map((node) => {
                const globalOutput = nodeOutputs[node.id];
                if (globalOutput === undefined) return node;

                // Only update if the output has actually changed (to prevent loops)
                // Note: we specifically promote thumbnailUrls from the global record
                // if they exist, as these are the primary persistence targets.
                const currentOutput = node.data?.output;
                const currentMeta = node.data?.outputMetadata;

                // Detection: Check if new output data exists
                if (stableStringify(globalOutput) !== stableStringify(currentOutput)) {
                    changed = true;
                    return {
                        ...node,
                        data: {
                            ...node.data,
                            output: globalOutput,
                        }
                    };
                }
                return node;
            });

            return changed ? { ...prev, nodes: newNodes } : prev;
        }, { history: 'replace' });
    }, [nodeOutputs, setEditorState]);

    // Handle Node Changes
    const onNodesChange = useCallback((changes: NodeChange[]) => {
        setEditorState((prev) => {
            const nextNodes = applyNodeChanges(changes, prev.nodes);
            // 🛡️ SANITY CHECK: Ensure no node lost its position during change
            const validatedNodes = nextNodes.map(n => !n.position ? { ...n, position: { x: 0, y: 0 } } : n);
            return {
                ...prev,
                nodes: validatedNodes
            };
        }, { history: 'replace' });
    }, [setEditorState]);

    // Handle Edge Changes
    const onEdgesChange = useCallback((changes: EdgeChange[]) => {
        setEditorState((prev) => ({
            ...prev,
            edges: applyEdgeChanges(changes, prev.edges)
        }), { history: 'replace' });
    }, [setEditorState]);

    // Handle Drag Start (Snapshot)
    const onNodeDragStart: NodeDragHandler = useCallback(() => {
        // Push current state to history before modifications begin
        setEditorState((prev) => prev, { history: 'push' });
    }, [setEditorState]);
    // NOTE: Does 'push' current state work if object ref is same? 
    // Yes, useUndoRedo copies `present` to `past`.

    // Method to directly update node positions (used by auto-layout)
    const updatePositions = useCallback((positions: Map<string, { x: number; y: number }>) => {
        setEditorState((prev) => ({
            ...prev,
            nodes: prev.nodes.map((node) => {
                const newPosition = positions.get(node.id);
                return newPosition ? { ...node, position: newPosition } : node;
            })
        }), { history: 'push' });
    }, [setEditorState]);

    // Add a new node
    const addNode = useCallback((type: NodeType, position: { x: number; y: number }) => {
        touchInteraction();
        const newNode = createNodeFromType(type, position);
        setEditorState((prev) => {
            const maxZ = Math.max(0, ...prev.nodes.map(n => n.zIndex || 0));
            return {
                ...prev,
                nodes: [...prev.nodes, { ...newNode, zIndex: maxZ + 1 }]
            };
        }, { history: 'push' });
    }, [setEditorState]);

    // Delete a node
    const deleteNode = useCallback((nodeId: string) => {
        touchInteraction();
        // Trigger asset cleanup in global store (background)
        const store = useAppStore.getState();
        store.deleteNodeWithAssets(nodeId);

        setEditorState((prev) => ({
            ...prev,
            nodes: prev.nodes.filter((n) => n.id !== nodeId),
            edges: prev.edges.filter((e) => e.source !== nodeId && e.target !== nodeId)
        }), { history: 'push' });

        if (selectedNode === nodeId) {
            setSelectedNode(null);
        }
    }, [selectedNode, setEditorState]);

    // Bulk Delete
    const deleteNodes = useCallback((nodeIds: string[]) => {
        touchInteraction();
        // Trigger asset cleanup for each node in global store
        const store = useAppStore.getState();
        nodeIds.forEach(id => store.deleteNodeWithAssets(id));

        const ids = new Set(nodeIds);
        setEditorState((prev) => ({
            ...prev,
            nodes: prev.nodes.filter((n) => !ids.has(n.id)),
            edges: prev.edges.filter((e) => !ids.has(e.source) && !ids.has(e.target))
        }), { history: 'push' });

        if (selectedNode && ids.has(selectedNode)) {
            setSelectedNode(null);
        }
    }, [selectedNode, setEditorState]);

    // Duplicate Nodes
    const duplicateNodes = useCallback((newNodes: any[], newEdges: any[]) => {
        setEditorState((prev) => {
            const maxZ = Math.max(0, ...prev.nodes.map(n => n.zIndex || 0));
            const nodesWithZ = newNodes.map((n, i) => ({ ...n, zIndex: maxZ + 1 + i }));
            return {
                ...prev,
                nodes: [...prev.nodes, ...nodesWithZ],
                edges: [...prev.edges, ...newEdges]
            };
        }, { history: 'push' });
    }, [setEditorState]);

    // Update node configuration
    const updateNodeConfig = useCallback((nodeId: string, config: any) => {
        touchInteraction();
        setEditorState((prev) => ({
            ...prev,
            nodes: prev.nodes.map((n) =>
                n.id === nodeId
                    ? { ...n, data: { ...n.data, config } }
                    : n
            )
        }), { history: 'push' }); // Updates in property panel should likely be undoable steps
    }, [setEditorState]);

    // Handle connection creation
    const onConnect = useCallback((connection: Connection) => {
        const handleSuffix = connection.targetHandle ? `-${connection.targetHandle}` : '';
        const id = generateEdgeId(connection.source!, connection.target!) + handleSuffix;
        const newEdge: Edge = {
            id,
            source: connection.source!,
            target: connection.target!,
            sourceHandle: connection.sourceHandle || undefined,
            targetHandle: connection.targetHandle || undefined,
            type: 'smoothstep',
            animated: true,
        };

        setEditorState((prev) => ({
            ...prev,
            edges: addEdge(newEdge, prev.edges)
        }), { history: 'push' });
    }, [setEditorState]);

    // Get current workflow (snapshot)
    const getWorkflow = useCallback((): Workflow => {
        return {
            name: editorState.name,
            nodes: editorState.nodes.map(n => ({
                id: n.id,
                type: n.type as NodeType,
                position: n.position,
                data: n.data,
                zIndex: n.zIndex,
            })),
            edges: editorState.edges.map(e => ({
                id: e.id,
                source: e.source,
                target: e.target,
                sourceHandle: e.sourceHandle || null,
                targetHandle: e.targetHandle || null,
            })),
        };
    }, [editorState]);

    const setWorkflowName = useCallback((name: string) => {
        setEditorState(prev => ({ ...prev, name }), { history: 'replace' }); // Name change usually typing? replace. 
    }, [setEditorState]);

    const clearWorkflow = useCallback(() => {
        resetEditorState({ nodes: [], edges: [], name: 'Untitled Workflow' });
        setSelectedNode(null);
    }, [resetEditorState]);

    const bringNodeToFront = useCallback((nodeId: string) => {
        setEditorState((prev) => {
            const maxZ = Math.max(0, ...prev.nodes.map(n => n.zIndex || 0));
            const node = prev.nodes.find(n => n.id === nodeId);
            if (!node || node.zIndex === maxZ && maxZ > 0) return prev; // Already on top

            return {
                ...prev,
                nodes: prev.nodes.map(n => n.id === nodeId ? { ...n, zIndex: maxZ + 1 } : n)
            };
        }, { history: 'replace' });
    }, [setEditorState]);

    return {
        nodes: editorState.nodes,
        edges: editorState.edges,
        onNodesChange,
        onEdgesChange,
        onConnect,
        onNodeDragStart, // New prop
        selectedNode,
        setSelectedNode,
        workflowName: editorState.name,
        setWorkflowName,
        addNode,
        deleteNode,
        deleteNodes, // New prop
        duplicateNodes, // New prop
        updateNodeConfig,
        updatePositions,
        getWorkflow,
        clearWorkflow,
        // Undo/Redo exports
        undo,
        redo,
        canUndo,
        canRedo,
        bringNodeToFront
    };
}
