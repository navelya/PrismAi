import { StateCreator } from 'zustand';
import { applyNodeChanges, applyEdgeChanges, addEdge, Connection } from 'reactflow';
import { sharedRegistry } from '../../nodes/core/shared-registry';
import { Workflow, WorkflowNode } from '../../nodes/types';
import { RootState, WorkflowSlice } from '../types';
import { generateEdgeId } from '@/lib/utils';
import { deriveEnvelopeFromConfig } from '@/lib/hooks/use-resolved-node-value';
import { CompositorConfig, CompositorLayer, calculateInitialTransform } from '../../nodes/plugins/compositor/definition';
import {
    GROUP_PADDING,
    GROUP_DEFAULT_LABEL,
} from '../../nodes/group-constants';
import { getNodeHandleType, typesAreCompatible } from '@/lib/editor/handle-compatibility';

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
        // Temporal defaults: layer starts at t=0 and stays visible for the full
        // timeline. User drags on the timeline to position. See compositor's
        // shared.ts for how runtime resolves effective duration per source kind.
        startTime: 0,
        duration: null,
        trimIn: 0,
        trimOut: null,
        speed: 1,
        muted: false,
        transition: { type: 'none', duration: 0 },
    };
}

const HISTORY_LIMIT = 50;

export const createWorkflowSlice: StateCreator<RootState, [], [], WorkflowSlice> = (set, get) => {
    // Coalesce snapshots taken within the same microtask into a single entry.
    // A single user action often triggers multiple structural dispatches in
    // quick succession (e.g. Delete on a connected node fires onEdgesChange
    // then onNodesChange, each of which auto-snapshots). The FIRST call wins
    // — it captures the pre-action state. Subsequent calls in the same tick
    // would otherwise push intermediate states and force the user to undo
    // multiple times to revert one logical action.
    let snapshotPending = false;

    // Reset on every flashErrors() call so a rapid second Run-click restarts
    // the 4s window instead of letting the original timer cut it short.
    let flashTimer: ReturnType<typeof setTimeout> | null = null;

    return {
    activeSessionId: null,
    currentWorkflow: null,
    isDragging: false,
    copiedNode: null,
    isWorkflowDirty: false,

    // Selection
    selectedNodeId: null,
    setSelectedNodeId: (nodeId) => set({ selectedNodeId: nodeId }),

    pendingCenterNodeId: null,
    selectNodeAndCenter: (nodeId) => set({ pendingCenterNodeId: nodeId }),
    clearPendingCenterNodeId: () => set({ pendingCenterNodeId: null }),

    currentSelectedNodeIds: [],
    setCurrentSelectedNodeIds: (ids) => set({ currentSelectedNodeIds: ids }),
    selectionClearToken: 0,
    clearCanvasSelection: () =>
        set((s) => ({
            currentSelectedNodeIds: [],
            selectionClearToken: s.selectionClearToken + 1,
        })),

    errorFlashActive: false,
    flashErrors: () => {
        if (flashTimer) clearTimeout(flashTimer);
        set({ errorFlashActive: true });
        flashTimer = setTimeout(() => {
            set({ errorFlashActive: false });
            flashTimer = null;
        }, 4000);
    },

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
        if (snapshotPending) return;

        const { currentWorkflow, past } = get();
        if (!currentWorkflow) return;

        snapshotPending = true;
        queueMicrotask(() => { snapshotPending = false; });

        // Reference-snapshot, not deep-clone. Every mutation in this slice
        // (onNodesChange, updateNodePositions, updateNodeConfig, ...) builds a
        // fresh workflow object via spread/map, so the existing reference is
        // already a frozen snapshot of pre-mutation state. Deep-cloning here
        // ran a 100ms–1s JSON.parse(JSON.stringify(...)) on the main thread
        // every drag start, which was the visible "first second" stall.
        const newPast = [...past, currentWorkflow].slice(-HISTORY_LIMIT);

        set({ past: newPast, future: [] });
    },

    undo: () => {
        const { past, currentWorkflow, future } = get();
        if (past.length === 0 || !currentWorkflow) return;

        const previous = past[past.length - 1];
        const newPast = past.slice(0, past.length - 1);
        // Reference-snapshot — see takeSnapshot above.
        const newFuture = [currentWorkflow, ...future].slice(0, HISTORY_LIMIT);

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
        // Reference-snapshot — see takeSnapshot above.
        const newPast = [...past, currentWorkflow].slice(-HISTORY_LIMIT);

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

        let updatedNodes = applyNodeChanges(changes, currentWorkflow.nodes) as WorkflowNode[];

        // 🚀 Z-INDEX FIX: Ensure newly added nodes are on top
        const hasAddedNodes = changes.some(c => c.type === 'add');
        if (hasAddedNodes) {
            const maxZ = Math.max(0, ...currentWorkflow.nodes.map(n => n.zIndex || 0));
            updatedNodes = updatedNodes.map(node => {
                // If the node was just added and doesn't have a high zIndex yet
                const isNew = changes.some(c => c.type === 'add' && (c as any).item?.id === node.id);
                if (isNew && (node.zIndex || 0) <= maxZ) {
                    return { ...node, zIndex: maxZ + 1 };
                }
                return node;
            });
        }

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
        const { currentWorkflow, models } = get();
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

        // Single-input enforcement: most input handles accept exactly one
        // incoming wire. Drop any pre-existing edges targeting the same
        // (target, targetHandle) so the new wire replaces the old one — the
        // friendlier "swap" UX rather than refusing the drop. Multi-input
        // handles (those declaring `is_array: true`, e.g. compositor.layers)
        // skip this so users can keep stacking wires.
        const targetNodeForArity = currentWorkflow.nodes.find((n) => n.id === connection.target);
        const isArrayHandle = (() => {
            if (!targetNodeForArity) return false;
            if (targetNodeForArity.type === 'ai_generator') {
                const modelId = (targetNodeForArity.data?.config as any)?.model_id;
                const model = modelId ? models.find((m) => m.id === modelId) : null;
                const h = model?.inputs_schema?.handles?.find(
                    (x) => (x.api_mapping_key || x.name) === connection.targetHandle,
                );
                return h?.is_array === true;
            }
            const def = sharedRegistry[targetNodeForArity.type as keyof typeof sharedRegistry];
            const h = (def?.handles?.inputs as any[])?.find((x) => x.id === connection.targetHandle);
            return h?.is_array === true;
        })();

        const baseEdges = isArrayHandle
            ? (currentWorkflow.edges || [])
            : (currentWorkflow.edges || []).filter(
                  (e) =>
                      !(
                          e.target === connection.target &&
                          (e.targetHandle || null) === (connection.targetHandle || null)
                      ),
              );

        const updatedEdges = addEdge(newEdge, baseEdges);

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
                    cfg.canvasWidth || 1080,
                    cfg.canvasHeight || 1080
                );
                updatedNodes = currentWorkflow.nodes.map((n) =>
                    n.id === targetNode.id
                        ? {
                              ...n,
                              data: {
                                  ...n.data,
                                  config: { ...cfg, layers: [newLayer, ...existing] },
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

    pruneIncompatibleOutgoingEdges: (nodeId, outputType) => {
        const { currentWorkflow, models } = get();
        if (!currentWorkflow) return;

        const incompatible = currentWorkflow.edges.filter((edge) => {
            if (edge.source !== nodeId) return false;
            const downstream = currentWorkflow.nodes.find((n) => n.id === edge.target);
            if (!downstream) return false;
            const downstreamHandle = getNodeHandleType(
                downstream as any,
                edge.targetHandle || null,
                'target',
                models,
                sharedRegistry,
            );
            if (!downstreamHandle) return false; // unknown — keep
            return !typesAreCompatible(outputType, downstreamHandle.type);
        });

        if (incompatible.length === 0) return;

        get().takeSnapshot();

        const removeIds = new Set(incompatible.map((e) => e.id));
        set({
            currentWorkflow: {
                ...currentWorkflow,
                edges: currentWorkflow.edges.filter((e) => !removeIds.has(e.id)),
            },
            isWorkflowDirty: true,
        });
    },

    setCurrentWorkflow: (workflow, isDirty = true) => {
        if (!workflow) {
            set({ currentWorkflow: null, isWorkflowDirty: isDirty, past: [], future: [] });
            return;
        }

        const nodes = workflow.nodes || [];

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
                return {
                    ...node,
                    position: newPosition,
                    data: { ...node.data, config: newConfig }
                };
            }
            return node;
        });

        // Drop edges whose source or target node no longer exists. These can be
        // left behind by older deletes that didn't clean up edges, and they break
        // ELK auto-layout (`Referenced shape does not exist`) plus any other
        // graph consumer that assumes edges resolve.
        const validNodeIds = new Set(transformedNodes.map((n) => n.id));
        const inputEdges = workflow.edges || [];
        const allEdges = inputEdges.filter(
            (e) => validNodeIds.has(e.source) && validNodeIds.has(e.target),
        );
        // Backfill compositor layers for legacy workflows: each compositor's
        // config.layers should have one entry per incoming edge (onConnect now
        // handles this for new connections, but workflows saved before that
        // change won't have entries for their existing edges).
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
                        cfg.canvasWidth || 1080,
                        cfg.canvasHeight || 1080
                    );
                }),
            ];
            return {
                ...node,
                data: {
                    ...node.data,
                    config: { ...cfg, layers: filledLayers },
                },
            };
        });

        // Always rebuild with normalized nodes/edges arrays — the input `workflow`
        // may be missing these fields entirely (e.g. a freshly-created session whose
        // canvas_state is `{}`), and the seeding loop below assumes `nodes` is iterable.
        const finalWorkflow = { ...workflow, nodes: backfilledNodes, edges: allEdges };

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
        const { currentWorkflow, nodeOutputs, models } = get();
        if (!currentWorkflow) return;

        const oldNode = currentWorkflow.nodes.find((n) => n.id === nodeId);
        if (!oldNode) return;

        const oldConfig = (oldNode.data?.config as any) || {};
        const newConfig = (config as any) || {};

        // When an ai_generator switches model, the handle id set changes. Edges
        // pointing at handles that no longer exist must be removed from state in
        // the SAME action — RF only hides them visually, so without this the
        // edges resurface as soon as the user switches back. Doing it here (one
        // set(), one snapshot) makes a single Undo revert config + edges
        // together. We bypass this for plain control edits (no model_id change)
        // so config keystrokes don't spam the undo stack.
        const isAiModelSwitch =
            oldNode.type === 'ai_generator' &&
            oldConfig.model_id !== newConfig.model_id;

        let edgeIdsToRemove: Set<string> = new Set();
        if (isAiModelSwitch && newConfig.model_id != null) {
            const newModel = models.find((m) => m.id === newConfig.model_id);
            if (newModel) {
                const validInputIds = new Set<string>(
                    (newModel.inputs_schema?.handles || [])
                        .filter((h) => h.is_visible !== false)
                        .map((h) => h.api_mapping_key || h.name)
                );
                const validOutputIds = new Set<string>(
                    (newModel.outputs_schema?.handles || [])
                        .filter((h) => h.is_visible !== false)
                        .map((h) => h.api_mapping_key || h.name || 'output')
                );
                for (const e of currentWorkflow.edges || []) {
                    if (e.target === nodeId && e.targetHandle && !validInputIds.has(e.targetHandle)) {
                        edgeIdsToRemove.add(e.id);
                    } else if (e.source === nodeId && e.sourceHandle && !validOutputIds.has(e.sourceHandle)) {
                        edgeIdsToRemove.add(e.id);
                    }
                }
            }
        }

        if (edgeIdsToRemove.size > 0) get().takeSnapshot();

        let updatedNodes = currentWorkflow.nodes.map((node) =>
            node.id === nodeId
                ? { ...node, data: { ...node.data, config } }
                : node
        );

        let updatedEdges = currentWorkflow.edges || [];
        if (edgeIdsToRemove.size > 0) {
            const removedEdges = updatedEdges.filter((e) => edgeIdsToRemove.has(e.id));
            updatedEdges = updatedEdges.filter((e) => !edgeIdsToRemove.has(e.id));

            // Mirror the compositor-layer strip from onEdgesChange so a layer
            // doesn't outlive the edge that materialized it.
            const compositorEdgesByTarget = new Map<string, string[]>();
            removedEdges.forEach((edge) => {
                const targetNode = updatedNodes.find((n) => n.id === edge.target);
                if (targetNode?.type !== 'compositor') return;
                if (!compositorEdgesByTarget.has(edge.target)) {
                    compositorEdgesByTarget.set(edge.target, []);
                }
                compositorEdgesByTarget.get(edge.target)!.push(edge.id);
            });
            if (compositorEdgesByTarget.size > 0) {
                updatedNodes = updatedNodes.map((node) => {
                    const lostEdgeIds = compositorEdgesByTarget.get(node.id);
                    if (!lostEdgeIds || node.type !== 'compositor') return node;
                    const cfg: CompositorConfig = (node.data?.config as CompositorConfig) || ({} as CompositorConfig);
                    const layers = (cfg.layers || []).filter(
                        (l) => !lostEdgeIds.includes(l.sourceHandleId)
                    );
                    return {
                        ...node,
                        data: { ...node.data, config: { ...cfg, layers } },
                    };
                });
            }
        }

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
            currentWorkflow: {
                ...currentWorkflow,
                nodes: updatedNodes,
                edges: updatedEdges as any[],
            },
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

    groupNodes: (childIds) => {
        const { currentWorkflow } = get();
        if (!currentWorkflow || childIds.length < 2) return null;

        const childSet = new Set(childIds);
        const children = currentWorkflow.nodes.filter((n) => childSet.has(n.id));
        if (children.length < 2) return null;

        // Refuse if any child is already in a group — toolbar should hide the
        // button in this case, but defend in depth.
        if (children.some((c) => c.parentNode)) return null;

        // Compute bounding box of children (in absolute flow coordinates).
        // We use measured.width/height when available, falling back to width/height,
        // and finally a 200x100 default if RF hasn't measured the node yet.
        const bbox = children.reduce(
            (acc, n) => {
                const w = n.measured?.width ?? n.width ?? 200;
                const h = n.measured?.height ?? n.height ?? 100;
                return {
                    minX: Math.min(acc.minX, n.position.x),
                    minY: Math.min(acc.minY, n.position.y),
                    maxX: Math.max(acc.maxX, n.position.x + w),
                    maxY: Math.max(acc.maxY, n.position.y + h),
                };
            },
            { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
        );

        // The title now lives in a floating NodeToolbar bubble above the
        // container (constant screen-size, outside the node body), so we no
        // longer reserve a title-bar strip inside the group.
        const groupX = bbox.minX - GROUP_PADDING;
        const groupY = bbox.minY - GROUP_PADDING;
        const groupW = (bbox.maxX - bbox.minX) + GROUP_PADDING * 2;
        const groupH = (bbox.maxY - bbox.minY) + GROUP_PADDING * 2;

        const groupId = `group_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        get().takeSnapshot();

        const groupNode: WorkflowNode = {
            id: groupId,
            type: 'group_container',
            position: { x: groupX, y: groupY },
            data: {
                label: GROUP_DEFAULT_LABEL,
                config: { width: groupW, height: groupH } as any,
            },
            // We deliberately do NOT set a negative zIndex — that places the
            // node behind the RF pane background, which makes it invisible.
            // Children render above the parent automatically when parentNode
            // is set, so 0 (default) is correct.
            zIndex: 0,
            // We deliberately do NOT set top-level width/height or style.width/
            // height on the node. The wrapper shrink-wraps to the GroupNode
            // component's inner div (which uses data.config.width/height), and
            // RF's ResizeObserver keeps measured dimensions in sync. Setting
            // explicit dimensions here would freeze the wrapper at its initial
            // size — every resize/drag-in expand would change data.config but
            // not the wrapper, leaving RF's hit area and NodeToolbar position
            // stuck at the original size.
        };

        // Convert each child's absolute position to be relative to the group's
        // origin and CLEAR `selected` — the new group becomes the selection
        // target, not the children. Setting selection through the slice (not
        // via reactFlowInstance.setNodes) avoids a controlled/uncontrolled
        // mismatch: setNodes operates on RF's internal store, which still has
        // the pre-group node list, so its diff would emit a 'reset' change
        // back through onNodesChange and wipe the new group.
        const updatedNodes: WorkflowNode[] = currentWorkflow.nodes.map((n) => {
            if (!childSet.has(n.id)) return n;
            return {
                ...n,
                parentNode: groupId,
                selected: false,
                position: {
                    x: n.position.x - groupX,
                    y: n.position.y - groupY,
                },
            };
        });

        // Group must come BEFORE its children in the array — React Flow requires
        // a parent to appear earlier than any of its children. Otherwise
        // childen flicker at the wrong position on first render.
        const reorderedNodes = [
            { ...groupNode, selected: true } as WorkflowNode,
            ...updatedNodes,
        ];

        set({
            currentWorkflow: { ...currentWorkflow, nodes: reorderedNodes },
            isWorkflowDirty: true,
        });

        return groupId;
    },

    ungroupNode: (groupId) => {
        const { currentWorkflow } = get();
        if (!currentWorkflow) return;

        const group = currentWorkflow.nodes.find((n) => n.id === groupId && n.type === 'group_container');
        if (!group) return;

        get().takeSnapshot();

        // Convert children's positions back to absolute and clear parentNode.
        // Then remove the group node entirely.
        const updatedNodes = currentWorkflow.nodes
            .filter((n) => n.id !== groupId)
            .map((n) => {
                if (n.parentNode !== groupId) return n;
                const { parentNode: _p, extent: _e, ...rest } = n;
                return {
                    ...rest,
                    position: {
                        x: n.position.x + group.position.x,
                        y: n.position.y + group.position.y,
                    },
                };
            });

        set({
            currentWorkflow: { ...currentWorkflow, nodes: updatedNodes },
            isWorkflowDirty: true,
        });
    },

    createGroupFromSelection: (nodeIds, options) => {
        const { currentWorkflow } = get();
        if (!currentWorkflow) return null;

        const selected = currentWorkflow.nodes.filter((n) => nodeIds.includes(n.id));

        if (selected.length < 2) return null;
        if (selected.some((n) => n.parentNode)) return null;
        if (selected.some((n) => n.type === 'group_container')) return null;

        // Bounding box from absolute positions.
        const bbox = selected.reduce(
            (acc, n) => {
                const w = n.measured?.width ?? n.width ?? 200;
                const h = n.measured?.height ?? n.height ?? 100;
                return {
                    minX: Math.min(acc.minX, n.position.x),
                    minY: Math.min(acc.minY, n.position.y),
                    maxX: Math.max(acc.maxX, n.position.x + w),
                    maxY: Math.max(acc.maxY, n.position.y + h),
                };
            },
            { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
        );

        const groupX = bbox.minX - GROUP_PADDING;
        const groupY = bbox.minY - GROUP_PADDING;
        const groupW = (bbox.maxX - bbox.minX) + GROUP_PADDING * 2;
        const groupH = (bbox.maxY - bbox.minY) + GROUP_PADDING * 2;

        const groupId = `group_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        get().takeSnapshot();

        const groupNode: WorkflowNode = {
            id: groupId,
            type: 'group_container',
            position: { x: groupX, y: groupY },
            data: {
                label: options?.label ?? GROUP_DEFAULT_LABEL,
                config: {
                    width: groupW,
                    height: groupH,
                    icon: options?.icon ?? 'Folder',
                    color: options?.color ?? 'neutral',
                } as any,
            },
            zIndex: 0,
        };

        const childSet = new Set(nodeIds);
        const updatedChildren: WorkflowNode[] = currentWorkflow.nodes.map((n) => {
            if (!childSet.has(n.id)) return n;
            return {
                ...n,
                parentNode: groupId,
                selected: false,
                position: {
                    x: n.position.x - groupX,
                    y: n.position.y - groupY,
                },
            };
        });

        // Group must come BEFORE its children in the array — React Flow requires
        // a parent to appear earlier than any of its children.
        const others = updatedChildren.filter((n) => !childSet.has(n.id));
        const children = updatedChildren.filter((n) => childSet.has(n.id));

        set({
            currentWorkflow: {
                ...currentWorkflow,
                nodes: [...others, { ...groupNode, selected: true } as WorkflowNode, ...children],
            },
            isWorkflowDirty: true,
        });

        return groupId;
    },

    setNodeParent: (nodeId, parentId) => {
        const { currentWorkflow } = get();
        if (!currentWorkflow) return;

        const node = currentWorkflow.nodes.find((n) => n.id === nodeId);
        if (!node) return;
        if (node.type === 'group_container') return; // never parent a group to anything

        // Same parent — no-op (don't snapshot for nothing).
        if ((node.parentNode || null) === (parentId || null)) return;

        get().takeSnapshot();

        // Compute the node's absolute position from its current state.
        const oldParent = node.parentNode
            ? currentWorkflow.nodes.find((n) => n.id === node.parentNode)
            : null;
        const absoluteX = node.position.x + (oldParent?.position.x ?? 0);
        const absoluteY = node.position.y + (oldParent?.position.y ?? 0);

        const newParent = parentId
            ? currentWorkflow.nodes.find((n) => n.id === parentId)
            : null;
        if (parentId && (!newParent || newParent.type !== 'group_container')) return;

        // Compute the node's new position (relative to new parent if any).
        const newX = absoluteX - (newParent?.position.x ?? 0);
        const newY = absoluteY - (newParent?.position.y ?? 0);

        let updatedNodes = currentWorkflow.nodes.map((n) => {
            if (n.id !== nodeId) return n;
            if (parentId) {
                return {
                    ...n,
                    parentNode: parentId,
                    position: { x: newX, y: newY },
                };
            }
            const { parentNode: _p, extent: _e, ...rest } = n;
            return {
                ...rest,
                position: { x: newX, y: newY },
            };
        });

        // If we attached to a group, expand the group to fit the new child on
        // any side it overflows. Right/bottom expansion just grows the rect.
        // Left/top expansion ALSO requires shifting the group's origin and
        // shifting every existing child's relative position by the same delta
        // so the children stay anchored to their absolute positions.
        // (When detaching, we intentionally do NOT shrink the old group — per spec.)
        if (parentId && newParent) {
            const childW = node.measured?.width ?? node.width ?? 200;
            const childH = node.measured?.height ?? node.height ?? 100;
            const cfg = (newParent.data?.config as any) || {};

            let groupX = newParent.position.x;
            let groupY = newParent.position.y;
            let newW = cfg.width || 0;
            let newH = cfg.height || 0;
            // Amount to shift ALL children (including the just-attached one)
            // when the group's origin moves left/up.
            let childShiftX = 0;
            let childShiftY = 0;

            // Right / bottom expansion
            if (newX + childW + GROUP_PADDING > newW) {
                newW = newX + childW + GROUP_PADDING;
            }
            if (newY + childH + GROUP_PADDING > newH) {
                newH = newY + childH + GROUP_PADDING;
            }

            // Left / top expansion: move group origin and grow rect.
            if (newX < GROUP_PADDING) {
                const expand = GROUP_PADDING - newX;
                groupX -= expand;
                newW += expand;
                childShiftX = expand;
            }
            if (newY < GROUP_PADDING) {
                const expand = GROUP_PADDING - newY;
                groupY -= expand;
                newH += expand;
                childShiftY = expand;
            }

            const groupShifted =
                groupX !== newParent.position.x || groupY !== newParent.position.y;
            const sizeChanged = newW !== cfg.width || newH !== cfg.height;

            if (groupShifted || sizeChanged) {
                updatedNodes = updatedNodes.map((n) => {
                    if (n.id === parentId) {
                        return {
                            ...n,
                            position: { x: groupX, y: groupY },
                            data: {
                                ...n.data,
                                config: { ...cfg, width: newW, height: newH },
                            },
                        };
                    }
                    // Shift every child of this group (including the one we
                    // just attached) so their absolute positions stay put when
                    // the group origin moves.
                    if ((childShiftX !== 0 || childShiftY !== 0) && n.parentNode === parentId) {
                        return {
                            ...n,
                            position: {
                                x: n.position.x + childShiftX,
                                y: n.position.y + childShiftY,
                            },
                        };
                    }
                    return n;
                });
            }
        }

        // Re-order so any parent appears before its children.
        const groups = updatedNodes.filter((n) => n.type === 'group_container');
        const others = updatedNodes.filter((n) => n.type !== 'group_container');
        const reordered = [...groups, ...others];

        set({
            currentWorkflow: { ...currentWorkflow, nodes: reordered },
            isWorkflowDirty: true,
        });
    },

    resizeGroup: (groupId, width, height, opts) => {
        const anchorRight = !!opts?.anchorRight;
        const anchorBottom = !!opts?.anchorBottom;
        const skipSnapshot = !!opts?.skipSnapshot;

        const { currentWorkflow } = get();
        if (!currentWorkflow) return;

        const group = currentWorkflow.nodes.find((n) => n.id === groupId && n.type === 'group_container');
        if (!group) return;

        const cfg = (group.data?.config as any) || {};
        const storedW = cfg.width ?? width;
        const storedH = cfg.height ?? height;

        const children = currentWorkflow.nodes.filter((n) => n.parentNode === groupId);

        // The DISPLAYED dimensions before this resize — what the user can
        // actually see on the canvas. Mirrors GroupNode's render formula
        // (`max(storedW, requiredW)`). The shift math below uses these as
        // the baseline: if we used `cfg.width` (stored) alone, anchored
        // drags would over-shift the group by `(displayed - stored)` on
        // every commit whenever the children-bbox floor was binding —
        // user-visible symptom: "border moves further than the mouse".
        const requiredW = children.reduce((acc, c) => {
            const w = c.measured?.width ?? c.width ?? 200;
            return Math.max(acc, c.position.x + w + GROUP_PADDING);
        }, 0);
        const requiredH = children.reduce((acc, c) => {
            const h = c.measured?.height ?? c.height ?? 100;
            return Math.max(acc, c.position.y + h + GROUP_PADDING);
        }, 0);
        const oldW = Math.max(storedW, requiredW);
        const oldH = Math.max(storedH, requiredH);

        // Per-axis clamp. When an edge is anchored (the OPPOSITE edge is being
        // dragged), the rightmost/bottommost-child clamp is auto-satisfied
        // because that edge isn't moving — instead, the constraint is that the
        // child closest to the dragged edge can't end up outside the group's
        // padding zone after the compensating shift.
        let clampedW: number;
        if (anchorRight) {
            // User is dragging the LEFT edge. After resize, every child's
            // relative x becomes (oldX + (newW - oldW)). Require ≥ GROUP_PADDING.
            const minChildX = children.length
                ? Math.min(...children.map((c) => c.position.x))
                : Number.POSITIVE_INFINITY;
            const minNewW = Number.isFinite(minChildX)
                ? oldW + GROUP_PADDING - minChildX
                : GROUP_PADDING * 2;
            clampedW = Math.max(width, minNewW, GROUP_PADDING * 2);
        } else {
            const minWidth = children.reduce((acc, c) => {
                const w = c.measured?.width ?? c.width ?? 200;
                return Math.max(acc, c.position.x + w + GROUP_PADDING);
            }, GROUP_PADDING * 2);
            clampedW = Math.max(width, minWidth);
        }

        let clampedH: number;
        if (anchorBottom) {
            const minChildY = children.length
                ? Math.min(...children.map((c) => c.position.y))
                : Number.POSITIVE_INFINITY;
            const minNewH = Number.isFinite(minChildY)
                ? oldH + GROUP_PADDING - minChildY
                : GROUP_PADDING * 2;
            clampedH = Math.max(height, minNewH, GROUP_PADDING * 2);
        } else {
            const minHeight = children.reduce((acc, c) => {
                const h = c.measured?.height ?? c.height ?? 100;
                return Math.max(acc, c.position.y + h + GROUP_PADDING);
            }, GROUP_PADDING * 2);
            clampedH = Math.max(height, minHeight);
        }

        // Compare against displayed (oldW/oldH), not stored — otherwise a
        // floor-bound group resized to its current visible size would still
        // trip the writeback path, bumping storedW up to requiredW for no
        // user-visible reason.
        if (oldW === clampedW && oldH === clampedH) return;

        // Anchored axes: shift the group origin by -delta and inverse-shift
        // each child by +delta so children stay world-pinned. Mirrors the
        // left/top expansion in setNodeParent.
        const deltaW = clampedW - oldW;
        const deltaH = clampedH - oldH;
        const groupShiftX = anchorRight ? -deltaW : 0;
        const groupShiftY = anchorBottom ? -deltaH : 0;
        const childShiftX = anchorRight ? deltaW : 0;
        const childShiftY = anchorBottom ? deltaH : 0;

        // Callers driving a live resize drag (one resizeGroup call per
        // pointermove) pass `skipSnapshot: true` and snapshot ONCE on
        // pointerdown themselves — otherwise the undo stack collects one
        // entry per pointer tick and the user has to mash ctrl-z to revert
        // a single drag.
        if (!skipSnapshot) get().takeSnapshot();

        const updatedNodes = currentWorkflow.nodes.map((n) => {
            if (n.id === groupId) {
                return {
                    ...n,
                    position:
                        groupShiftX !== 0 || groupShiftY !== 0
                            ? { x: n.position.x + groupShiftX, y: n.position.y + groupShiftY }
                            : n.position,
                    data: {
                        ...n.data,
                        config: { ...cfg, width: clampedW, height: clampedH },
                    },
                };
            }
            if ((childShiftX !== 0 || childShiftY !== 0) && n.parentNode === groupId) {
                return {
                    ...n,
                    position: {
                        x: n.position.x + childShiftX,
                        y: n.position.y + childShiftY,
                    },
                };
            }
            return n;
        });

        set({
            currentWorkflow: { ...currentWorkflow, nodes: updatedNodes },
            isWorkflowDirty: true,
        });
    },

    renameGroup: (groupId, label) => {
        const { currentWorkflow } = get();
        if (!currentWorkflow) return;

        const group = currentWorkflow.nodes.find((n) => n.id === groupId && n.type === 'group_container');
        if (!group) return;
        if ((group.data?.label || '') === label) return;

        get().takeSnapshot();

        const updatedNodes = currentWorkflow.nodes.map((n) =>
            n.id === groupId
                ? { ...n, data: { ...n.data, label } }
                : n
        );

        set({
            currentWorkflow: { ...currentWorkflow, nodes: updatedNodes },
            isWorkflowDirty: true,
        });
    },
    };
};
