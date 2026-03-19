'use client';

import React, { useState, useEffect, useRef } from 'react';
import EditorToolbar from './EditorToolbar';
import EditorCanvas from './EditorCanvas';
import PropertyPanel from './PropertyPanel';
import ResultsPanel from './ResultsPanel';
import { useWorkflowEditor } from '@/hooks/useWorkflowEditor';
import { NodeType, Workflow } from '@/lib/nodes/types';
import { saveWorkflow } from '@/lib/db/workflows';
import { executeWorkflow, executeWorkflowFromNode } from '@/lib/workflow-engine';
import { generateNodeId } from '@/lib/utils';
import { useAppStore } from '@/lib/store/app-store';
import { useAutoSave } from '@/hooks/useAutoSave';
import { stableStringify } from '@/lib/utils/stable-stringify';
import { clientRegistry } from '@/lib/nodes/core/client-registry';
import { sharedRegistry } from '@/lib/nodes/core/shared-registry';
import { motion, AnimatePresence } from 'framer-motion';
import CreditConfirmModal from './CreditConfirmModal';

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

    const isMountedRef = useRef(true);
    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    // 🛡️ Enable Global Auto-Save Persistence
    useAutoSave();

    // 🔄 Sync local editor state to global store for auto-save
    const lastSyncedStateRef = useRef<string>('');
    
    useEffect(() => {
        if (isDragging) return;
        
        const workflow = getCurrentWorkflow();
        const currentHash = stableStringify(workflow);
        
        if (currentHash !== lastSyncedStateRef.current) {
            lastSyncedStateRef.current = currentHash;
            setCurrentWorkflow(workflow);
        }
    }, [nodes, edges, isDragging, getCurrentWorkflow, setCurrentWorkflow]);

    useEffect(() => {
        if (nodes.length > 0 || edges.length > 0) {
            const workflow = getCurrentWorkflow();
            if (onWorkflowChange) {
                onWorkflowChange(workflow);
            }
        }
    }, [nodes, edges, workflowName, isDragging, onWorkflowChange, getCurrentWorkflow]);

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

    const handleDrop = (type: NodeType, position: { x: number; y: number }, nodeTypeId?: string) => {
        if (readOnly) return;
        addNode(type, position, nodeTypeId);
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
            store.setNodeStatus(targetNodeId, 'pending');
        } else if (targetNodeId && mode === 'chain') {
            const { getDescendants } = require('@/lib/utils/graph-traversal');
            const descendants = getDescendants(targetNodeId, edges);
            store.setNodeStatus(targetNodeId, 'pending');
            descendants.forEach((id: string) => store.setNodeStatus(id, 'pending'));
        } else if (targetNodeId && mode === 'ab_test') {
            store.setNodeStatus(targetNodeId, 'pending');
        } else {
            nodes.forEach(n => store.setNodeStatus(n.id, 'pending'));
            store.clearNodeOutputs();
        }

        const workflow = getCurrentWorkflow();
        const activeSessionId = store.activeSessionId;

        try {
            const sanitizedWorkflow = {
                ...workflow,
                nodes: workflow.nodes.map((node: any) => {
                    const isTarget = targetNodeId ? (node.id === targetNodeId) : true;
                    if (!isTarget) return node;
                    const { output, outputMetadata, status, ...cleanData } = node.data || {};
                    return { ...node, data: cleanData };
                })
            };

            const bodyPayload: any = {
                workflow: sanitizedWorkflow,
                sessionId: activeSessionId,
                runMode: mode,
                executionId,
            };

            if (targetNodeId) {
                bodyPayload.runFromNodeId = targetNodeId;
            }

            const res = await fetch('/api/workflow/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(bodyPayload)
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Execution request failed');
            }

        } catch (err: any) {
            setExecutionError(err.message || 'Execution failed to start');
            setExecutionResult(null);
            // Don't reset node statuses on error - DB state is authoritative
            // User can see which nodes completed before the error
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
        if (isExecuting) return;
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
        if (!runFromNodeId || isExecuting || !runMode) return;

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
                                            id: `node_${Date.now()}`,
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
