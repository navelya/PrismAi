import { StateCreator } from 'zustand';
import { applyNodeChanges, applyEdgeChanges, addEdge, Connection } from 'reactflow';
import { sharedRegistry } from '../../nodes/core/shared-registry';
import { Workflow, WorkflowNode } from '../../nodes/types';
import { RootState, WorkflowSlice } from '../types';
import { generateEdgeId } from '@/lib/utils';
import { deriveEnvelopeFromConfig } from '@/lib/hooks/use-resolved-node-value';
import { CompositorConfig, CompositorLayer, calculateInitialTransform } from '../../nodes/types';
import {
    GROUP_PADDING,
    GROUP_TITLE_BAR_HEIGHT,
    GROUP_DEFAULT_LABEL,
    GROUP_Z_INDEX,
} from '../../nodes/group-constants';

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

        const groupX = bbox.minX - GROUP_PADDING;
        const groupY = bbox.minY - GROUP_PADDING - GROUP_TITLE_BAR_HEIGHT;
        const groupW = (bbox.maxX - bbox.minX) + GROUP_PADDING * 2;
        const groupH = (bbox.maxY - bbox.minY) + GROUP_PADDING * 2 + GROUP_TITLE_BAR_HEIGHT;

        const groupId = `group_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        get().takeSnapshot();

        const groupNode: WorkflowNode = {
            id: groupId,
            type: 'group' as any,
            position: { x: groupX, y: groupY },
            data: {
                label: GROUP_DEFAULT_LABEL,
                config: { width: groupW, height: groupH } as any,
            },
            zIndex: GROUP_Z_INDEX,
        };

        // Convert each child's absolute position to be relative to the group's
        // origin. React Flow positions parented children relative to their parent.
        const updatedNodes: WorkflowNode[] = currentWorkflow.nodes.map((n) => {
            if (!childSet.has(n.id)) return n;
            return {
                ...n,
                parentNode: groupId,
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
            groupNode,
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

        const group = currentWorkflow.nodes.find((n) => n.id === groupId && n.type === 'group');
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

    setNodeParent: (nodeId, parentId) => {
        const { currentWorkflow } = get();
        if (!currentWorkflow) return;

        const node = currentWorkflow.nodes.find((n) => n.id === nodeId);
        if (!node) return;
        if (node.type === 'group') return; // never parent a group to anything

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
        if (parentId && (!newParent || newParent.type !== 'group')) return;

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

        // If we attached to a group, expand the group to fit the new child.
        // (When detaching, we intentionally do NOT shrink the old group — per spec.)
        if (parentId && newParent) {
            const childW = node.measured?.width ?? node.width ?? 200;
            const childH = node.measured?.height ?? node.height ?? 100;
            const childRight = newX + childW;
            const childBottom = newY + childH;
            const cfg = (newParent.data?.config as any) || {};
            const requiredW = childRight + GROUP_PADDING;
            const requiredH = childBottom + GROUP_PADDING;
            const newW = Math.max(cfg.width || 0, requiredW);
            const newH = Math.max(cfg.height || 0, requiredH);
            if (newW !== cfg.width || newH !== cfg.height) {
                updatedNodes = updatedNodes.map((n) =>
                    n.id === parentId
                        ? {
                              ...n,
                              data: {
                                  ...n.data,
                                  config: { ...cfg, width: newW, height: newH },
                              },
                          }
                        : n
                );
            }
        }

        // Re-order so any parent appears before its children.
        const groups = updatedNodes.filter((n) => n.type === 'group');
        const others = updatedNodes.filter((n) => n.type !== 'group');
        const reordered = [...groups, ...others];

        set({
            currentWorkflow: { ...currentWorkflow, nodes: reordered },
            isWorkflowDirty: true,
        });
    },

    resizeGroup: (groupId, width, height) => {
        const { currentWorkflow } = get();
        if (!currentWorkflow) return;

        const group = currentWorkflow.nodes.find((n) => n.id === groupId && n.type === 'group');
        if (!group) return;

        // Clamp to children bbox + padding so user can't shrink past content.
        const children = currentWorkflow.nodes.filter((n) => n.parentNode === groupId);
        const minWidth = children.reduce((acc, c) => {
            const w = c.measured?.width ?? c.width ?? 200;
            return Math.max(acc, c.position.x + w + GROUP_PADDING);
        }, GROUP_PADDING * 2);
        const minHeight = children.reduce((acc, c) => {
            const h = c.measured?.height ?? c.height ?? 100;
            return Math.max(acc, c.position.y + h + GROUP_PADDING);
        }, GROUP_PADDING * 2 + GROUP_TITLE_BAR_HEIGHT);

        const clampedW = Math.max(width, minWidth);
        const clampedH = Math.max(height, minHeight);

        const cfg = (group.data?.config as any) || {};
        if (cfg.width === clampedW && cfg.height === clampedH) return;

        get().takeSnapshot();

        const updatedNodes = currentWorkflow.nodes.map((n) =>
            n.id === groupId
                ? {
                      ...n,
                      data: {
                          ...n.data,
                          config: { ...cfg, width: clampedW, height: clampedH },
                      },
                  }
                : n
        );

        set({
            currentWorkflow: { ...currentWorkflow, nodes: updatedNodes },
            isWorkflowDirty: true,
        });
    },

    renameGroup: (groupId, label) => {
        const { currentWorkflow } = get();
        if (!currentWorkflow) return;

        const group = currentWorkflow.nodes.find((n) => n.id === groupId && n.type === 'group');
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
});
