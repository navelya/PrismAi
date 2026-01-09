'use client';

import React, { useState, useEffect, useRef } from 'react';
import EditorToolbar from './EditorToolbar';
import EditorCanvas from './EditorCanvas';
import NodePalette from './NodePalette';
import PropertyPanel from './PropertyPanel';
import ResultsPanel from './ResultsPanel';
import { useWorkflowEditor } from '@/hooks/useWorkflowEditor';
import { NodeType, Workflow } from '@/lib/nodes/types';
import { executeWorkflow } from '@/lib/workflow-engine';
import { saveWorkflow } from '@/lib/db/workflows';
import { generateNodeId } from '@/lib/utils';
import { useAppStore } from '@/lib/store/app-store';

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

    const {
        nodes,
        edges,
        onNodesChange,
        onEdgesChange,
        onConnect,
        selectedNode,
        setSelectedNode,
        workflowName,
        setWorkflowName,
        addNode,
        deleteNode,
        updateNodeConfig,
        updatePositions,
        getWorkflow: getCurrentWorkflow,
        clearWorkflow,
    } = useWorkflowEditor(currentWorkflow || initialWorkflow);

    const [showPropertyPanel, setShowPropertyPanel] = useState(false);
    const [executionResult, setExecutionResult] = useState<any>(null);
    const [isExecuting, setIsExecuting] = useState(false);
    const [executionError, setExecutionError] = useState<string | null>(null);
    const [showResults, setShowResults] = useState(false);
    const [selectionMode, setSelectionMode] = useState(false);
    const abortControllerRef = useRef<AbortController | null>(null);

    // Save initial workflow to history on mount
    useEffect(() => {
        if (initialWorkflow && nodes.length > 0) {
            setCurrentWorkflow(initialWorkflow, true);
        }
    }, []); // Only run once on mount

    // Sync workflow changes to Zustand store (creates history snapshots)
    useEffect(() => {
        if (nodes.length > 0 || edges.length > 0) {
            const workflow = getCurrentWorkflow();

            // Only update if not dragging and workflow has changed
            if (!isDragging) {
                setCurrentWorkflow(workflow, true);
            }

            // Also notify parent component
            if (onWorkflowChange) {
                onWorkflowChange(workflow);
            }
        }
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
