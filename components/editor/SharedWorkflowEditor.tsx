'use client';

import React, { useState, useEffect, useRef } from 'react';
import EditorToolbar from './EditorToolbar';
import EditorCanvas from './EditorCanvas';
import NodePalette from './NodePalette';
import PropertyPanel from './PropertyPanel';
import ResultsPanel from './ResultsPanel';
import { useWorkflowEditor } from '@/hooks/useWorkflowEditor';
import { NodeType, Workflow } from '@/lib/nodes/types';
import { executeWorkflow, executeWorkflowFromNode } from '@/lib/workflow-engine';
import { saveWorkflow } from '@/lib/db/workflows';
import { generateNodeId } from '@/lib/utils';
import { useAppStore } from '@/lib/store/app-store';
import { stableStringify } from '@/lib/utils/stable-stringify';

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
    } = useWorkflowEditor(initialWorkflow);

    const [showPropertyPanel, setShowPropertyPanel] = useState(false);
    const [executionResult, setExecutionResult] = useState<any>(null);
    const [isExecuting, setIsExecuting] = useState(false);
    const [executionError, setExecutionError] = useState<string | null>(null);
    const [showResults, setShowResults] = useState(false);
    const [selectionMode, setSelectionMode] = useState(false);
    const abortControllerRef = useRef<AbortController | null>(null);

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
            const workflow = getCurrentWorkflow();

            // Only update if not dragging and workflow has changed
            if (!isDragging) {
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
                        } else {
                            // Session changed or cleared

                        }
                    }, 300);
                }
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [nodes, edges, workflowName, isDragging]);

    const handleNodeClick = (_event: any, node: any) => {
        if (readOnly) return;
        setSelectedNode(node.id);
        setShowPropertyPanel(true);
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

    const handleRun = async () => {
        setIsExecuting(true);
        setExecutionError(null);
        setShowResults(true);

        // Create abort controller
        abortControllerRef.current = new AbortController();

        // Reset all node statuses and outputs for live streaming
        const resetNodeStatuses = useAppStore.getState().resetNodeStatuses;
        const clearNodeOutputs = useAppStore.getState().clearNodeOutputs;
        const setNodeStatus = useAppStore.getState().setNodeStatus;
        const setNodeOutput = useAppStore.getState().setNodeOutput;

        resetNodeStatuses();
        clearNodeOutputs();

        // Mark all nodes as pending
        nodes.forEach(node => setNodeStatus(node.id, 'pending'));

        const workflow = getCurrentWorkflow();
        const executionId = generateNodeId();

        // Execute with real-time status and output callbacks
        const result = await executeWorkflow(
            workflow,
            executionId,
            (nodeId, status) => setNodeStatus(nodeId, status),
            (nodeId, output) => setNodeOutput(nodeId, output)
        );

        setIsExecuting(false);

        if (result.success) {
            setExecutionResult(result.result);
            setExecutionError(null);

            // Callback for parent component (e.g., chat)
            if (onExecutionComplete) {
                onExecutionComplete(result.result);
            }
        } else {
            setExecutionError(result.error || 'Execution failed');
            setExecutionResult(null);
        }

        abortControllerRef.current = null;
    };

    // Listen for "Run From Node" triggers
    const runFromNodeId = useAppStore((state) => state.runFromNodeId);

    useEffect(() => {
        if (!runFromNodeId || isExecuting) return;

        const clearRunFromNode = useAppStore.getState().clearRunFromNode;
        clearRunFromNode();

        const runPartial = async () => {
            setIsExecuting(true);
            setExecutionError(null);
            setShowResults(true);

            const setNodeStatus = useAppStore.getState().setNodeStatus;
            const setNodeOutput = useAppStore.getState().setNodeOutput;
            const cachedOutputs = useAppStore.getState().nodeOutputs;

            const workflow = getCurrentWorkflow();
            const executionId = generateNodeId();

            const result = await executeWorkflowFromNode(
                workflow,
                executionId,
                runFromNodeId,
                cachedOutputs,
                (nodeId, status) => setNodeStatus(nodeId, status),
                (nodeId, output) => setNodeOutput(nodeId, output)
            );

            setIsExecuting(false);

            if (result.success) {
                setExecutionResult(result.result);
                setExecutionError(null);
                if (onExecutionComplete) onExecutionComplete(result.result);
            } else {
                setExecutionError(result.error || 'Partial execution failed');
                setExecutionResult(null);
            }
        };

        runPartial();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [runFromNodeId]);

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
        <div className="w-full h-full flex flex-col">
            {/* Toolbar */}
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

            {/* Main Editor Area */}
            <div className="flex-1 flex overflow-hidden">
                {/* Node Palette */}
                {!readOnly && <NodePalette onDragStart={() => { }} />}

                {/* Canvas */}
                <div className="flex-1 bg-gray-50 flex flex-col">
                    <div className="flex-1">
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
                            onNodeDragStart={onNodeDragStart}
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

                {/* Property Panel */}
                {!readOnly && showPropertyPanel && selectedNodeData && selectedNodeData.type && selectedNodeData.data?.config && (
                    <PropertyPanel
                        nodeId={selectedNodeData.id}
                        nodeType={selectedNodeData.type}
                        config={selectedNodeData.data.config}
                        onUpdate={(config) => updateNodeConfig(selectedNodeData.id, config)}
                        onClose={() => setShowPropertyPanel(false)}
                    />
                )}
            </div>
        </div>
    );
}
