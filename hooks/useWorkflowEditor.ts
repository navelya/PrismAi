'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useNodesState, useEdgesState, addEdge, Connection, Edge } from 'reactflow';
import type { Node } from 'reactflow';
import { WorkflowNode, WorkflowEdge, Workflow, NodeType } from '@/lib/nodes/types';
import { createNodeFromType } from '@/lib/editor/node-factory';
import { generateEdgeId } from '@/lib/utils';

export function useWorkflowEditor(initialWorkflow?: Workflow | null) {
    const [nodes, setNodes, onNodesChange] = useNodesState<any>(
        initialWorkflow?.nodes.map(n => ({
            id: n.id,
            type: n.type,
            position: n.position,
            data: n.data,
        })) || []
    );

    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
        initialWorkflow?.edges.map(e => ({
            id: e.id,
            source: e.source,
            target: e.target,
            type: 'smoothstep',
            animated: true,
        })) || []
    );

    const [selectedNode, setSelectedNode] = useState<string | null>(null);
    const [workflowName, setWorkflowName] = useState(initialWorkflow?.name || 'Untitled Workflow');

    // Track the last workflow we loaded to avoid re-rendering during drag
    const lastLoadedWorkflowRef = useRef<string | null>(null);

    // ⭐ CRITICAL FIX: Update nodes/edges when workflow prop changes
    // Only update when workflow ID/structure changes, not during drag operations
    useEffect(() => {
        if (initialWorkflow) {
            // Create a stable ID based on workflow structure and CONFIGURATION
            // Must include node data to detect property changes (e.g. sort order)
            const configHash = JSON.stringify(initialWorkflow.nodes.map(n => ({ id: n.id, data: n.data })));
            const workflowId = `${initialWorkflow.name}-${initialWorkflow.nodes.length}-${initialWorkflow.edges.length}-${configHash}`;

            // Only update if this is a different workflow (not just position changes)
            if (lastLoadedWorkflowRef.current !== workflowId) {
                console.log('📊 New workflow loaded in editor:', initialWorkflow.name);
                console.log('  - Nodes:', initialWorkflow.nodes.length);
                console.log('  - Edges:', initialWorkflow.edges.length);

                lastLoadedWorkflowRef.current = workflowId;

                // Update nodes
                const newNodes = initialWorkflow.nodes.map(n => ({
                    id: n.id,
                    type: n.type,
                    position: n.position,
                    data: n.data,
                }));
                setNodes(newNodes);

                // Update edges
                const newEdges = initialWorkflow.edges.map(e => ({
                    id: e.id,
                    source: e.source,
                    target: e.target,
                    type: 'smoothstep',
                    animated: true,
                }));
                setEdges(newEdges);

                // Update workflow name
                setWorkflowName(initialWorkflow.name);
            }
        }
    }, [initialWorkflow]); // Still depend on workflow, but check if it's actually new

    // Method to directly update node positions (used by auto-layout)
    const updatePositions = useCallback((positions: Map<string, { x: number; y: number }>) => {
        console.log('📍 Directly updating node positions');
        setNodes((currentNodes) =>
            currentNodes.map((node) => {
                const newPosition = positions.get(node.id);
                if (newPosition) {
                    console.log(`  - Moving ${node.id} to (${newPosition.x}, ${newPosition.y})`);
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
        const id = generateEdgeId(connection.source!, connection.target!);
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
