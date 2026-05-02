import { StateCreator } from 'zustand';
import { applyNodeChanges, applyEdgeChanges, addEdge, Connection } from 'reactflow';
import { sharedRegistry } from '../../nodes/core/shared-registry';
import { Workflow, WorkflowNode } from '../../nodes/types';
import { RootState, WorkflowSlice } from '../types';
import { generateEdgeId } from '@/lib/utils';

const HISTORY_LIMIT = 50;

export const createWorkflowSlice: StateCreator<RootState, [], [], WorkflowSlice> = (set, get) => ({
    activeSessionId: null,
    currentWorkflow: null,
    isDragging: false,
    copiedNode: null,
    isWorkflowDirty: false,

    // Selection
    selectedNodeId: null,
    setSelectedNodeId: (nodeId) => set({ selectedNodeId: nodeId }),

    // History
    past: [],
    future: [],

    setActiveSessionId: (sessionId) => {
        set({ 
            activeSessionId: sessionId, 
            isWorkflowDirty: false,
            past: [],
            future: []
        });
    },

    setWorkflowDirty: (isDirty) => {
        set({ isWorkflowDirty: isDirty });
    },

    takeSnapshot: () => {
        const { currentWorkflow, past } = get();
        if (!currentWorkflow) return;
        
        // Push deep copy of current state to past
        const snapshot = JSON.parse(JSON.stringify(currentWorkflow));
        const newPast = [...past, snapshot].slice(-HISTORY_LIMIT);
        
        set({ past: newPast, future: [] });
    },

    undo: () => {
        const { past, currentWorkflow, future } = get();
        if (past.length === 0 || !currentWorkflow) return;

        const previous = past[past.length - 1];
        const newPast = past.slice(0, past.length - 1);
        const newFuture = [JSON.parse(JSON.stringify(currentWorkflow)), ...future].slice(0, HISTORY_LIMIT);

        set({
            currentWorkflow: previous,
            past: newPast,
            future: newFuture,
            isWorkflowDirty: true
        });
    },

    redo: () => {
        const { future, currentWorkflow, past } = get();
        if (future.length === 0 || !currentWorkflow) return;

        const next = future[0];
        const newFuture = future.slice(1);
        const newPast = [...past, JSON.parse(JSON.stringify(currentWorkflow))].slice(-HISTORY_LIMIT);

        set({
            currentWorkflow: next,
            past: newPast,
            future: newFuture,
            isWorkflowDirty: true
        });
    },

    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,

    onNodesChange: (changes) => {
        const { currentWorkflow } = get();
        if (!currentWorkflow) return;

        // structural changes (add, remove, reset) should trigger a snapshot
        const isStructural = changes.some(c => c.type === 'remove' || c.type === 'add' || c.type === 'reset');
        if (isStructural) get().takeSnapshot();

        const updatedNodes = applyNodeChanges(changes, currentWorkflow.nodes);
        
        set({
            currentWorkflow: {
                ...currentWorkflow,
                nodes: updatedNodes as WorkflowNode[]
            },
            isWorkflowDirty: true
        });
    },

    onEdgesChange: (changes) => {
        const { currentWorkflow } = get();
        if (!currentWorkflow) return;

        const isStructural = changes.some(c => c.type === 'remove' || c.type === 'add' || c.type === 'reset');
        if (isStructural) get().takeSnapshot();

        const updatedEdges = applyEdgeChanges(changes, currentWorkflow.edges || []);
        
        set({
            currentWorkflow: {
                ...currentWorkflow,
                edges: updatedEdges as any[]
            },
            isWorkflowDirty: true
        });
    },

    onConnect: (connection) => {
        const { currentWorkflow } = get();
        if (!currentWorkflow) return;

        get().takeSnapshot();

        const handleSuffix = connection.targetHandle ? `-${connection.targetHandle}` : '';
        const id = generateEdgeId(connection.source!, connection.target!) + handleSuffix;
        
        const newEdge = {
            id,
            source: connection.source!,
            target: connection.target!,
            sourceHandle: connection.sourceHandle || undefined,
            targetHandle: connection.targetHandle || undefined,
            type: 'smoothstep',
            animated: true,
        };

        const updatedEdges = addEdge(newEdge, currentWorkflow.edges || []);
        
        set({
            currentWorkflow: {
                ...currentWorkflow,
                edges: updatedEdges as any[]
            },
            isWorkflowDirty: true
        });
    },

    setCurrentWorkflow: (workflow, isDirty = true) => {
        if (!workflow) {
            set({ currentWorkflow: null, isWorkflowDirty: isDirty, past: [], future: [] });
            return;
        }

        const nodes = workflow.nodes || [];
        let hasChanges = false;
        
        const transformedNodes = nodes.map((node) => {
            let nodeChanged = false;
            const def = sharedRegistry[node.type];
            let newConfig = node.data?.config || {};
            
            if (def && def.defaultConfig) {
                const hasMissingDefaults = Object.keys(def.defaultConfig).some(
                    (key) => !(key in newConfig)
                );
                if (hasMissingDefaults) {
                    newConfig = { ...def.defaultConfig, ...newConfig };
                    nodeChanged = true;
                }
            }
            
            let newPosition = node.position;
            if (!newPosition) {
                newPosition = { x: 0, y: 0 };
                nodeChanged = true;
            }

            if (nodeChanged) {
                hasChanges = true;
                return {
                    ...node,
                    position: newPosition,
                    data: { ...node.data, config: newConfig }
                };
            }
            return node;
        });

        const finalWorkflow = hasChanges ? { ...workflow, nodes: transformedNodes } : workflow;

        set({ 
            currentWorkflow: finalWorkflow, 
            isWorkflowDirty: isDirty 
        });
    },

    setIsDragging: (isDragging) => set({ isDragging }),

    copyNode: (nodeId) => {
        const { currentWorkflow } = get();
        if (!currentWorkflow) return;

        const nodeToCopy = currentWorkflow.nodes.find((node) => node.id === nodeId);
        if (nodeToCopy) {
            set({ copiedNode: JSON.parse(JSON.stringify(nodeToCopy)) });
        }
    },

    pasteNode: (position) => {
        const { currentWorkflow, copiedNode } = get();
        if (!currentWorkflow || !copiedNode) return;

        get().takeSnapshot();

        const newNode: WorkflowNode = {
            ...JSON.parse(JSON.stringify(copiedNode)),
            id: `node_${Date.now()}`,
            position: position || {
                x: copiedNode.position.x + 50,
                y: copiedNode.position.y + 50,
            },
        };

        const updatedWorkflow: Workflow = {
            ...currentWorkflow,
            nodes: [...currentWorkflow.nodes, newNode],
        };

        set({ currentWorkflow: updatedWorkflow, isWorkflowDirty: true });
    },

    updateNodePosition: (nodeId, position) => {
        const { currentWorkflow } = get();
        if (!currentWorkflow) return;

        const updatedWorkflow: Workflow = {
            ...currentWorkflow,
            nodes: currentWorkflow.nodes.map((node) =>
                node.id === nodeId ? { ...node, position } : node
            ),
        };

        set({ currentWorkflow: updatedWorkflow, isWorkflowDirty: true });
    },

    updateNodePositions: (positions) => {
        const { currentWorkflow } = get();
        if (!currentWorkflow) return;

        const updatedWorkflow: Workflow = {
            ...currentWorkflow,
            nodes: currentWorkflow.nodes.map((node) => {
                const newPosition = positions.get(node.id);
                return newPosition ? { ...node, position: newPosition } : node;
            }),
        };

        set({ currentWorkflow: updatedWorkflow, isWorkflowDirty: true });
    },

    updateNodeConfig: (nodeId, config) => {
        const { currentWorkflow } = get();
        if (!currentWorkflow) return;

        const updatedWorkflow: Workflow = {
            ...currentWorkflow,
            nodes: currentWorkflow.nodes.map((node) =>
                node.id === nodeId
                    ? { ...node, data: { ...node.data, config } }
                    : node
            ),
        };

        set({ currentWorkflow: updatedWorkflow, isWorkflowDirty: true });
    },

    updateNodeLabel: (nodeId, label) => {
        const { currentWorkflow } = get();
        if (!currentWorkflow) return;

        get().takeSnapshot();

        const updatedWorkflow: Workflow = {
            ...currentWorkflow,
            nodes: currentWorkflow.nodes.map((node) =>
                node.id === nodeId
                    ? { ...node, data: { ...node.data, label } }
                    : node
            ),
        };

        set({ currentWorkflow: updatedWorkflow, isWorkflowDirty: true });
    },

    bringNodeToFront: (nodeId) => {
        const { currentWorkflow } = get();
        if (!currentWorkflow) return;

        const nodes = currentWorkflow.nodes;
        const maxZ = Math.max(0, ...nodes.map(n => n.zIndex || 0));
        const node = nodes.find(n => n.id === nodeId);
        
        if (!node || (node.zIndex === maxZ && maxZ > 0)) return;

        set({
            currentWorkflow: {
                ...currentWorkflow,
                nodes: nodes.map(n => n.id === nodeId ? { ...n, zIndex: maxZ + 1 } : n)
            }
        });
    },
});
