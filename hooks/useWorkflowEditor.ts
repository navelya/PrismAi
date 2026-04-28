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

import { sharedRegistry } from '@/lib/nodes/core/shared-registry';

import { useAppStore } from '@/lib/store/app-store';

// Types for the internal state of the hook
interface EditorState {
    nodes: any[];
    edges: any[];
    name: string;
}

/**
 * Sanitizes workflow data to handle legacy nodes and handles
 */
function sanitizeWorkflow(wf: Workflow | null | undefined): Workflow | null {
    if (!wf) return null;

    const sanitizedNodes = (wf.nodes || []).map(node => {
        let nodeType = node.type;
        const nodeData = { ...node.data };

        // 1. General Legacy Node Handling: Check if type exists in shared registry
        // If not in sharedRegistry, also allow types that are registered directly
        // in stableNodeTypes (e.g. 'ai_generator' which is dynamic and not in sharedRegistry)
        const DYNAMIC_NODE_TYPES = new Set(['ai_generator']);
        if (!(nodeType in sharedRegistry) && !DYNAMIC_NODE_TYPES.has(nodeType)) {
            nodeData.__originalType = nodeType;
            nodeType = 'legacy' as NodeType;
        }

        return {
            ...node,
            type: nodeType,
            data: nodeData,
            // Ensure position exists
            position: node.position || { x: 0, y: 0 },
        };
    });

    const sanitizedEdges = (wf.edges || []).map(edge => {
        let targetHandle = edge.targetHandle;

        // 2. Map legacy 'images_in' handle
        if (targetHandle === 'images_in') {
            const targetNode = sanitizedNodes.find(n => n.id === edge.target);
            if (targetNode) {
                const sharedDef = sharedRegistry[targetNode.type as keyof typeof sharedRegistry];
                // Map to first available input handle if images_in isn't found in current registry
                const standardInput = sharedDef?.handles?.inputs?.[0]?.id;
                targetHandle = standardInput || 'prompt_in';
            }
        }

        return {
            ...edge,
            targetHandle,
        };
    });

    return {
        ...wf,
        nodes: sanitizedNodes,
        edges: sanitizedEdges,
    };
}

function stripVolatileNodeData(data: any) {
    if (!data || typeof data !== 'object') return data;
    const {
        status,
        output,
        outputMetadata,
        isNew,
        ...stableData
    } = data;
    return stableData;
}

export function useWorkflowEditor(initialWorkflowRaw?: Workflow | null) {
    // Sanitize incoming workflow immediately
    const initialWorkflow = sanitizeWorkflow(initialWorkflowRaw);

    const nodeStatuses = useAppStore((state) => state.nodeStatuses);
    const nodeOutputs = useAppStore((state) => state.nodeOutputs);
    const touchInteraction = useAppStore((state) => state.touchInteraction);

    // Create a stable identity for the workflow to detect changes
    const getWorkflowIdentity = (wf: Workflow | null | undefined) => {
        if (!wf) return 'empty';
        // 👑 STRUCTURAL IDENTITY ONLY: 
        // We only reset history if we truly switched to a DIFFERENT session or workflow.
        // We do NOT include node data/positions in this identity, as those are synced 
        // granularly below to avoid history-reset feedback loops.
        const id = wf.id || 'no-id';
        const name = wf.name || 'Untitled';
        return `id:${id}-name:${name}`; 
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
            width: n.width,
            height: n.height,
            measured: n.measured,
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
    const lastSyncedSnapshotRef = useRef<string>('');

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

            // Process Nodes (Dedupe & Layout Check)
            const rawNodes = getInitialNodes(initialWorkflow);
            const rawEdges = getInitialEdges(initialWorkflow);

            const uniqueNodes: any[] = [];
            const seenIds = new Set();
            rawNodes.forEach(n => {
                if (!seenIds.has(n.id)) {
                    seenIds.add(n.id);
                    uniqueNodes.push(n);
                }
            });

            const needsLayout = uniqueNodes.length > 0 && uniqueNodes.every(n => {
                const pos = n.position || { x: 0, y: 0 };
                return (pos.x === 0 && pos.y === 0) || (pos.x === 0 && pos.y === 100);
            });

            if (needsLayout) {
                autoLayoutNodesAsync(uniqueNodes, rawEdges).then(layoutedPositions => {
                    const layoutedNodes = uniqueNodes.map(n => {
                        const pos = layoutedPositions.get(n.id);
                        return pos ? { ...n, position: pos } : n;
                    });
                    resetEditorState({ nodes: layoutedNodes, edges: rawEdges, name: initialWorkflow?.name || 'Untitled Workflow' });
                });
            } else {
                const newState: EditorState = {
                    nodes: uniqueNodes,
                    edges: rawEdges,
                    name: initialWorkflow?.name || 'Untitled Workflow',
                };
                resetEditorState(newState);
            }
            setSelectedNode(null);
        }
    }, [currentIdentity, initialWorkflow, resetEditorState]);

    const isDragging = useAppStore((state) => state.isDragging);

    // Sync external workflow changes (including add/remove nodes and edges) into editor state.
    useEffect(() => {
        if (!initialWorkflow) return;
        if (isDragging) return;

        const incomingNodes = getInitialNodes(initialWorkflow);
        const incomingEdges = getInitialEdges(initialWorkflow);
        const incomingName = initialWorkflow.name || 'Untitled Workflow';

        const incomingSnapshot = stableStringify({
            name: incomingName,
            nodes: incomingNodes.map((n) => ({
                id: n.id,
                type: n.type,
                position: n.position,
                data: stripVolatileNodeData(n.data),
                zIndex: n.zIndex || 0,
                width: n.width,
                height: n.height,
                measured: n.measured,
            })),
            edges: incomingEdges.map((e) => ({
                id: e.id,
                source: e.source,
                target: e.target,
                sourceHandle: e.sourceHandle || null,
                targetHandle: e.targetHandle || null,
            })),
        });

        if (incomingSnapshot === lastSyncedSnapshotRef.current) return;
        lastSyncedSnapshotRef.current = incomingSnapshot;

        setEditorState((prev) => {
            const currentSnapshot = stableStringify({
                name: prev.name,
                nodes: prev.nodes.map((n) => ({
                    id: n.id,
                    type: n.type,
                    position: n.position,
                    data: stripVolatileNodeData(n.data),
                    zIndex: n.zIndex || 0,
                    width: n.width,
                    height: n.height,
                    measured: n.measured,
                })),
                edges: prev.edges.map((e) => ({
                    id: e.id,
                    source: e.source,
                    target: e.target,
                    sourceHandle: e.sourceHandle || null,
                    targetHandle: e.targetHandle || null,
                })),
            });

            if (currentSnapshot === incomingSnapshot) return prev;

            return {
                ...prev,
                name: incomingName,
                nodes: incomingNodes,
                edges: incomingEdges,
            };
        }, { history: 'replace' });
    }, [initialWorkflow, setEditorState, isDragging]);

    useEffect(() => {
        // PERFORMANCE: Skip sync during active dragging to keep UI responsive
        if (isDragging) return;

        const outputIds = Object.keys(nodeOutputs);
        if (outputIds.length === 0) return;

        setEditorState((prev) => {
            let changed = false;
            const newNodes = prev.nodes.map((node) => {
                const globalOutput = nodeOutputs[node.id];
                if (globalOutput === undefined) return node;

                // Only update if the output has actually changed (to prevent loops)
                const currentOutput = node.data?.output;
                
                // Compare stringified versions for deep equality check
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
    }, [nodeOutputs, setEditorState, isDragging]);

    // Handle Node Changes
    const onNodesChange = useCallback((changes: NodeChange[]) => {
        setEditorState((prev) => {
            const nextNodes = applyNodeChanges(changes, prev.nodes);
            
            // 🛡️ THE ULTIMATE ROOT FIX: Deduplicate nodes immediately after any React Flow change
            // This guarantees duplicates can never enter the editor state in the first place.
            const uniqueNodesMap = new Map();
            nextNodes.forEach(n => {
                uniqueNodesMap.set(n.id, n);
            });
            const deduplicatedNodes = Array.from(uniqueNodesMap.values());

            // 🛡️ SANITY CHECK: Only validate if nodes were added or modified
            // For simple position changes, React Flow ensures positions are valid.
            const hasStructuralChanges = changes.some(c => c.type === 'add' || c.type === 'reset');
            if (!hasStructuralChanges) {
                return { ...prev, nodes: deduplicatedNodes };
            }

            const validatedNodes = deduplicatedNodes.map((n: any) => !n.position ? { ...n, position: { x: 0, y: 0 } } : n);
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
    const addNode = useCallback((type: NodeType, position: { x: number; y: number }, nodeTypeId?: string, modelId?: number) => {
        touchInteraction();
        const newNode = createNodeFromType(type, position, nodeTypeId, modelId);
        setEditorState((prev) => {
            // 🛡️ ROOT FIX: Prevent duplicate IDs
            if (prev.nodes.some(n => n.id === newNode.id)) return prev;

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
            // 🛡️ ROOT FIX: Prevent duplicate IDs
            const existingIds = new Set(prev.nodes.map(n => n.id));
            const uniqueNewNodes = newNodes.filter(n => !existingIds.has(n.id));

            if (uniqueNewNodes.length === 0 && newEdges.length === 0) return prev;

            const maxZ = Math.max(0, ...prev.nodes.map(n => n.zIndex || 0));
            const nodesWithZ = uniqueNewNodes.map((n, i) => ({ ...n, zIndex: maxZ + 1 + i }));
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
        // Deduplicate nodes by ID at the root level to prevent ANY duplicates 
        // from leaking into the UI state, payload, or auto-save.
        const uniqueNodesMap = new Map();
        editorState.nodes.forEach(n => {
            uniqueNodesMap.set(n.id, n);
        });
        const uniqueNodes = Array.from(uniqueNodesMap.values());

        return {
            name: editorState.name,
            nodes: uniqueNodes.map(n => ({
                id: n.id,
                type: n.type as NodeType,
                position: n.position,
                data: n.data,
                zIndex: n.zIndex,
                width: n.width,
                height: n.height,
                measured: n.measured,
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
