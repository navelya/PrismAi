import { StateCreator } from 'zustand';
import { sharedRegistry } from '../../nodes/core/shared-registry';
import { Workflow, WorkflowNode } from '../../nodes/types';
import { RootState, WorkflowSlice } from '../types';

export const createWorkflowSlice: StateCreator<RootState, [], [], WorkflowSlice> = (set, get) => ({
    activeSessionId: null,
    currentWorkflow: null,
    isDragging: false,
    copiedNode: null,
    isWorkflowDirty: false,

    setActiveSessionId: (sessionId) => {
        set({ activeSessionId: sessionId, isWorkflowDirty: false });
    },

    setWorkflowDirty: (isDirty) => {
        set({ isWorkflowDirty: isDirty });
    },

    setCurrentWorkflow: (workflow) => {
        if (workflow && workflow.nodes) {
            workflow.nodes = workflow.nodes.map((node) => {
                const def = sharedRegistry[node.type];
                if (def && def.defaultConfig) {
                    node.data = {
                        ...node.data,
                        config: { ...def.defaultConfig, ...(node.data?.config || {}) }
                    };
                }
                if (!node.position) {
                    node.position = { x: 0, y: 0 };
                }
                return node;
            });
        }
        set({ currentWorkflow: workflow, isWorkflowDirty: true });
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
});
