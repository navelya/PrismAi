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

    // ⚠️ CRITICAL: Use initialWorkflow prop directly, NOT currentWorkflow from store
    // The store's currentWorkflow is stale during session switches and causes state leakage
    // The prop is the source of truth from the parent component (which has the correct session context)
    const {
        nodes,
        edges,
        onNodesChange,
        onEdgesChange,
        onConnect,
        onNodeDragStart, // New prop
        selectedNode,
        setSelectedNode,
        workflowName,
        setWorkflowName,
        addNode,
        deleteNode,
        deleteNodes, // New prop
        duplicateNodes, // New prop
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
    const [executionResult, setExecutionResult] = useState<any>(null);
    // Use a ref-based counter instead of boolean so concurrent runs don't block each other.
    // isExecuting = (activeRunCount > 0) for toolbar display.
    const activeRunCountRef = useRef(0);
    const [isExecuting, setIsExecuting] = useState(false);
    const [executionError, setExecutionError] = useState<string | null>(null);
    const [showResults, setShowResults] = useState(false);
    const [selectionMode, setSelectionMode] = useState(false);
    const abortControllerRef = useRef<AbortController | null>(null);

    // Credit Modal State
    const [showCreditModal, setShowCreditModal] = useState(false);
    const [pendingExecutionTarget, setPendingExecutionTarget] = useState<{ id: string | null, mode: 'all' | 'solo' | 'chain' | 'ab_test' } | null>(null);
    const [pendingCost, setPendingCost] = useState(0);
    const [pendingNodeCount, setPendingNodeCount] = useState(0);

    // Track if component is mounted to prevent stale updates
    const isMountedRef = useRef(true);
    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    // Save initial workflow to history on mount
    useEffect(() => {
        // 🛡️ DEFENSIVE: Prevent writing stale workflow to store if no active session
        const storeState = useAppStore.getState();
        const hasActiveSession = !!storeState.activeSessionId;

        if (initialWorkflow && nodes.length > 0) {
            if (hasActiveSession) {
                setCurrentWorkflow(initialWorkflow);
            } else {
                console.warn('[SharedWorkflowEditor] 🛑 Aborted reviving workflow: No active session!');
                // Optional: Force clear if we shouldn't be here with data
                if (storeState.currentWorkflow) {
                    setCurrentWorkflow(null);
                }
            }
        }
    }, [initialWorkflow, nodes.length, setCurrentWorkflow]);

    // Track last saved state to prevent infinite loops
    const lastSavedStateRef = useRef<string>('');

    // Debounce timer ref
    const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

    // Sync workflow changes to Zustand store (creates history snapshots)
    useEffect(() => {
        if (nodes.length > 0 || edges.length > 0) {
            // 👑 PERFORMANCE FIX: Exit early if dragging to avoid expensive serialization on every frame
            if (isDragging) return;

            const workflow = getCurrentWorkflow();

            // Create a stable serialization for comparison
            const currentStateString = stableStringify({
                nodes: workflow.nodes.map(n => ({ id: n.id, data: n.data, position: n.position })),
                edges: workflow.edges,
                name: workflow.name
            });

            if (currentStateString !== lastSavedStateRef.current) {
                lastSavedStateRef.current = currentStateString;

                // Clear existing timer
                if (debounceTimerRef.current) {
                    clearTimeout(debounceTimerRef.current);
                }

                // Debounce the update to prevent rapid-fire loops
                // ⚠️ CRITICAL: Check isMountedRef AND activeSessionId to prevent stale updates
                debounceTimerRef.current = setTimeout(() => {
                    // Ensure we are still the active session (or there IS an active session)
                    // This prevents the old editor from writing back to store after "New Chat" clears the session
                    const currentActiveId = useAppStore.getState().activeSessionId;

                    if (isMountedRef.current && currentActiveId) {
                        setCurrentWorkflow(workflow);
                    }
                }, 300);
            }

            // Also notify parent component
            if (onWorkflowChange) {
                onWorkflowChange(workflow);
            }
        }

        // Cleanup function
        return () => {
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
            }
        };
    }, [nodes, edges, workflowName, isDragging, onWorkflowChange, getCurrentWorkflow, setCurrentWorkflow]);

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

    const handleDrop = (type: NodeType, position: { x: number; y: number }) => {
        if (readOnly) return;
        addNode(type, position);
    };

    const handleSave = async () => {
        const workflow = getCurrentWorkflow();
        const result = await saveWorkflow(workflow, 'anonymous');
        if (result.success) {
            alert('Workflow saved successfully!');
        } else {
            alert(`Error saving workflow: ${result.error}`);
        }
    };

    // --- Core Execution Logic (Backend Post) ---
    const commitExecution = async (targetNodeId: string | null, mode: string) => {
        // Increment active run counter — allows concurrent independent runs
        activeRunCountRef.current += 1;
        setIsExecuting(true);
        setExecutionError(null);
        setShowResults(true);

        const store = useAppStore.getState();

        // Optimistically set statuses to 'pending' for targeted nodes
        // This provides instant UI feedback while the server request is in flight.
        if (targetNodeId && mode === 'solo') {
            store.setNodeStatus(targetNodeId, 'pending');
        } else if (targetNodeId && mode === 'chain') {
            const { getDescendants } = require('@/lib/utils/graph-traversal');
            const descendants = getDescendants(targetNodeId, edges);
            store.setNodeStatus(targetNodeId, 'pending');
            descendants.forEach((id: string) => store.setNodeStatus(id, 'pending'));
        } else if (targetNodeId && mode === 'ab_test') {
            // Simplification: set current node to pending. Realtime will fill rest.
            store.setNodeStatus(targetNodeId, 'pending');
        } else {
            // Full Run
            nodes.forEach(n => store.setNodeStatus(n.id, 'pending'));
            store.clearNodeOutputs();
        }

        const workflow = getCurrentWorkflow();
        const activeSessionId = store.activeSessionId;

        try {
            // Strip outputMetadata from nodes being re-executed so the server doesn't
            // reuse stale persisted Storage paths from previous runs.
            // Non-targeted nodes keep their metadata so upstream context (image URLs as inputs) is preserved.
            const sanitizedWorkflow = {
                ...workflow,
                nodes: workflow.nodes.map((node: any) => {
                    const isTarget = targetNodeId ? (node.id === targetNodeId) : true;
                    if (!isTarget) return node;
                    // Strip all execution output state from targeted nodes before sending to server
                    const { output, outputMetadata, status, ...cleanData } = node.data || {};
                    return { ...node, data: cleanData };
                })
            };

            const bodyPayload: any = {
                workflow: sanitizedWorkflow,
                sessionId: activeSessionId,
                runMode: mode
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
        } finally {
            // Decrement counter; only clear button state when ALL runs complete
            activeRunCountRef.current -= 1;
            if (activeRunCountRef.current <= 0) {
                activeRunCountRef.current = 0;
                setIsExecuting(false);
            }
        }
    };

    // --- Pricing Calculation & Modal Triggers ---

    // Helper to calculate total cost of an execution set
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
            // Mode 'all'
            executionNodes = nodes;
        }

        let cost = 0;
        let count = 0;

        executionNodes.forEach((node) => {
            const def = sharedRegistry[node.type as keyof typeof sharedRegistry];
            if (def && def.category === 'generative') {
                cost += (def.creditCost || 1); // fallback to 1 if not explicitly set
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

    // Listen for "Run From Node" triggers
    const runFromNodeId = useAppStore((state) => state.runFromNodeId);
    const runMode = useAppStore((state) => state.runMode);

    useEffect(() => {
        if (!runFromNodeId || isExecuting || !runMode) return;

        const clearRunFromNode = useAppStore.getState().clearRunFromNode;
        const targetId = runFromNodeId;
        const mode = runMode;

        clearRunFromNode(); // clear the dispatcher immediately

        const { cost, count } = calculateExecutionCost(targetId, mode);

        if (cost > 0) {
            setPendingExecutionTarget({ id: targetId, mode });
            setPendingCost(cost);
            setPendingNodeCount(count);
            setShowCreditModal(true);
        } else {
            commitExecution(targetId, mode);
        }

        // eslint-disable-next-line react-hooks/exhaustive-deps
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

        // Reset all node statuses
        const resetNodeStatuses = useAppStore.getState().resetNodeStatuses;
        resetNodeStatuses();
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
            {/* Main Editor Container */}
            <div className="flex-1 relative flex overflow-hidden">
                {/* Floating Toolbar Island - Moved up for stable centering */}
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

                {/* Canvas Area */}
                <div className="flex-1 relative bg-surface-primary flex flex-col overflow-hidden">
                    <div className="flex-1 relative z-10">
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
                            // New Undo/Redo & Action Props
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
                    </div>

                    {/* Results Panel */}
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
                            className="absolute top-[80px] right-4 bottom-4 z-40 pointer-events-none"
                        >
                            <div className="pointer-events-auto h-auto">
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
