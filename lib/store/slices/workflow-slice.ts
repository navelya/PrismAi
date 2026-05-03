import { StateCreator } from 'zustand';
import { applyNodeChanges, applyEdgeChanges, addEdge, Connection } from 'reactflow';
import { sharedRegistry } from '../../nodes/core/shared-registry';
import { Workflow, WorkflowNode } from '../../nodes/types';
import { RootState, WorkflowSlice } from '../types';
import { generateEdgeId } from '@/lib/utils';
import { deriveEnvelopeFromConfig } from '@/lib/hooks/use-resolved-node-value';
import { CompositorConfig, CompositorLayer, calculateInitialTransform } from '../../nodes/types';

/**
 * Build a default CompositorLayer for an edge that just landed on a compositor.
 * Centered with placeholder dimensions; the real auto-center on image-load
 * happens in the editor via onLayerImageLoad.
 */
function buildAutoLayerForEdge(
    edgeId: string,
    sourceLabel: string,
    canvasWidth: number,
    canvasHeight: number
): CompositorLayer {
    const transform = calculateInitialTransform(400, 300, canvasWidth, canvasHeight);
    return {
        id: `layer_${edgeId}`,
        name: sourceLabel || 'Layer',
        sourceHandleId: edgeId,
        selectedIndex: 0,
        transform: { ...transform, isAutoCentered: false },
        visible: true,
        locked: false,
    };
}

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
        const { currentWorkflow, nodeOutputs } = get();
        if (!currentWorkflow) return;

        // structural changes (add, remove, reset) should trigger a snapshot
        const isStructural = changes.some(c => c.type === 'remove' || c.type === 'add' || c.type === 'reset');
        if (isStructural) get().takeSnapshot();

        const updatedNodes = applyNodeChanges(changes, currentWorkflow.nodes) as WorkflowNode[];

        // Seed source-node values for newly added nodes in the same set() call.
        const addedIds = changes
            .filter((c: any) => c.type === 'add' && c.item?.id)
            .map((c: any) => c.item.id as string);
        let nextOutputs = nodeOutputs;
        if (addedIds.length > 0) {
            const merged: Record<string, any> = { ...nodeOutputs };
            let dirty = false;
            addedIds.forEach((id) => {
                const node = updatedNodes.find((n) => n.id === id);
                const env = node ? deriveEnvelopeFromConfig(node.type, node.data?.config) : null;
                if (env) {
                    merged[id] = env;
                    dirty = true;
                }
            });
            if (dirty) nextOutputs = merged;
        }

        set({
            currentWorkflow: {
                ...currentWorkflow,
                nodes: updatedNodes,
            },
            nodeOutputs: nextOutputs,
            isWorkflowDirty: true,
        });
    },

    onEdgesChange: (changes) => {
        const { currentWorkflow } = get();
        if (!currentWorkflow) return;

        const isStructural = changes.some(c => c.type === 'remove' || c.type === 'add' || c.type === 'reset');
        if (isStructural) get().takeSnapshot();

        // Capture removed edges BEFORE applyEdgeChanges drops them so we can
        // strip the matching layers from any compositor target.
        const removedEdgeIds = new Set<string>(
            changes
                .filter((c: any) => c.type === 'remove' && typeof c.id === 'string')
                .map((c: any) => c.id as string)
        );
        const removedEdges = removedEdgeIds.size > 0
            ? (currentWorkflow.edges || []).filter((e) => removedEdgeIds.has(e.id))
            : [];

        const updatedEdges = applyEdgeChanges(changes, currentWorkflow.edges || []);

        let updatedNodes = currentWorkflow.nodes;
        if (removedEdges.length > 0) {
            const compositorEdgesByTarget = new Map<string, string[]>();
            removedEdges.forEach((edge) => {
                const targetNode = currentWorkflow.nodes.find((n) => n.id === edge.target);
                if (targetNode?.type !== 'compositor') return;
                if (!compositorEdgesByTarget.has(edge.target)) {
                    compositorEdgesByTarget.set(edge.target, []);
                }
                compositorEdgesByTarget.get(edge.target)!.push(edge.id);
            });

            if (compositorEdgesByTarget.size > 0) {
                updatedNodes = currentWorkflow.nodes.map((node) => {
                    const lostEdgeIds = compositorEdgesByTarget.get(node.id);
                    if (!lostEdgeIds || node.type !== 'compositor') return node;

                    const cfg: CompositorConfig = (node.data?.config as CompositorConfig) || ({} as CompositorConfig);
                    const layers = (cfg.layers || []).filter(
                        (l) => !lostEdgeIds.includes(l.sourceHandleId)
                    );
                    return {
                        ...node,
                        data: {
                            ...node.data,
                            config: { ...cfg, layers },
                        },
                    };
                });
            }
        }

        set({
            currentWorkflow: {
                ...currentWorkflow,
                nodes: updatedNodes,
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

        // If this edge lands on a compositor, materialize a CompositorLayer in
        // its config.layers right now. Keeps the layer's identity (transforms,
        // visibility, etc.) durable from the moment of connection rather than
        // appearing only after the user opens the editor and saves.
        const targetNode = currentWorkflow.nodes.find((n) => n.id === connection.target);
        let updatedNodes = currentWorkflow.nodes;
        if (targetNode?.type === 'compositor') {
            const cfg: CompositorConfig = (targetNode.data?.config as CompositorConfig) || ({} as CompositorConfig);
            const existing = cfg.layers || [];
            const alreadyHas = existing.some((l) => l.sourceHandleId === id);
            if (!alreadyHas) {
                const sourceNode = currentWorkflow.nodes.find((n) => n.id === connection.source);
                const newLayer = buildAutoLayerForEdge(
                    id,
                    sourceNode?.data?.label || 'Layer',
                    cfg.canvasWidth || 1920,
                    cfg.canvasHeight || 1080
                );
                updatedNodes = currentWorkflow.nodes.map((n) =>
                    n.id === targetNode.id
                        ? {
                              ...n,
                              data: {
                                  ...n.data,
                                  config: { ...cfg, layers: [...existing, newLayer] },
                              },
                          }
                        : n
                );
            }
        }

        set({
            currentWorkflow: {
                ...currentWorkflow,
                nodes: updatedNodes,
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

        // Backfill compositor layers for legacy workflows: each compositor's
        // config.layers should have one entry per incoming edge (onConnect now
        // handles this for new connections, but workflows saved before that
        // change won't have entries for their existing edges).
        const allEdges = workflow.edges || [];
        const backfilledNodes = transformedNodes.map((node) => {
            if (node.type !== 'compositor') return node;
            const cfg = (node.data?.config as CompositorConfig) || ({} as CompositorConfig);
            const incoming = allEdges.filter(
                (e) => e.target === node.id && (e.targetHandle === 'layers' || !e.targetHandle)
            );
            const existingLayers = cfg.layers || [];
            const existingIds = new Set(existingLayers.map((l) => l.sourceHandleId));
            const missing = incoming.filter((e) => !existingIds.has(e.id));
            // Drop layers whose edge no longer exists.
            const incomingIds = new Set(incoming.map((e) => e.id));
            const trimmed = existingLayers.filter((l) => incomingIds.has(l.sourceHandleId));
            if (missing.length === 0 && trimmed.length === existingLayers.length) return node;

            const filledLayers = [
                ...trimmed,
                ...missing.map((e) => {
                    const sourceNode = transformedNodes.find((n) => n.id === e.source);
                    return buildAutoLayerForEdge(
                        e.id,
                        sourceNode?.data?.label || 'Layer',
                        cfg.canvasWidth || 1920,
                        cfg.canvasHeight || 1080
                    );
                }),
            ];
            hasChanges = true;
            return {
                ...node,
                data: {
                    ...node.data,
                    config: { ...cfg, layers: filledLayers },
                },
            };
        });

        const finalWorkflow = hasChanges ? { ...workflow, nodes: backfilledNodes } : workflow;

        // Seed source-node values into the resolved-value store on hydrate so
        // freshly-loaded Prompt / MediaInput nodes are immediately renderable
        // by downstream previews without waiting for an execution. Build the
        // outputs map once and merge into a single set() to avoid N render
        // passes on workflow load.
        const seededOutputs: Record<string, any> = { ...get().nodeOutputs };
        let seededAny = false;
        finalWorkflow.nodes.forEach((node) => {
            const env = deriveEnvelopeFromConfig(node.type, node.data?.config);
            if (env) {
                seededOutputs[node.id] = env;
                seededAny = true;
            }
        });

        set({
            currentWorkflow: finalWorkflow,
            nodeOutputs: seededAny ? seededOutputs : get().nodeOutputs,
            isWorkflowDirty: isDirty,
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

        const env = deriveEnvelopeFromConfig(newNode.type, newNode.data?.config);
        const { nodeOutputs } = get();
        const nextOutputs = env ? { ...nodeOutputs, [newNode.id]: env } : nodeOutputs;

        set({
            currentWorkflow: updatedWorkflow,
            nodeOutputs: nextOutputs,
            isWorkflowDirty: true,
        });
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
        const { currentWorkflow, nodeOutputs } = get();
        if (!currentWorkflow) return;

        const updatedNodes = currentWorkflow.nodes.map((node) =>
            node.id === nodeId
                ? { ...node, data: { ...node.data, config } }
                : node
        );

        // For source nodes (Prompt, MediaInput), push the derived envelope into
        // the resolved-value store in the SAME set() so we get one render pass
        // instead of three. Downstream invalidation is deliberately skipped:
        // - Live previews don't need it (they read upstream values via the
        //   nodeOutputs map, which the source-node push has already updated).
        // - Phase 3's client compute hooks will be reactive (they subscribe to
        //   their upstream's resolved value), so they'll recompute on their own.
        const updatedNode = updatedNodes.find((n) => n.id === nodeId);
        const derived = updatedNode
            ? deriveEnvelopeFromConfig(updatedNode.type, updatedNode.data?.config)
            : null;
        const nextOutputs = derived
            ? { ...nodeOutputs, [nodeId]: derived }
            : nodeOutputs;

        set({
            currentWorkflow: { ...currentWorkflow, nodes: updatedNodes },
            nodeOutputs: nextOutputs,
            isWorkflowDirty: true,
        });
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

    reseedSourceNodeOutputs: () => {
        const { currentWorkflow, nodeOutputs } = get();
        if (!currentWorkflow) return;
        const merged: Record<string, any> = { ...nodeOutputs };
        let dirty = false;
        currentWorkflow.nodes.forEach((node) => {
            const env = deriveEnvelopeFromConfig(node.type, node.data?.config);
            if (env) {
                merged[node.id] = env;
                dirty = true;
            }
        });
        if (dirty) {
            set({ nodeOutputs: merged });
        }
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
