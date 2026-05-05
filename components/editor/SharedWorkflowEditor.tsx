'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import EditorToolbar from './EditorToolbar';
import EditorCanvas from './EditorCanvas';
import PropertyPanel from './PropertyPanel';
import ResultsPanel from './ResultsPanel';
import { useWorkflowEditor } from '@/hooks/useWorkflowEditor';
import { NodeType, Workflow } from '@/lib/nodes/types';
import { saveWorkflow } from '@/lib/db/workflows';
import { generateNodeId } from '@/lib/utils';
import { useAppStore } from '@/lib/store/app-store';
import { clientRegistry } from '@/lib/nodes/core/client-registry';
import { sharedRegistry } from '@/lib/nodes/core/shared-registry';
import { motion, AnimatePresence } from 'framer-motion';
import CreditConfirmModal from './CreditConfirmModal';
import { createClient } from '@/lib/supabase/client';

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
    
    // Global Catalog State
    const isModelsLoading = useAppStore(state => state.isModelsLoading);
    const fetchModelCatalog = useAppStore(state => state.fetchModelCatalog);
    const fetchCategories = useAppStore(state => state.fetchCategories);
    const fetchNodeTypes = useAppStore(state => state.fetchNodeTypes);
    const fetchDataTypes = useAppStore(state => state.fetchDataTypes);

    const [isBooting, setIsBooting] = useState(true);

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
    const [pendingExecutionTarget, setPendingExecutionTarget] = useState<{ id: string | null, mode: 'all' | 'solo' | 'chain' | 'ab_test' } | null>(null);
    const [pendingCost, setPendingCost] = useState(0);
    const [pendingNodeCount, setPendingNodeCount] = useState(0);
    const executionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const hasHandledInitialRunSignalRef = useRef(false);

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

    const handleNodeClick = useCallback((_event: any, node: any) => {
        if (readOnly) return;
        
        // 1. Update selection immediately
        setSelectedNode(node.id);
        
        // 2. Bring node to top visually (only if zIndex would actually change)
        const store = useAppStore.getState();
        const nodesInStore = store.currentWorkflow?.nodes || [];
        const maxZ = Math.max(0, ...nodesInStore.map(n => n.zIndex || 0));
        if ((node.zIndex || 0) < maxZ) {
            bringNodeToFront(node.id);
        }
    }, [readOnly, setSelectedNode, bringNodeToFront]);

    const selectedNodeData = useMemo(() => nodes.find(n => n.id === selectedNode), [nodes, selectedNode]);

    // Derive visibility from selected node type
    const selectedConfig = selectedNodeData?.data?.config;
    const selectedNodeTypeId = selectedConfig && 'node_type_id' in selectedConfig ? selectedConfig.node_type_id : undefined;
    const isAiNode = selectedNodeData?.type === 'ai_generator' || !!selectedNodeTypeId;
    const hasPropertyPanel = !!(selectedNodeData && (clientRegistry[selectedNodeData.type]?.propertyPanel || isAiNode));

    const isPropertyPanelVisible = hasPropertyPanel && !readOnly;

    const handleDrop = useCallback((
        type: NodeType,
        position: { x: number; y: number },
        nodeTypeId?: string,
        modelId?: number,
        initialConfig?: Record<string, any>,
        autoConnect?: import('@/lib/editor/handle-compatibility').PendingConnection,
    ) => {
        if (readOnly) return;

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
    }, [readOnly, addNode]);

    const handleCopy = useCallback((id: string) => {
        useAppStore.getState().copyNode(id);
    }, []);

    const handlePaste = useCallback(() => {
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
    }, [duplicateNodes]);


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
                const hasIncomingEdges = edges.some(e => e.target === n.id);
                store.setNodeStatus(n.id, hasIncomingEdges ? 'pending' : 'running');
            });
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
                    session_id: activeSessionId,
                    user_id: user?.id || 'anonymous',
                    workflow: {
                        nodes: workflow.nodes,
                        edges: workflow.edges || []
                    },
                    execution_id: executionId,
                    targetNodeId,
                    mode,
                })
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Execution request failed');
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

    const calculateExecutionCost = useCallback((targetNodeId: string | null, mode: string) => {
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
    }, [nodes, edges]);

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
        if (!hasHandledInitialRunSignalRef.current) {
            hasHandledInitialRunSignalRef.current = true;
            useAppStore.getState().clearRunFromNode();
            return;
        }

        if (!runFromNodeId || !runMode) return;

        const clearRunFromNode = useAppStore.getState().clearRunFromNode;
        const targetId = runFromNodeId;
        const mode = runMode;

        clearRunFromNode();

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
    }, [runFromNodeId, runMode, nodes, calculateExecutionCost]);

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
                    />
                )}

                <div className="flex-1 relative bg-surface-primary flex flex-col overflow-hidden">
                    <div className="flex-1 relative z-10">
                        {(isModelsLoading || isBooting) ? (
                            <div className="w-full h-full flex flex-col items-center justify-center bg-surface-primary gap-4">
                                <div className="w-12 h-12 border-4 border-accent-primary/20 border-t-accent-primary rounded-full animate-spin" />
                                <div className="text-xs font-bold tracking-[0.2em] uppercase text-white/30 animate-pulse">
                                    Loading...
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
                                undo={undo}
                                redo={redo}
                                canUndo={canUndo}
                                canRedo={canRedo}
                                onNodeDragStart={onNodeDragStart}
                                onDuplicate={duplicateNodes}
                                onDelete={deleteNodes}
                                onCopy={handleCopy}
                                onPaste={handlePaste}
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
                    {selectedNodeData && hasPropertyPanel && (
                        <motion.div
                            key={selectedNodeData.id}
                            initial={{ opacity: 0, x: 20, scale: 0.95 }}
                            animate={{ 
                                opacity: 1, 
                                x: 0, 
                                scale: 1,
                                transition: { duration: 0.15 } 
                            }}
                            exit={{ opacity: 0, x: 20, scale: 0.95 }}
                            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                            className="absolute top-[72px] right-3 bottom-3 z-40 pointer-events-none flex flex-col items-end"
                            style={{ 
                                visibility: isPropertyPanelVisible ? 'visible' : 'hidden',
                                pointerEvents: 'auto'
                            }}
                        >
                            <div className="pointer-events-auto max-h-full flex flex-col">
                                <PropertyPanel
                                    nodeId={selectedNodeData.id}
                                    nodeType={selectedNodeData.type}
                                    config={selectedNodeData.data.config}
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
