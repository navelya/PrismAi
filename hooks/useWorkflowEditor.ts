'use client';

import { useCallback, useMemo } from 'react';
import { Connection, NodeChange, EdgeChange } from 'reactflow';
import { NodeType, Workflow } from '@/lib/nodes/types';
import { createNodeFromType } from '@/lib/editor/node-factory';
import { useAppStore } from '@/lib/store/app-store';

/**
 * useWorkflowEditor Hook (SSOT Version)
 * 
 * Provides an interface for the React Flow canvas to interact with the 
 * global Zustand store. All state is maintained in useAppStore.
 */
export function useWorkflowEditor(initialWorkflowRaw?: Workflow | null) {
    const currentWorkflow = useAppStore((state) => state.currentWorkflow);
    const updateNodeConfig = useAppStore((state) => state.updateNodeConfig);
    const updateNodePositions = useAppStore((state) => state.updateNodePositions);
    const takeSnapshot = useAppStore((state) => state.takeSnapshot);
    const touchInteraction = useAppStore((state) => state.touchInteraction);
    const onNodesChange = useAppStore((state) => state.onNodesChange);
    const onEdgesChange = useAppStore((state) => state.onEdgesChange);
    const onConnect = useAppStore((state) => state.onConnect);
    const undo = useAppStore((state) => state.undo);
    const redo = useAppStore((state) => state.redo);
    const canUndo = useAppStore((state) => state.canUndo());
    const canRedo = useAppStore((state) => state.canRedo());
    const selectedNodeId = useAppStore((state) => state.selectedNodeId);
    const setSelectedNodeId = useAppStore((state) => state.setSelectedNodeId);

    // Computed nodes and edges for React Flow
    const nodes = useMemo(() => currentWorkflow?.nodes || [], [currentWorkflow]);
    const edges = useMemo(() => currentWorkflow?.edges || [], [currentWorkflow]);
    const workflowName = currentWorkflow?.name || 'Untitled Workflow';

    // Handle Drag Start (Snapshot for Undo)
    const onNodeDragStart = useCallback(() => {
        takeSnapshot();
    }, [takeSnapshot]);

    // Add a new node
    const addNode = useCallback((type: NodeType, position: { x: number; y: number }, nodeTypeId?: string, modelId?: number, initialConfig?: Record<string, any>) => {
        touchInteraction();
        takeSnapshot();
        
        const newNode = createNodeFromType(type, position, nodeTypeId, modelId, initialConfig);
        
        // Use onNodesChange to add the node to the store
        onNodesChange([{ type: 'add', item: newNode }]);
    }, [touchInteraction, takeSnapshot, onNodesChange]);

    // Delete nodes
    const deleteNodes = useCallback((nodeIds: string[]) => {
        touchInteraction();
        takeSnapshot();
        
        const store = useAppStore.getState();
        nodeIds.forEach(id => store.deleteNodeWithAssets(id));

        onNodesChange(nodeIds.map(id => ({ type: 'remove', id })));
        
        if (selectedNodeId && nodeIds.includes(selectedNodeId)) {
            setSelectedNodeId(null);
        }
    }, [touchInteraction, takeSnapshot, onNodesChange, selectedNodeId, setSelectedNodeId]);

    const deleteNode = useCallback((nodeId: string) => {
        deleteNodes([nodeId]);
    }, [deleteNodes]);

    // Duplicate Nodes
    const duplicateNodes = useCallback((newNodes: any[], newEdges: any[]) => {
        takeSnapshot();
        
        if (newNodes.length > 0) {
            onNodesChange(newNodes.map(n => ({ type: 'add', item: n })));
        }
        
        if (newEdges.length > 0) {
            onEdgesChange(newEdges.map(e => ({ type: 'add', item: e })));
        }
    }, [takeSnapshot, onNodesChange, onEdgesChange]);

    // Get current workflow (snapshot)
    const getWorkflow = useCallback((): Workflow => {
        return currentWorkflow || { name: 'Untitled', nodes: [], edges: [] };
    }, [currentWorkflow]);

    const clearWorkflow = useCallback(() => {
        takeSnapshot();
        useAppStore.getState().setCurrentWorkflow({ name: 'Untitled Workflow', nodes: [], edges: [] });
        setSelectedNodeId(null);
    }, [takeSnapshot, setSelectedNodeId]);

    const bringNodeToFront = useCallback((nodeId: string) => {
        useAppStore.getState().bringNodeToFront(nodeId);
    }, []);

    const setWorkflowName = useCallback((name: string) => {
        const store = useAppStore.getState();
        if (store.currentWorkflow) {
            store.setCurrentWorkflow({ ...store.currentWorkflow, name });
        }
    }, []);

    return {
        nodes,
        edges,
        onNodesChange,
        onEdgesChange,
        onConnect,
        onNodeDragStart,
        selectedNode: selectedNodeId,
        setSelectedNode: setSelectedNodeId,
        workflowName,
        setWorkflowName,
        addNode,
        deleteNode,
        deleteNodes,
        duplicateNodes,
        updateNodeConfig,
        updatePositions: updateNodePositions,
        getWorkflow,
        clearWorkflow,
        undo,
        redo,
        canUndo,
        canRedo,
        bringNodeToFront
    };
}
