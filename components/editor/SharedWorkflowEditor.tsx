'use client';

import React, { useState, useEffect, useRef } from 'react';
import EditorToolbar from './EditorToolbar';
import EditorCanvas from './EditorCanvas';
import PropertyPanel from './PropertyPanel';
import ResultsPanel from './ResultsPanel';
import { useWorkflowEditor } from '@/hooks/useWorkflowEditor';
import { NodeType, Workflow } from '@/lib/nodes/types';
import { saveWorkflow } from '@/lib/db/workflows';
import { generateNodeId } from '@/lib/utils';
import { useAppStore } from '@/lib/store/app-store';
import { stableStringify } from '@/lib/utils/stable-stringify';
import { clientRegistry } from '@/lib/nodes/core/client-registry';
import { sharedRegistry } from '@/lib/nodes/core/shared-registry';
import { motion, AnimatePresence } from 'framer-motion';
import CreditConfirmModal from './CreditConfirmModal';
import { createClient } from '@/lib/supabase/client';
import { useExecutionChannel } from '@/lib/hooks/use-execution-channel';

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
    // Get current workflow from Zustand store for undo/redo
    const currentWorkflow = useAppStore((state) => state.currentWorkflow);
    const setCurrentWorkflow = useAppStore((state) => state.setCurrentWorkflow);
    const isDragging = useAppStore((state) => state.isDragging);
    const activeExecutionId = useAppStore((state) => state.activeExecutionId);
    // useExecutionChannel is mounted at the layout level in ChatClientPage to avoid duplicate subscriptions
    // Global Catalog State
    const models = useAppStore(state => state.models);
    const isModelsLoading = useAppStore(state => state.isModelsLoading);
    const fetchModelCatalog = useAppStore(state => state.fetchModelCatalog);
    const fetchCategories = useAppStore(state => state.fetchCategories);
    const fetchNodeTypes = useAppStore(state => state.fetchNodeTypes);

    useEffect(() => {
        const initializeCatalogs = async () => {
            await Promise.all([
                fetchModelCatalog(),
                fetchCategories(),
                fetchNodeTypes(),
                useAppStore.getState().fetchMenuData(),
            ]);
            setIsBooting(false);
        };
        initializeCatalogs();
    }, [fetchModelCatalog, fetchCategories, fetchNodeTypes]);

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

    const [showPropertyPanel, setShowPropertyPanel] = useState(false);
    const [isBooting, setIsBooting] = useState(true);
    const [executionResult, setExecutionResult] = useState<any>(null);
    const activeRunCountRef = useRef(0);
    const [isExecuting, setIsExecuting] = useState(false);
    const [executionError, setExecutionError] = useState<string | null>(null);
    const [showResults, setShowResults] = useState(false);
    const [selectionMode, setSelectionMode] = useState(false);
    const abortControllerRef = useRef<AbortController | null>(null);

    const [showCreditModal, setShowCreditModal] = useState(false);
    const [pendingExecutionTarget, setPendingExecutionTarget] = useState<{ id: string | null, mode: 'all' | 'solo' | 'chain' | 'ab_test' } | null>(null);
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

    // Sync state for auto-save
    const isLoadingSession = useAppStore((state) => state.isLoadingSession);
    const isLoading = useAppStore((state) => state.isLoading);
    const lastSyncedStateRef = useRef<string>('');
    const syncBackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        // 🛑 GUARD: Do not sync back to the global store if:
        // - Session is still loading (would overwrite canonical DB state)
        // - App is booting (editorState may be empty)
        // - User is dragging (too many rapid updates)
        // - AI is actively streaming (use-chat-messages owns currentWorkflow during streaming;
        //   syncing back here would overwrite incoming stream patches with stale editorState)
        if (isDragging || isLoadingSession || isBooting || isLoading) return;

        // Debounce: wait for React to fully flush editorState before reading it.
        // Without this, getCurrentWorkflow() can return a stale snapshot mid-render
        // and overwrite the store with old data (the "nodes disappear" / "deleted
        // nodes come back" race condition).
        if (syncBackTimerRef.current) {
            clearTimeout(syncBackTimerRef.current);
        }
        syncBackTimerRef.current = setTimeout(() => {
            if (!isMountedRef.current) return;

            const workflow = getCurrentWorkflow();

            const cleanWorkflow = {
                ...workflow,
                nodes: workflow.nodes.map(n => ({
                    ...n,
                    data: {
                        ...n.data,
                        status: undefined,
                        output: undefined,
                        isNew: undefined,
                    }
                }))
            };

            const currentHash = stableStringify(cleanWorkflow);

            if (currentHash !== lastSyncedStateRef.current) {
                lastSyncedStateRef.current = currentHash;
                setCurrentWorkflow(cleanWorkflow);
            }
        }, 50);
    }, [nodes, edges, isDragging, isLoadingSession, isBooting, isLoading, getCurrentWorkflow, setCurrentWorkflow]);

    useEffect(() => {
        if (nodes.length > 0 || edges.length > 0) {
            const workflow = getCurrentWorkflow();
            if (onWorkflowChange) {
                onWorkflowChange(workflow);
            }
        }
    }, [nodes, edges, workflowName, isDragging, onWorkflowChange, getCurrentWorkflow]);

    // 🔄 Watch for execution completion via websocket updates
    const nodeStatuses = useAppStore((state) => state.nodeStatuses);
    useEffect(() => {
        if (!isExecuting || !activeExecutionId) return;

        // Check if all nodes have completed (no pending or running statuses)
        const hasActiveNodes = Object.values(nodeStatuses).some(
            (status: any) => status === 'pending' || status === 'running'
        );

        if (!hasActiveNodes && Object.keys(nodeStatuses).length > 0) {
            console.log('[SharedWorkflowEditor] All nodes completed via websocket - resetting execution state');
            setIsExecuting(false);
            useAppStore.getState().setActiveExecutionId(null);
            useAppStore.getState().setExecutionStartTime(null);
            activeRunCountRef.current = 0;
            
            // Clear the safety timeout
            if (executionTimeoutRef.current) {
                clearTimeout(executionTimeoutRef.current);
                executionTimeoutRef.current = null;
            }
        }
    }, [nodeStatuses, isExecuting, activeExecutionId]);

    const handleNodeClick = (_event: any, node: any) => {
        if (readOnly) return;
        setSelectedNode(node.id);
        bringNodeToFront(node.id);
        if (clientRegistry[node.type]?.propertyPanel) {
            setShowPropertyPanel(true);
        } else {
            setShowPropertyPanel(false);
        }
    };

    const handleDrop = (type: NodeType, position: { x: number; y: number }, nodeTypeId?: string, modelId?: number, initialConfig?: Record<string, any>) => {
        if (readOnly) return;

        // For AI generator nodes without a pre-selected model, resolve the default
        // model NOW from the already-loaded store — before the node is added.
        // This prevents AIGeneratorNode from having to call setNodes() on mount
        // to set the model_id, which was bypassing editorState and wiping the workflow.
        let resolvedModelId = modelId;
        if (!resolvedModelId && (type === 'ai_generator' || !Object.prototype.hasOwnProperty.call(
            // Check if this is a dynamic AI node type (not a static node from sharedRegistry)
            { media_input: 1, compositor: 1, prompt: 1, blur: 1 }, type
        ))) {
            const storeModels = useAppStore.getState().models;
            const candidateModels = nodeTypeId
                ? storeModels.filter((m: any) => m.node_type_id === nodeTypeId)
                : storeModels;
            const firstActive = candidateModels.find((m: any) => m.is_active) || candidateModels[0];
            if (firstActive) resolvedModelId = firstActive.id;
        }

        addNode(type, position, nodeTypeId, resolvedModelId, initialConfig);
    };


    const handleSave = async () => {
        const workflow = getCurrentWorkflow();
        const activeSessionId = useAppStore.getState().activeSessionId;

        if (!activeSessionId) {
            alert('No active session found. Cannot save.');
            return;
        }

        const result = await saveWorkflow(workflow, activeSessionId);
        if (result.success) {
            alert('Workflow saved successfully!');
        } else {
            alert(`Error saving workflow: ${result.error}`);
        }
    };

    const commitExecution = async (targetNodeId: string | null, mode: string) => {
        activeRunCountRef.current += 1;
        setIsExecuting(true);
        setExecutionError(null);
        setShowResults(true);

        const store = useAppStore.getState();
        const executionId = generateNodeId();
        store.setActiveExecutionId(executionId);
        store.setExecutionStartTime(Date.now());

        if (targetNodeId && mode === 'solo') {
            store.setNodeStatus(targetNodeId, 'running');
        } else if (targetNodeId && mode === 'chain') {
            const { getDescendants } = require('@/lib/utils/graph-traversal');
            const descendants = getDescendants(targetNodeId, edges);
            
            store.setNodeStatus(targetNodeId, 'running'); // The root explicitly clicked is always running
            
            // Downstream nodes in the chain should be pending until their parents finish
            descendants.forEach((id: string) => store.setNodeStatus(id, 'pending'));
            
        } else if (targetNodeId && mode === 'ab_test') {
            store.setNodeStatus(targetNodeId, 'running');
        } else {
            // In full execution mode, nodes with no incoming dependencies start running
            store.clearNodeOutputs();
            nodes.forEach(n => {
                const hasIncomingEdges = edges.some(e => e.target === n.id);
                store.setNodeStatus(n.id, hasIncomingEdges ? 'pending' : 'running');
            });
        }

        const workflow = getCurrentWorkflow();
        const activeSessionId = store.activeSessionId;

        try {
            // Get user for V2 API
            const supabase = createClient();
            const { data: { user } } = await supabase.auth.getUser();

            // Call V2 API endpoint with RAW workflow data
            // The server will handle the V1 -> V2 transformation
            const res = await fetch('/api/executions/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    session_id: activeSessionId,
                    user_id: user?.id || 'anonymous',
                    workflow: {
                        nodes: workflow.nodes,
                        edges: workflow.edges || []
                    },
                    execution_id: executionId, // Pass our generated ID for context
                    targetNodeId,
                    mode,
                })
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Execution request failed');
            }

            const data = await res.json();
            console.log('[SharedWorkflowEditor] V2 execution started:', data.execution_id);
            
            // Update execution ID with V2 response
            if (data.execution_id) {
                store.setActiveExecutionId(data.execution_id);
            }

            // Set a safety timeout to force reset if something goes catastrophically wrong (60 seconds)
            if (executionTimeoutRef.current) {
                clearTimeout(executionTimeoutRef.current);
            }
            executionTimeoutRef.current = setTimeout(() => {
                console.warn('[SharedWorkflowEditor] Execution timeout reached - forcing reset');
                setIsExecuting(false);
                store.setActiveExecutionId(null);
                store.setExecutionStartTime(null);
                activeRunCountRef.current = 0;
            }, 60000); // 60 second timeout

        } catch (err: any) {
            const errorMsg = err.message || 'Execution failed to start';
            setExecutionError(errorMsg);
            setExecutionResult(null);
            // Reset any optimistically-set node statuses so the UI doesn't get
            // permanently stuck on 'running'. The server failed before the DB
            // was in a consistent state, so we must correct client-side state here.
            const { nodeStatuses } = useAppStore.getState();
            Object.entries(nodeStatuses).forEach(([nId, nStatus]) => {
                if (nStatus === 'running' || nStatus === 'pending') {
                    useAppStore.getState().setNodeStatus(nId, 'error');
                }
            });
            setIsExecuting(false);
            if (executionTimeoutRef.current) {
                clearTimeout(executionTimeoutRef.current);
                executionTimeoutRef.current = null;
            }
        } finally {
            activeRunCountRef.current -= 1;
            if (activeRunCountRef.current <= 0) {
                activeRunCountRef.current = 0;
                
                // Use the store's helper to check if execution is truly complete
                const isStillActive = store.isExecutionActive();
                if (!isStillActive) {
                    setIsExecuting(false);
                    store.setActiveExecutionId(null);
                    store.setExecutionStartTime(null);
                    
                    // Clear the safety timeout since execution completed normally
                    if (executionTimeoutRef.current) {
                        clearTimeout(executionTimeoutRef.current);
                        executionTimeoutRef.current = null;
                    }
                }
            }
        }
    };

    const calculateExecutionCost = (targetNodeId: string | null, mode: string) => {
        let executionNodes: typeof nodes = [];

        if (targetNodeId && mode === 'solo') {
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

        let cost = 0;
        let count = 0;

        executionNodes.forEach((node) => {
            const def = sharedRegistry[node.type as keyof typeof sharedRegistry];
            if (def && def.category === 'generative') {
                cost += (def.creditCost || 1);
                count++;
            }
        });

        return { cost, count };
    };

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

    useEffect(() => {
        if (!runFromNodeId || !runMode) return;

        const clearRunFromNode = useAppStore.getState().clearRunFromNode;
        const targetId = runFromNodeId;
        const mode = runMode;

        clearRunFromNode();

        const { cost, count } = calculateExecutionCost(targetId, mode);

        if (cost > 0) {
            setPendingExecutionTarget({ id: targetId, mode });
            setPendingCost(cost);
            setPendingNodeCount(count);
            setShowCreditModal(true);
        } else {
            commitExecution(targetId, mode);
        }
    }, [runFromNodeId, runMode]);

    const confirmCreditRun = () => {
        if (pendingExecutionTarget) {
            commitExecution(pendingExecutionTarget.id, pendingExecutionTarget.mode);
        }
        setShowCreditModal(false);
        setPendingExecutionTarget(null);
    };

    const handleStop = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        setIsExecuting(false);
        useAppStore.getState().setActiveExecutionId(null);
        // Don't reset node statuses - DB state persists and is authoritative
        // This allows users to see the final state of nodes even after stopping
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

    const selectedNodeData = nodes.find(n => n.id === selectedNode);

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
                        selectionMode={selectionMode}
                        onSelectionModeChange={setSelectionMode}
                    />
                )}

                <div className="flex-1 relative bg-surface-primary flex flex-col overflow-hidden">
                    <div className="flex-1 relative z-10">
                        {(isModelsLoading || isBooting) ? (
                            <div className="w-full h-full flex flex-col items-center justify-center bg-surface-primary gap-4">
                                <div className="w-12 h-12 border-4 border-accent-primary/20 border-t-accent-primary rounded-full animate-spin" />
                                <div className="text-xs font-bold tracking-[0.2em] uppercase text-white/30 animate-pulse">
                                    Synchronizing Neural Catalog...
                                </div>
                            </div>
                        ) : (
                            <EditorCanvas
                                nodes={nodes}
                                edges={edges}
                                onNodesChange={onNodesChange}
                                onEdgesChange={onEdgesChange}
                                onConnect={onConnect}
                                onNodeClick={handleNodeClick}
                                onDrop={handleDrop}
                                updatePositions={updatePositions}
                                selectionMode={selectionMode}
                                onSelectionToggle={() => setSelectionMode(!selectionMode)}
                                undo={undo}
                                redo={redo}
                                canUndo={canUndo}
                                canRedo={canRedo}
                                onNodeDragStart={(e, node, nodes) => {
                                    bringNodeToFront(node.id);
                                    if (onNodeDragStart) onNodeDragStart(e, node, nodes);
                                }}
                                onDuplicate={duplicateNodes}
                                onDelete={deleteNodes}
                                onCopy={(id) => useAppStore.getState().copyNode(id)}
                                onPaste={() => {
                                    const copiedNode = useAppStore.getState().copiedNode;
                                    if (copiedNode) {
                                        const newNode = {
                                            ...JSON.parse(JSON.stringify(copiedNode)),
                                            id: generateNodeId(), // 🛡️ ROOT FIX: Guaranteed unique UUID
                                            position: {
                                                x: copiedNode.position.x + 50,
                                                y: copiedNode.position.y + 50
                                            },
                                        };
                                        duplicateNodes([newNode], []);
                                    }
                                }}
                            />
                        )}
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
                    {!readOnly && showPropertyPanel && selectedNodeData?.type && selectedNodeData.data?.config && (
                        <motion.div
                            initial={{ opacity: 0, x: 20, scale: 0.95 }}
                            animate={{ opacity: 1, x: 0, scale: 1 }}
                            exit={{ opacity: 0, x: 20, scale: 0.95 }}
                            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                            className="absolute top-[72px] right-3 bottom-3 z-40 pointer-events-none flex flex-col items-end"
                        >
                            <div className="pointer-events-auto max-h-full flex flex-col">
                                <PropertyPanel
                                    nodeId={selectedNodeData.id}
                                    nodeType={selectedNodeData.type}
                                    config={selectedNodeData.data.config}
                                    onUpdate={(config) => updateNodeConfig(selectedNodeData.id, config)}
                                    onClose={() => setShowPropertyPanel(false)}
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
