'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import EditorToolbar from './EditorToolbar';
import EditorCanvas from './EditorCanvas';
import CanvasLoader from './CanvasLoader';
import PropertyPanel from './PropertyPanel';
import ResultsPanel from './ResultsPanel';
import { useWorkflowEditor } from '@/hooks/useWorkflowEditor';
import { NodeType, Workflow } from '@/lib/nodes/types';
import { saveWorkflow } from '@/lib/db/workflows';
import { generateNodeId } from '@/lib/utils';
import { useAppStore } from '@/lib/store/app-store';
import { clientRegistry } from '@/lib/nodes/core/client-registry';
import { sharedRegistry } from '@/lib/nodes/core/shared-registry';
import { validateExecution } from '@/lib/workflow/validate-execution';
import { formatValidationError } from '@/lib/workflow/validate-execution-messages';
import { motion, AnimatePresence } from 'framer-motion';
import CreditConfirmModal from './CreditConfirmModal';
import { createClient } from '@/lib/supabase/client';
import { buildModelsMap, computeExecutionCost, type CostNode } from '@/lib/billing/cost';

interface SharedWorkflowEditorProps {
    workflow?: Workflow | null;
    onExecutionComplete?: (result: any) => void;
    onWorkflowChange?: (workflow: Workflow) => void;
    showToolbar?: boolean;
    showResultsPanel?: boolean;
    readOnly?: boolean;
}

export default function SharedWorkflowEditor({
    workflow: initialWorkflow,
    onExecutionComplete,
    onWorkflowChange,
    showToolbar = true,
    showResultsPanel = true,
    readOnly = false,
}: SharedWorkflowEditorProps) {
    const activeExecutionId = useAppStore((state) => state.activeExecutionId);
    const activeCanvasId = useAppStore((state) => state.activeCanvasId);
    const collabRole = useAppStore((state) => state.collabRole);

    // Global Catalog State
    const isModelsLoading = useAppStore(state => state.isModelsLoading);
    const fetchModelCatalog = useAppStore(state => state.fetchModelCatalog);
    const fetchCategories = useAppStore(state => state.fetchCategories);
    const fetchNodeTypes = useAppStore(state => state.fetchNodeTypes);
    const fetchDataTypes = useAppStore(state => state.fetchDataTypes);

    const [isBooting, setIsBooting] = useState(true);
    // Flips true once React Flow has measured all nodes AND committed the
    // first paint — bridges the gap between catalog-loaded and canvas-visible
    // so the Lottie loader doesn't disappear before nodes paint in.
    const [isCanvasReady, setIsCanvasReady] = useState(false);

    useEffect(() => {
        const initializeCatalogs = async () => {
            await Promise.all([
                fetchModelCatalog(),
                fetchCategories(),
                fetchNodeTypes(),
                fetchDataTypes(),
                useAppStore.getState().fetchMenuData(),
            ]);
            setIsBooting(false);
        };
        initializeCatalogs();
    }, [fetchModelCatalog, fetchCategories, fetchNodeTypes, fetchDataTypes]);

    const {
        nodes,
        edges,
        onNodesChange,
        onEdgesChange,
        onConnect,
        onNodeDragStart,
        selectedNode,
        setSelectedNode,
        workflowName,
        setWorkflowName,
        addNode,
        deleteNode,
        deleteNodes,
        duplicateNodes,
        updateNodeConfig,
        updatePositions,
        getWorkflow: getCurrentWorkflow,
        clearWorkflow,
        undo,
        redo,
        canUndo,
        canRedo,
        bringNodeToFront,
    } = useWorkflowEditor(initialWorkflow);

    const [executionResult, setExecutionResult] = useState<any>(null);
    const activeRunCountRef = useRef(0);
    const [isExecuting, setIsExecuting] = useState(false);
    const [executionError, setExecutionError] = useState<string | null>(null);
    const [showResults, setShowResults] = useState(false);
    const abortControllerRef = useRef<AbortController | null>(null);

    const [showCreditModal, setShowCreditModal] = useState(false);
    const [pendingExecutionTarget, setPendingExecutionTarget] = useState<{ id: string | null, mode: 'all' | 'solo' | 'chain' | 'ab_test' | 'selection', selectionIds?: string[] } | null>(null);
    const [pendingCost, setPendingCost] = useState(0);
    const [pendingNodeCount, setPendingNodeCount] = useState(0);
    const executionTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const isMountedRef = useRef(true);
    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    // Sync state for auto-save. Fires only on real workflow changes.
    // 🚀 PERFORMANCE FIX: read isDragging imperatively, not via subscription.
    // Subscribing here forced a full SharedWorkflowEditor re-render every
    // drag-start which cascaded through the canvas tree. Position changes
    // are kept local during a drag, so global `nodes` doesn't change mid-drag
    // and this effect won't fire — the imperative check is just a defensive
    // skip for the rare case where a structural change lands while a drag
    // is in flight.
    useEffect(() => {
        if (useAppStore.getState().isDragging) return;
        if (nodes.length > 0 || edges.length > 0) {
            const workflow = getCurrentWorkflow();
            if (onWorkflowChange) {
                onWorkflowChange(workflow);
            }
        }
    }, [nodes, edges, workflowName, onWorkflowChange, getCurrentWorkflow]);

    // 🔄 Watch for execution completion via websocket updates
    const nodeStatuses = useAppStore((state) => state.nodeStatuses);
    useEffect(() => {
        if (!isExecuting || !activeExecutionId) return;

        const hasActiveNodes = Object.values(nodeStatuses).some(
            (status: any) => status === 'pending' || status === 'running'
        );

        if (!hasActiveNodes && Object.keys(nodeStatuses).length > 0) {
            setIsExecuting(false);
            useAppStore.getState().setActiveExecutionId(null);
            useAppStore.getState().setExecutionStartTime(null);
            activeRunCountRef.current = 0;

            if (executionTimeoutRef.current) {
                clearTimeout(executionTimeoutRef.current);
                executionTimeoutRef.current = null;
            }
        }
    }, [nodeStatuses, isExecuting, activeExecutionId]);

    const isViewer = collabRole === 'viewer';
    const effectiveReadOnly = readOnly || isViewer;

    const handleNodeClick = useCallback((_event: any, node: any) => {
        if (effectiveReadOnly) return;
        
        // 1. Update selection immediately
        setSelectedNode(node.id);
        
        // 2. Bring node to top visually (only if zIndex would actually change)
        const store = useAppStore.getState();
        const nodesInStore = store.currentWorkflow?.nodes || [];
        const maxZ = Math.max(0, ...nodesInStore.map(n => n.zIndex || 0));
        if ((node.zIndex || 0) < maxZ) {
            bringNodeToFront(node.id);
        }
    }, [effectiveReadOnly, setSelectedNode, bringNodeToFront]);

    const selectedNodeData = useMemo(() => nodes.find(n => n.id === selectedNode), [nodes, selectedNode]);

    // Derive visibility from selected node type
    const selectedConfig = selectedNodeData?.data?.config;
    const selectedNodeTypeId = selectedConfig && 'node_type_id' in selectedConfig ? selectedConfig.node_type_id : undefined;
    const isAiNode = selectedNodeData?.type === 'ai_generator' || !!selectedNodeTypeId;
    const hasPropertyPanel = !!(selectedNodeData && (clientRegistry[selectedNodeData.type]?.propertyPanel || isAiNode));

    const nodeTypesForIcon = useAppStore((state) => state.nodeTypes);
    const nodeLabelDraft = useAppStore((state) => state.nodeLabelDraft);

    // While a node (or marquee selection) is being dragged, slide the property
    // panel off the right edge so it doesn't obstruct the canvas. Driven off the
    // mounted panel's `animate` prop — not mount/unmount — so it returns smoothly.
    const isDragging = useAppStore((state) => state.isDragging);

    const selectedNodeIcon = useMemo(() => {
        if (!selectedNodeData) return undefined;
        if (isAiNode) {
            const aiNodeType = nodeTypesForIcon.find(nt => nt.id === selectedNodeTypeId);
            return aiNodeType?.icon_reference || sharedRegistry.ai_generator?.meta?.icon || 'Zap';
        }
        return sharedRegistry[selectedNodeData.type as keyof typeof sharedRegistry]?.meta?.icon || 'Box';
    }, [selectedNodeData, isAiNode, selectedNodeTypeId, nodeTypesForIcon]);

    const selectedNodeLabel = useMemo(() => {
        if (!selectedNodeData) return '';

        // 1. Live typing draft on the node header — wins over everything so the panel
        //    mirrors what the user is typing in real time.
        if (nodeLabelDraft && nodeLabelDraft.nodeId === selectedNodeData.id) {
            const trimmed = nodeLabelDraft.label.trim();
            if (trimmed.length > 0) return trimmed;
        }

        const persistedRaw = typeof selectedNodeData.data?.label === 'string' ? selectedNodeData.data.label.trim() : '';

        // 2. AI nodes: the factory seeds data.label with a placeholder ("AI Generator", "AI Model",
        //    "Ai Generator") that the canvas hides in favor of the resolved nodeType.display_name.
        //    Mirror that here so the panel shows the same human-facing title.
        if (isAiNode) {
            const aiNodeType = nodeTypesForIcon.find(nt => nt.id === selectedNodeTypeId);
            const aiDefaultLabel = aiNodeType?.display_name || 'AI Generator';
            const isDefaultFactoryLabel =
                persistedRaw === '' ||
                persistedRaw === 'Ai Generator' ||
                persistedRaw === 'AI Generator' ||
                persistedRaw === 'AI Model';
            return isDefaultFactoryLabel ? aiDefaultLabel : persistedRaw;
        }

        if (persistedRaw.length > 0) return persistedRaw;
        return sharedRegistry[selectedNodeData.type as keyof typeof sharedRegistry]?.meta?.label || 'Node';
    }, [selectedNodeData, isAiNode, selectedNodeTypeId, nodeTypesForIcon, nodeLabelDraft]);

    const isPropertyPanelVisible = hasPropertyPanel && !effectiveReadOnly;

    const handleDrop = useCallback((
        type: NodeType,
        position: { x: number; y: number },
        nodeTypeId?: string,
        modelId?: number,
        initialConfig?: Record<string, any>,
        autoConnect?: import('@/lib/editor/handle-compatibility').PendingConnection,
    ) => {
        if (effectiveReadOnly) return;

        let resolvedModelId = modelId;
        if (!resolvedModelId && (type === 'ai_generator' || !Object.prototype.hasOwnProperty.call(
            { media_input: 1, compositor: 1, prompt: 1, blur: 1 }, type
        ))) {
            const storeModels = useAppStore.getState().models;
            const candidateModels = nodeTypeId
                ? storeModels.filter((m: any) => m.node_type_id === nodeTypeId)
                : storeModels;
            const firstActive = candidateModels.find((m: any) => m.is_active) || candidateModels[0];
            if (firstActive) resolvedModelId = firstActive.id;
        }

        addNode(type, position, nodeTypeId, resolvedModelId, initialConfig, autoConnect);
    }, [effectiveReadOnly, addNode]);

    const handleCopy = useCallback((id: string) => {
        useAppStore.getState().copyNode(id);
    }, []);

    const handlePaste = useCallback(() => {
        if (effectiveReadOnly) return;
        const copiedNode = useAppStore.getState().copiedNode;
        if (!copiedNode) return;
        const newNode = {
            ...JSON.parse(JSON.stringify(copiedNode)),
            id: generateNodeId(),
            position: {
                x: copiedNode.position.x + 50,
                y: copiedNode.position.y + 50,
            },
        };
        duplicateNodes([newNode], []);
    }, [duplicateNodes, effectiveReadOnly]);


    const handleSave = async () => {
        const workflow = getCurrentWorkflow();
        const activeSessionId = useAppStore.getState().activeSessionId;

        if (!activeSessionId) {
            alert('No active session found. Cannot save.');
            return;
        }

        // Save to the shared CANVAS id, not the per-user thread id. For an editor
        // collaborator activeSessionId is their private companion thread; saving
        // there hides the change from others and gets overwritten on reload.
        // Mirrors useAutoSave's `activeCanvasId || activeSessionId` target.
        const result = await saveWorkflow(workflow, useAppStore.getState().activeCanvasId || activeSessionId);
        if (result.success) {
            alert('Workflow saved successfully!');
        } else {
            alert(`Error saving workflow: ${result.error}`);
        }
    };

    const commitExecution = async (targetNodeId: string | null, mode: string, selectionIds?: string[]) => {
        // Pre-flight validation. The validator is pure; we can re-run it here with
        // fresh store state to gate the POST. (The hook can't be called here —
        // we're inside a callback, not a render — but the same logic still applies.)
        {
            const state = useAppStore.getState();
            const wf = state.currentWorkflow;
            if (wf) {
                const completedNodeIds = new Set<string>();
                for (const n of wf.nodes) {
                    const liveOut = state.nodeOutputs?.[n.id];
                    const persistedOut = (n.data as any)?.output;
                    if (liveOut != null || persistedOut != null) {
                        completedNodeIds.add(n.id);
                    }
                }
                // Map store runMode (possibly 'ab_test' or 'all') to validator runMode
                // exactly like the useExecutionValidation hook does.
                const effectiveMode: 'all' | 'solo' | 'chain' | 'selection' =
                    mode === 'selection' ? 'selection' :
                    !targetNodeId ? 'all' : mode === 'chain' ? 'chain' : 'solo';
                const errors = validateExecution({
                    workflow: wf,
                    runMode: effectiveMode,
                    targetNodeId,
                    targetNodeIds: mode === 'selection' ? selectionIds : undefined,
                    completedNodeIds,
                    sharedRegistry,
                    models: state.models ?? [],
                });
                if (errors.length > 0) {
                    // Flash the per-node badges for 4 seconds so the user sees
                    // exactly which nodes are bad. Outside of this window the
                    // canvas stays uncluttered — the Run-button count + popover
                    // is the always-on awareness surface.
                    state.flashErrors();
                    if (mode !== 'solo') {
                        setExecutionError(
                            `Can't run — ${errors.length} issue${errors.length === 1 ? '' : 's'}. Hover the Run Workflow button to see them.`,
                        );
                    }
                    // Solo: the brief badge flash is the only feedback; no banner.
                    return;
                }
            }
        }
        activeRunCountRef.current += 1;
        setIsExecuting(true);
        setExecutionError(null);
        setShowResults(true);

        const store = useAppStore.getState();
        const executionId = generateNodeId();
        store.setActiveExecutionId(executionId);
        store.setExecutionStartTime(Date.now());

        // A node should appear "running" the moment Run is clicked if it is
        // either a graph root OR all of its incoming edges come from
        // non-generative families (input/utility/output — prompt, media_input,
        // blur, compositor, etc.). Those parents execute server-side in <100ms,
        // so the downstream node is the first one the user actually perceives
        // as generating. Marking it 'pending' (slate dot) for the realtime
        // roundtrip from the orchestrator's dispatch read as "idle for 2s".
        const hasGenerativeParent = (nodeId: string): boolean => {
            return edges
                .filter(e => e.target === nodeId)
                .some(e => {
                    const parent = nodes.find(n => n.id === e.source);
                    if (!parent) return false;
                    const def = sharedRegistry[parent.type as keyof typeof sharedRegistry];
                    return (def as any)?.family === 'generative';
                });
        };

        if (mode === 'selection' && selectionIds && selectionIds.length > 0) {
            // Mirror solo's optimistic status seed for every selected target,
            // so the user sees activity on click without waiting for the
            // server's realtime event.
            selectionIds.forEach((id) => store.setNodeStatus(id, 'running'));
        } else if (targetNodeId && mode === 'solo') {
            store.setNodeStatus(targetNodeId, 'running');
        } else if (targetNodeId && mode === 'chain') {
            const { getDescendants } = require('@/lib/utils/graph-traversal');
            const descendants = getDescendants(targetNodeId, edges);
            store.setNodeStatus(targetNodeId, 'running');
            descendants.forEach((id: string) => store.setNodeStatus(id, 'pending'));
        } else if (targetNodeId && mode === 'ab_test') {
            store.setNodeStatus(targetNodeId, 'running');
        } else {
            store.clearNodeOutputs();
            // Re-seed source-node outputs (Prompt text, MediaInput URLs) so
            // the compositor preview keeps working while the run is queued.
            store.reseedSourceNodeOutputs();
            nodes.forEach(n => {
                store.setNodeStatus(n.id, hasGenerativeParent(n.id) ? 'pending' : 'running');
            });
        }

        // Optimistic credit decrement — drop the balance the instant Run is
        // clicked, using the SAME estimate the modal shows. Reconciled to the
        // server's number when the debit realtime arrives (resetOptimisticDelta).
        // Computed here (not from the modal's pendingCost) so every entry point —
        // modal-confirmed runs and the runFromNodeId effect — is covered.
        const { cost: optimisticCost } = calculateExecutionCost(targetNodeId, mode, selectionIds);
        const chargedNodeIds = Object.entries(useAppStore.getState().nodeStatuses)
            .filter(([, s]) => s === 'running' || s === 'pending')
            .map(([id]) => id);
        if (optimisticCost > 0) {
            store.applyOptimisticCharge(executionId, optimisticCost, chargedNodeIds);
        }

        const workflow = getCurrentWorkflow();
        const activeSessionId = store.activeSessionId;

        try {
            const supabase = createClient();
            const { data: { user } } = await supabase.auth.getUser();

            const res = await fetch('/api/executions/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: useAppStore.getState().activeCanvasId || useAppStore.getState().activeSessionId,
                    user_id: user?.id || 'anonymous',
                    workflow: {
                        nodes: workflow.nodes,
                        edges: workflow.edges || []
                    },
                    execution_id: executionId,
                    targetNodeId,
                    targetNodeIds: mode === 'selection' ? selectionIds : undefined,
                    mode,
                })
            });

            if (!res.ok) {
                const data = await res.json().catch(() => ({} as any));
                if (data?.error === 'VALIDATION_FAILED' && Array.isArray(data.errors)) {
                    const msgs = (data.errors as any[])
                        .slice(0, 3)
                        .map((e) => formatValidationError(e))
                        .join('; ');
                    const more = data.errors.length > 3 ? `; +${data.errors.length - 3} more` : '';
                    throw new Error(`Validation failed — ${msgs}${more}`);
                }
                throw new Error(data?.error || 'Execution request failed');
            }

            const data = await res.json();
            if (data.execution_id) {
                store.setActiveExecutionId(data.execution_id);
            }

            if (executionTimeoutRef.current) {
                clearTimeout(executionTimeoutRef.current);
            }
            executionTimeoutRef.current = setTimeout(() => {
                setIsExecuting(false);
                store.setActiveExecutionId(null);
                store.setExecutionStartTime(null);
                activeRunCountRef.current = 0;
            }, 60000);

        } catch (err: any) {
            const errorMsg = err.message || 'Execution failed to start';
            setExecutionError(errorMsg);
            const { nodeStatuses } = useAppStore.getState();
            Object.entries(nodeStatuses).forEach(([nId, nStatus]) => {
                if (nStatus === 'running' || nStatus === 'pending') {
                    useAppStore.getState().setNodeStatus(nId, 'error');
                    // Surface the start/dispatch failure on the node's error-badge
                    // tooltip too, so it doesn't fall back to the generic
                    // "Generation failed" when we already know what went wrong.
                    useAppStore.getState().setNodeError(nId, errorMsg);
                }
            });
            // The run never dispatched (or the server will refund) — reverse the
            // optimistic decrement so the balance returns immediately.
            store.settleOptimisticCharge(executionId, true);
            setIsExecuting(false);
            if (executionTimeoutRef.current) {
                clearTimeout(executionTimeoutRef.current);
                executionTimeoutRef.current = null;
            }
        } finally {
            activeRunCountRef.current -= 1;
            if (activeRunCountRef.current <= 0) {
                activeRunCountRef.current = 0;
                const isStillActive = store.isExecutionActive();
                if (!isStillActive) {
                    setIsExecuting(false);
                    store.setActiveExecutionId(null);
                    store.setExecutionStartTime(null);
                    if (executionTimeoutRef.current) {
                        clearTimeout(executionTimeoutRef.current);
                        executionTimeoutRef.current = null;
                    }
                }
            }
        }
    };

    const models = useAppStore((state) => state.models);
    const modelsById = useMemo(() => buildModelsMap(models as any[]), [models]);

    const calculateExecutionCost = useCallback((targetNodeId: string | null, mode: string, selectionIds?: string[]) => {
        let executionNodes: typeof nodes = [];

        if (mode === 'selection' && selectionIds && selectionIds.length > 0) {
            const idSet = new Set(selectionIds);
            executionNodes = nodes.filter(n => idSet.has(n.id));
        } else if (targetNodeId && mode === 'solo') {
            const targetNode = nodes.find(n => n.id === targetNodeId);
            if (targetNode) executionNodes = [targetNode];
        } else if (targetNodeId && mode === 'chain') {
            const { getDescendants } = require('@/lib/utils/graph-traversal');
            const descendants = getDescendants(targetNodeId, edges);
            const targetNode = nodes.find(n => n.id === targetNodeId);
            executionNodes = [...nodes.filter(n => descendants.has(n.id))];
            if (targetNode) executionNodes.unshift(targetNode);
        } else {
            executionNodes = nodes;
        }

        const costNodes: CostNode[] = executionNodes.map(n => ({
            id: n.id,
            type: n.type as string,
            config: (n.data as any)?.config,
        }));

        const graph = {
            allNodes: nodes.map(n => ({
                id: n.id,
                type: n.type as string,
                config: (n.data as any)?.config,
            })),
            edges: edges.map(e => ({
                source: e.source,
                target: e.target,
                targetHandle: e.targetHandle ?? null,
            })),
        };

        const { cost, generativeCount } = computeExecutionCost(costNodes, modelsById, graph);
        return { cost, count: generativeCount };
    }, [nodes, edges, modelsById]);

    const handleRun = async () => {
        const { cost, count } = calculateExecutionCost(null, 'all');

        if (cost > 0) {
            setPendingExecutionTarget({ id: null, mode: 'all' });
            setPendingCost(cost);
            setPendingNodeCount(count);
            setShowCreditModal(true);
        } else {
            commitExecution(null, 'all');
        }
    };

    const runFromNodeId = useAppStore((state) => state.runFromNodeId);
    const runMode = useAppStore((state) => state.runMode);
    const runSelectionIds = useAppStore((state) => state.runSelectionIds);
    const runPreconfirmed = useAppStore((state) => state.runPreconfirmed);

    // Reverse an optimistic charge when its run settles. Mirrors the orchestrator's
    // whole-execution rule (orchestrator.ts:286): once none of the run's nodes are
    // still pending/running, refund if any failed (balance pops back up instantly),
    // otherwise just drop the bookkeeping record (debit stands; the realtime balance
    // has already reset the delta to 0).
    const nodeStatusesForSettle = useAppStore((s) => s.nodeStatuses);
    const pendingChargesForSettle = useAppStore((s) => s.pendingCharges);
    useEffect(() => {
        for (const [execId, rec] of Object.entries(pendingChargesForSettle)) {
            const statuses = rec.nodeIds.map((id) => nodeStatusesForSettle[id]);
            const anyActive = statuses.some((s) => s === 'pending' || s === 'running');
            if (anyActive) continue; // still running — wait
            const anyFailed = statuses.some((s) => s === 'error');
            useAppStore.getState().settleOptimisticCharge(execId, anyFailed);
        }
    }, [nodeStatusesForSettle, pendingChargesForSettle]);

    // Consume a run signal and dispatch. No mount-time "discard the first
    // signal" guard here: run signals (runFromNodeId/runMode/runSelectionIds/
    // runPreconfirmed) are excluded from persistence and reset in
    // onRehydrateStorage, so a refresh can never resurrect one. A mount guard
    // would instead eat LEGITIMATE in-memory signals — e.g. a chat auto-run
    // fired right as a new session's id flips the editor's `key`, remounting it.
    useEffect(() => {
        if (!runFromNodeId || !runMode) return;

        const clearRunFromNode = useAppStore.getState().clearRunFromNode;
        const targetId = runFromNodeId;
        const mode = runMode;
        // Snapshot before clearing the store — clearRunFromNode wipes runSelectionIds too.
        const selectionIds = runSelectionIds ? [...runSelectionIds] : undefined;
        const preconfirmed = runPreconfirmed;

        clearRunFromNode();

        if (mode === 'selection') {
            if (!selectionIds || selectionIds.length === 0) return;
            const present = selectionIds.filter((id) => nodes.some((n) => n.id === id));
            if (present.length === 0) return;

            const { cost, count } = calculateExecutionCost(null, 'selection', present);

            if (cost > 0 && !preconfirmed) {
                setPendingExecutionTarget({ id: null, mode: 'selection', selectionIds: present });
                setPendingCost(cost);
                setPendingNodeCount(count);
                setShowCreditModal(true);
            } else {
                // preconfirmed: the chat Run card already showed & confirmed the cost.
                commitExecution(null, 'selection', present);
            }
            return;
        }

        if (targetId && !nodes.some(n => n.id === targetId)) {
            return;
        }

        const { cost, count } = calculateExecutionCost(targetId, mode);

        if (cost > 0 && mode !== 'solo') {
            setPendingExecutionTarget({ id: targetId, mode });
            setPendingCost(cost);
            setPendingNodeCount(count);
            setShowCreditModal(true);
        } else {
            commitExecution(targetId, mode);
        }
    }, [runFromNodeId, runMode, runSelectionIds, runPreconfirmed, nodes, calculateExecutionCost]);

    const confirmCreditRun = () => {
        if (pendingExecutionTarget) {
            commitExecution(
                pendingExecutionTarget.id,
                pendingExecutionTarget.mode,
                pendingExecutionTarget.selectionIds,
            );
        }
        setShowCreditModal(false);
        setPendingExecutionTarget(null);
    };

    const handleStop = async () => {
        const executionId = useAppStore.getState().activeExecutionId;

        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }

        // Tell the server to cancel. Pending (not-yet-dispatched) nodes are
        // stopped and their exact credits refunded; in-flight Replicate nodes
        // are LEFT to finish (already billed) and their results still arrive via
        // the session realtime channel. Best-effort — the local UI resets either
        // way, and the cancel route is idempotent if the run finished first.
        if (executionId) {
            try {
                await fetch('/api/executions/cancel', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ execution_id: executionId }),
                });
            } catch (err) {
                console.error('[Editor] Cancel request failed:', err);
            }
        }

        setIsExecuting(false);
        useAppStore.getState().setActiveExecutionId(null);
        useAppStore.getState().setExecutionStartTime(null);
        activeRunCountRef.current = 0;
        if (executionTimeoutRef.current) {
            clearTimeout(executionTimeoutRef.current);
            executionTimeoutRef.current = null;
        }
    };

    const handleDelete = () => {
        if (confirm('Are you sure you want to delete this workflow?')) {
            clearWorkflow();
        }
    };

    const handleNew = () => {
        if (confirm('Create a new workflow? Unsaved changes will be lost.')) {
            clearWorkflow();
            setShowResults(false);
            setExecutionResult(null);
            setExecutionError(null);
        }
    };

    return (
        <div className="w-full h-full relative overflow-hidden flex flex-col">
            <div className="flex-1 relative flex overflow-hidden">
                {showToolbar && (
                    <EditorToolbar
                        workflowName={workflowName}
                        onNameChange={setWorkflowName}
                        onSave={handleSave}
                        onRun={handleRun}
                        onStop={handleStop}
                        isRunning={isExecuting}
                        onDelete={handleDelete}
                        onNew={handleNew}
                        canvasId={activeCanvasId}
                        isOwner={collabRole === 'owner'}
                        isViewer={isViewer}
                    />
                )}

                <div className="flex-1 relative bg-surface-primary flex flex-col overflow-hidden">
                    <div className="flex-1 relative z-10">
                        {/* Mount the canvas as soon as catalog data is in so
                            React Flow can start measuring nodes behind the
                            loader overlay. The loader covers it until the
                            onCanvasReady callback fires post-first-paint. */}
                        {!(isModelsLoading || isBooting) && (
                            <EditorCanvas
                                nodes={nodes}
                                edges={edges}
                                onNodesChange={onNodesChange}
                                onEdgesChange={onEdgesChange}
                                onConnect={onConnect}
                                onNodeClick={handleNodeClick}
                                onDrop={handleDrop}
                                updatePositions={updatePositions}
                                undo={undo}
                                redo={redo}
                                canUndo={canUndo}
                                canRedo={canRedo}
                                onNodeDragStart={onNodeDragStart}
                                onDuplicate={duplicateNodes}
                                onDelete={deleteNodes}
                                onCopy={handleCopy}
                                onPaste={handlePaste}
                                onCanvasReady={() => setIsCanvasReady(true)}
                                readOnly={effectiveReadOnly}
                            />
                        )}
                        <AnimatePresence>
                            {(isModelsLoading || isBooting || !isCanvasReady) && (
                                <motion.div
                                    key="canvas-loader"
                                    initial={{ opacity: 1 }}
                                    animate={{ opacity: 1 }}
                                    exit={{ opacity: 0 }}
                                    transition={{ duration: 0.35, ease: 'easeOut' }}
                                    className="absolute inset-0 z-30"
                                >
                                    <CanvasLoader />
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>

                    {showResultsPanel && showResults && (
                        <ResultsPanel
                            result={executionResult}
                            isExecuting={isExecuting}
                            error={executionError}
                        />
                    )}
                </div>

                <AnimatePresence>
                    {selectedNodeData && hasPropertyPanel && (
                        <motion.div
                            key={selectedNodeData.id}
                            initial={{ opacity: 0, x: 20, scale: 0.95 }}
                            animate={
                                isDragging
                                    ? {
                                          opacity: 0,
                                          x: '110%',
                                          scale: 1,
                                          transition: { duration: 0.18, ease: 'easeOut' },
                                      }
                                    : {
                                          opacity: 1,
                                          x: 0,
                                          scale: 1,
                                          transition: { duration: 0.18, ease: 'easeOut' },
                                      }
                            }
                            exit={{ opacity: 0, x: 20, scale: 0.95 }}
                            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                            className="absolute top-[72px] right-3 bottom-3 z-40 pointer-events-none flex flex-col items-end"
                            style={{
                                visibility: isPropertyPanelVisible ? 'visible' : 'hidden',
                            }}
                        >
                            <div className="marquee-passthrough pointer-events-auto max-h-full flex flex-col">
                                <PropertyPanel
                                    nodeId={selectedNodeData.id}
                                    nodeType={selectedNodeData.type}
                                    config={selectedNodeData.data.config}
                                    label={selectedNodeLabel}
                                    icon={selectedNodeIcon}
                                    onUpdate={(config) => updateNodeConfig(selectedNodeData.id, config)}
                                    onClose={() => setSelectedNode(null)}
                                />
                            </div>
                        </motion.div>
                    )}
                </AnimatePresence>

                <CreditConfirmModal
                    isOpen={showCreditModal}
                    cost={pendingCost}
                    nodeCount={pendingNodeCount}
                    mode={pendingExecutionTarget?.mode || 'all'}
                    onConfirm={confirmCreditRun}
                    onCancel={() => {
                        setShowCreditModal(false);
                        setPendingExecutionTarget(null);
                    }}
                />
            </div>
        </div>
    );
}
