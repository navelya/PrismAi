'use client';

import { useState, useCallback, useEffect, useRef, useLayoutEffect } from 'react';
import { useNodesState, useEdgesState, addEdge, Connection, Edge } from 'reactflow';
import type { Node } from 'reactflow';
import { WorkflowNode, WorkflowEdge, Workflow, NodeType } from '@/lib/nodes/types';
import { createNodeFromType } from '@/lib/editor/node-factory';
import { generateEdgeId } from '@/lib/utils';
import { autoLayoutNodesAsync } from '@/lib/utils/graph-layout';
import { stableStringify } from '@/lib/utils/stable-stringify';

export function useWorkflowEditor(initialWorkflow?: Workflow | null) {
    // Create a stable identity for the workflow to detect changes
    const getWorkflowIdentity = (wf: Workflow | null | undefined) => {
        if (!wf || !wf.nodes) return 'empty';
        return `${wf.name}-${wf.nodes.length}-${wf.edges.length}`;
    };

    const currentIdentity = getWorkflowIdentity(initialWorkflow);
    const prevIdentityRef = useRef<string | null>(null);

    // Debug logging


    // Compute initial values
    const getInitialNodes = (wf: Workflow | null | undefined) => {
        if (!wf?.nodes) return [];
        return wf.nodes.map(n => ({
            id: n.id,
            type: n.type,
            position: n.position,
            data: n.data,
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
        }));
    };

    const [nodes, setNodes, onNodesChange] = useNodesState<any>(getInitialNodes(initialWorkflow));
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(getInitialEdges(initialWorkflow));
    const [selectedNode, setSelectedNode] = useState<string | null>(null);
    const [workflowName, setWorkflowName] = useState(initialWorkflow?.name || 'Untitled Workflow');

    // Track the last workflow we loaded to avoid re-rendering during drag
    const lastLoadedWorkflowRef = useRef<string | null>(null);

    // ⭐ CRITICAL FIX: Use useLayoutEffect for SYNCHRONOUS state reset before paint
    // This ensures state is updated BEFORE React renders, avoiding stale UI
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

            // SYNCHRONOUSLY reset all state to match the new workflow
            const newNodes = getInitialNodes(initialWorkflow);
            const newEdges = getInitialEdges(initialWorkflow);
            const newName = initialWorkflow?.name || 'Untitled Workflow';

            setNodes(newNodes);
            setEdges(newEdges);
            setSelectedNode(null);
            setWorkflowName(newName);
        }
    }, [currentIdentity, initialWorkflow, setNodes, setEdges]);

    // ⭐ Main effect to update state when workflow changes
    useEffect(() => {
        if (initialWorkflow && initialWorkflow.nodes && initialWorkflow.nodes.length > 0) {
            // Create a stable ID based on workflow structure and CONFIGURATION
            const sortedNodes = [...initialWorkflow.nodes].sort((a, b) => a.id.localeCompare(b.id));
            const configHash = stableStringify(sortedNodes.map(n => ({ id: n.id, data: n.data })));
            const workflowId = `${initialWorkflow.name}-${initialWorkflow.nodes.length}-${initialWorkflow.edges.length}-${configHash}`;

            // Only update if this is a different workflow (not just position changes)
            if (lastLoadedWorkflowRef.current !== workflowId) {
                lastLoadedWorkflowRef.current = workflowId;

                // Deduplicate nodes
                const uniqueNodes = new Map();
                initialWorkflow.nodes.forEach(n => {
                    if (!uniqueNodes.has(n.id)) {
                        uniqueNodes.set(n.id, {
                            id: n.id,
                            type: n.type,
                            position: n.position,
                            data: n.data,
                        });
                    }
                });
                const newNodes = Array.from(uniqueNodes.values());

                // Deduplicate edges
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

                // Check if layout is needed
                const needsLayout = newNodes.length > 0 && newNodes.every(n => n.position.x === 0 && n.position.y === 0 || (n.position.x === 0 && n.position.y === 100));

                if (needsLayout) {
                    autoLayoutNodesAsync(newNodes, newEdges, 'elk').then(layoutedPositions => {
                        const layoutedNodes = newNodes.map(n => {
                            const pos = layoutedPositions.get(n.id);
                            return pos ? { ...n, position: pos } : n;
                        });
                        setNodes(layoutedNodes);
                        setEdges(newEdges);
                    });
                } else {
                    setNodes(newNodes);
                    setEdges(newEdges);
                }

                // Update workflow name
                setWorkflowName(initialWorkflow.name);
            }
        } else {
            // ⭐ Clear the canvas when workflow becomes null/empty
            lastLoadedWorkflowRef.current = null;
            setNodes([]);
            setEdges([]);
            setSelectedNode(null);
            setWorkflowName('Untitled Workflow');
        }
    }, [initialWorkflow, setNodes, setEdges]); // Include setters in deps

    // Method to directly update node positions (used by auto-layout)
    const updatePositions = useCallback((positions: Map<string, { x: number; y: number }>) => {
        setNodes((currentNodes) =>
            currentNodes.map((node) => {
                const newPosition = positions.get(node.id);
                if (newPosition) {
                    return { ...node, position: newPosition };
                }
                return node;
            })
        );
    }, [setNodes]);

    // Add a new node to the canvas
    const addNode = useCallback((type: NodeType, position: { x: number; y: number }) => {
        const newNode = createNodeFromType(type, position);
        setNodes((nds) => [...nds, newNode as any]);
    }, [setNodes]);

    // Delete a node
    const deleteNode = useCallback((nodeId: string) => {
        setNodes((nds) => nds.filter((n) => n.id !== nodeId));
        setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
        if (selectedNode === nodeId) {
            setSelectedNode(null);
        }
    }, [setNodes, setEdges, selectedNode]);

    // Update node configuration
    const updateNodeConfig = useCallback((nodeId: string, config: any) => {
        setNodes((nds) =>
            nds.map((n) =>
                n.id === nodeId
                    ? { ...n, data: { ...n.data, config } }
                    : n
            )
        );
    }, [setNodes]);

    // Handle connection creation
    const onConnect = useCallback((connection: Connection) => {
        // Include targetHandle in edge ID to allow multiple connections to different handles on same node
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
        setEdges((eds) => addEdge(newEdge, eds));
    }, [setEdges]);

    // Get current workflow
    const getWorkflow = useCallback((): Workflow => {
        return {
            name: workflowName,
            nodes: nodes.map(n => ({
                id: n.id,
                type: n.type as NodeType,
                position: n.position,
                data: n.data,
            })),
            edges: edges.map(e => ({
                id: e.id,
                source: e.source,
                target: e.target,
                sourceHandle: e.sourceHandle || null,
                targetHandle: e.targetHandle || null,
            })),
        };
    }, [nodes, edges, workflowName]);

    // Clear canvas
    const clearWorkflow = useCallback(() => {
        setNodes([]);
        setEdges([]);
        setSelectedNode(null);
        setWorkflowName('Untitled Workflow');
    }, [setNodes, setEdges]);

    return {
        nodes,
        edges,
        onNodesChange,
        onEdgesChange,
        onConnect,
        selectedNode,
        setSelectedNode,
        workflowName,
        setWorkflowName,
        addNode,
        deleteNode,
        updateNodeConfig,
        updatePositions,
        getWorkflow,
        clearWorkflow,
    };
}
