import { Workflow, WorkflowNode, ExecutionContext, NodeExecutionResult, NodeStatus } from './nodes/types';
import { getNodeExecutor } from './nodes/registry';

/**
 * Build dependency graph for parallel execution
 */
function buildDependencyGraph(nodes: WorkflowNode[], edges: { source: string; target: string }[]) {
    const parents = new Map<string, string[]>();
    const children = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    // Initialize
    nodes.forEach(node => {
        parents.set(node.id, []);
        children.set(node.id, []);
        inDegree.set(node.id, 0);
    });

    // Build graph
    edges.forEach(edge => {
        children.get(edge.source)?.push(edge.target);
        parents.get(edge.target)?.push(edge.source);
        inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
    });

    return { parents, children, inDegree };
}

/**
 * Execute a complete workflow with TRUE PARALLEL EXECUTION
 * - Independent nodes run simultaneously
 * - Nodes wait for ALL parents to complete
 * - Failures are isolated to individual branches
 * @param onStatusUpdate Optional callback for real-time status updates
 * @param onNodeOutput Optional callback for streaming node outputs
 */
export async function executeWorkflow(
    workflow: Workflow,
    executionId: string,
    onStatusUpdate?: (nodeId: string, status: NodeStatus, workflow?: any) => void,
    onNodeOutput?: (nodeId: string, output: any) => void,
    cachedOutputs?: Record<string, any> // New optional param
): Promise<{
    success: boolean;
    result: any;
    error?: string;
}> {
    try {
        if (!workflow.nodes || workflow.nodes.length === 0) {
            throw new Error('Workflow has no nodes');
        }

        // Build dependency graph
        const { parents, children, inDegree } = buildDependencyGraph(workflow.nodes, workflow.edges);

        // Create execution context
        const context: ExecutionContext = {
            workflowId: workflow.id || 'temp',
            executionId,
            data: null,
        };

        // Track node states
        const nodeOutputs = new Map<string, any>();
        const completedNodes = new Set<string>();
        const failedNodes = new Set<string>();
        const blockedNodes = new Set<string>();
        const currentInDegree = new Map(inDegree); // Mutable copy
        let firstError: string | undefined;

        // Pre-seed from cache
        if (cachedOutputs) {
            Object.entries(cachedOutputs).forEach(([nodeId, output]) => {
                if (output !== undefined) {
                    nodeOutputs.set(nodeId, output);
                    completedNodes.add(nodeId);

                    // Mutate workflow for cache hits
                    const cachedNode = workflow.nodes.find(n => n.id === nodeId);
                    if (cachedNode) {
                        if (!cachedNode.data) cachedNode.data = { label: cachedNode.type, config: {} as any };
                        (cachedNode.data as any).status = 'success';

                        // Try to extract images for thumbnails
                        if (Array.isArray(output) && output.length > 0 && output[0].url) {
                            (cachedNode.data as any).outputMetadata = { preview_urls: output.slice(0, 4).map(o => o.url) };
                        } else if (output && typeof output === 'object' && output.url) {
                            (cachedNode.data as any).outputMetadata = { preview_urls: [output.url] };
                        }
                    }

                    onStatusUpdate?.(nodeId, 'success', workflow);
                    // onNodeOutput?.(nodeId, output); // Optional: re-emit cached output if needed

                    // Decrement in-degree for children
                    const childIds = children.get(nodeId) || [];
                    childIds.forEach(childId => {
                        const newDegree = (currentInDegree.get(childId) || 0) - 1;
                        currentInDegree.set(childId, newDegree);
                    });
                }
            });
        }

        // Find initial ready nodes (no dependencies AND not completed)
        let readyNodes = workflow.nodes.filter(node =>
            (currentInDegree.get(node.id) || 0) <= 0 && !completedNodes.has(node.id)
        );

        // Execute in waves until no more progress
        while (readyNodes.length > 0) {

            // Execute all ready nodes in parallel
            const waveExecutions = readyNodes.map(async (node) => {
                // Mark as running
                if (!node.data) node.data = { label: node.type, config: {} as any };
                (node.data as any).status = 'running';
                delete (node.data as any).error; // Clear old errors
                if (onStatusUpdate) await onStatusUpdate(node.id, 'running', workflow);

                try {
                    const executor = getNodeExecutor(node.type);
                    if (!executor) {
                        throw new Error(`No executor found for node type: ${node.type}`);
                    }

                    // Gather inputs from all parents
                    const parentIds = parents.get(node.id) || [];
                    let input = null;

                    // For merge_image node, separate inputs by targetHandle
                    if (node.type === 'merge_image') {
                        const incomingEdges = workflow.edges.filter(e => e.target === node.id);
                        let baseEdge = incomingEdges.find(e => (e as any).targetHandle === 'base');
                        let overlayEdge = incomingEdges.find(e => (e as any).targetHandle === 'overlay');

                        // Fallback: if no targetHandle, infer from source node type
                        // - remove_background output goes to overlay (it's the subject)
                        // - ai_generate_image output goes to base (it's the background)
                        if (!baseEdge || !overlayEdge) {
                            for (const edge of incomingEdges) {
                                const sourceNode = workflow.nodes.find(n => n.id === edge.source);
                                if (!sourceNode) continue;

                                if (sourceNode.type === 'remove_background' && !overlayEdge) {
                                    overlayEdge = edge;
                                } else if ((sourceNode.type === 'ai_generate_image' || sourceNode.type === 'scrape_images') && !baseEdge) {
                                    baseEdge = edge;
                                }
                            }

                            // Final fallback: first edge = base, second = overlay
                            if (!baseEdge && incomingEdges.length >= 1) baseEdge = incomingEdges[0];
                            if (!overlayEdge && incomingEdges.length >= 2) overlayEdge = incomingEdges[1];
                        }

                        input = {
                            base: baseEdge ? nodeOutputs.get(baseEdge.source) : null,
                            overlay: overlayEdge ? nodeOutputs.get(overlayEdge.source) : null,
                        };

                    } else if (node.type === 'compositor') {
                        // Compositor: map inputs by target handle ID (layer_0, layer_1, etc.)
                        const incomingEdges = workflow.edges.filter(e => e.target === node.id);
                        const handleInputs: Record<string, any> = {};

                        for (const edge of incomingEdges) {
                            const handleId = (edge as any).targetHandle || 'default';
                            handleInputs[handleId] = nodeOutputs.get(edge.source);
                        }

                        input = handleInputs;

                    } else if (parentIds.length === 1) {
                        // Single parent - use output directly
                        input = nodeOutputs.get(parentIds[0]);
                    } else if (parentIds.length > 1) {
                        // Multiple parents - merge outputs
                        const allInputs = parentIds
                            .map(parentId => nodeOutputs.get(parentId))
                            .filter(Boolean);

                        if (allInputs.length > 0 && Array.isArray(allInputs[0])) {
                            // Flatten arrays (e.g., multiple image lists)
                            input = allInputs.flat();
                        } else {
                            // Use first input as fallback
                            input = allInputs[0];
                        }
                    }

                    // Execute node with strict 60s timeout to prevent indefinite engine hangs
                    const timeoutPromise = new Promise<NodeExecutionResult>((_, reject) =>
                        setTimeout(() => reject(new Error(`Timeout: Node ${node.type} failed to complete in 60s`)), 60000)
                    );

                    const result: NodeExecutionResult = await Promise.race([
                        executor(node.data.config, input, context),
                        timeoutPromise
                    ]);

                    if (!result.success) {
                        throw new Error(result.error || 'Node execution failed');
                    }

                    return {
                        nodeId: node.id,
                        success: true,
                        output: result.data,
                    };

                } catch (error) {
                    return {
                        nodeId: node.id,
                        success: false,
                        error: error instanceof Error ? error.message : 'Unknown error',
                    };
                }
            });

            // Wait for all nodes in this wave using allSettled (failures don't stop others)
            const waveResults = await Promise.allSettled(waveExecutions);

            // Process results
            const nextReadyNodes: WorkflowNode[] = [];

            for (let index = 0; index < waveResults.length; index++) {
                const result = waveResults[index];
                const node = readyNodes[index];

                if (result.status === 'fulfilled' && result.value.success) {
                    // Node succeeded
                    completedNodes.add(node.id);
                    nodeOutputs.set(node.id, result.value.output);

                    // Mutate workflow with success state and thumbnails
                    (node.data as any).status = 'success';
                    const outputStr = result.value.output;
                    if (Array.isArray(outputStr) && outputStr.length > 0 && outputStr[0].url) {
                        (node.data as any).outputMetadata = { preview_urls: outputStr.slice(0, 4).map(o => o.url) };
                    } else if (outputStr && typeof outputStr === 'object' && outputStr.url) {
                        (node.data as any).outputMetadata = { preview_urls: [outputStr.url] };
                    }

                    if (onStatusUpdate) await onStatusUpdate(node.id, 'success', workflow);

                    // Emit the output for live streaming results
                    onNodeOutput?.(node.id, result.value.output);

                    // Unlock children
                    const childIds = children.get(node.id) || [];
                    childIds.forEach(childId => {
                        if (!blockedNodes.has(childId)) {
                            const newDegree = (currentInDegree.get(childId) || 0) - 1;
                            currentInDegree.set(childId, newDegree);

                            // If child is now ready, add to next wave
                            if (newDegree <= 0 && !completedNodes.has(childId)) {
                                const childNode = workflow.nodes.find(n => n.id === childId);
                                if (childNode) {
                                    nextReadyNodes.push(childNode);
                                }
                            }
                        }
                    });

                } else {
                    // Node failed
                    failedNodes.add(node.id);
                    const errorMsg = result.status === 'rejected' ? result.reason : (result as any).value.error;
                    if (!firstError) firstError = errorMsg;

                    // Mutate workflow with error state
                    (node.data as any).status = 'error';
                    (node.data as any).error = errorMsg;

                    if (onStatusUpdate) await onStatusUpdate(node.id, 'error', workflow);

                    // Block all downstream nodes in this branch
                    const blockDownstream = (nodeId: string) => {
                        const childIds = children.get(nodeId) || [];
                        childIds.forEach(childId => {
                            if (!blockedNodes.has(childId)) {
                                blockedNodes.add(childId);
                                const childNode = workflow.nodes.find(n => n.id === childId);
                                if (childNode) {
                                    (childNode.data as any).status = 'error';
                                    (childNode.data as any).error = 'Blocked by upstream error';
                                }
                                blockDownstream(childId);
                            }
                        });
                    };

                    blockDownstream(node.id);
                }
            }
            // Move to next wave
            readyNodes = nextReadyNodes;
        }

        // Find the final output node(s) - nodes with no children
        const finalNodes = Array.from(completedNodes).filter(nodeId => {
            const childIds = children.get(nodeId) || [];
            return childIds.length === 0;
        });

        // Get the output from the final node(s)
        let finalResult;
        if (finalNodes.length === 1) {
            // Single final node - return its output directly
            finalResult = nodeOutputs.get(finalNodes[0]);
        } else if (finalNodes.length > 1) {
            // Multiple final nodes - merge their outputs
            const outputs = finalNodes.map(nodeId => nodeOutputs.get(nodeId)).filter(Boolean);

            // If all outputs are arrays (e.g., images), flatten them
            if (outputs.every(output => Array.isArray(output))) {
                finalResult = outputs.flat();
            } else {
                finalResult = outputs;
            }
        } else {
            // No final nodes (all blocked/failed) - return null
            finalResult = null;
        }

        // Return result
        return {
            success: completedNodes.size > 0,
            result: finalResult,
            error: failedNodes.size > 0 ? (firstError || `${failedNodes.size} node(s) failed`) : undefined,
        };

    } catch (error) {
        console.error('💥 Workflow execution error:', error);
        return {
            success: false,
            result: null,
            error: error instanceof Error ? error.message : 'Unknown execution error',
        };
    }
}

/**
 * Execute a workflow starting from a specific node.
 * - Upstream nodes with cached outputs are skipped (pre-seeded)
 * - Only the startNode and its downstream descendants are executed
 * - If an upstream node has no cached output, it is included in execution
 */
export async function executeWorkflowFromNode(
    workflow: Workflow,
    executionId: string,
    startNodeId: string,
    cachedOutputs: Record<string, any>,
    onStatusUpdate?: (nodeId: string, status: NodeStatus) => void,
    onNodeOutput?: (nodeId: string, output: any) => void
): Promise<{
    success: boolean;
    result: any;
    error?: string;
}> {
    try {
        if (!workflow.nodes || workflow.nodes.length === 0) {
            throw new Error('Workflow has no nodes');
        }

        const { parents, children, inDegree } = buildDependencyGraph(workflow.nodes, workflow.edges);

        // BFS from startNode to find all downstream nodes (including startNode itself)
        const downstreamSet = new Set<string>();
        const queue = [startNodeId];
        while (queue.length > 0) {
            const nodeId = queue.shift()!;
            if (downstreamSet.has(nodeId)) continue;
            downstreamSet.add(nodeId);
            const childIds = children.get(nodeId) || [];
            childIds.forEach(c => queue.push(c));
        }

        // Create execution context
        const context: ExecutionContext = {
            workflowId: workflow.id || 'temp',
            executionId,
            data: null,
        };

        // Track node states
        const nodeOutputs = new Map<string, any>();
        const completedNodes = new Set<string>();
        const failedNodes = new Set<string>();
        const blockedNodes = new Set<string>();
        const currentInDegree = new Map(inDegree);
        let firstError: string | undefined;

        // Pre-seed upstream nodes: any node NOT in downstreamSet that has cached output
        for (const node of workflow.nodes) {
            if (!downstreamSet.has(node.id) && cachedOutputs[node.id] !== undefined) {
                nodeOutputs.set(node.id, cachedOutputs[node.id]);
                completedNodes.add(node.id);
                onStatusUpdate?.(node.id, 'success');

                // Decrement in-degree for children of this pre-seeded node
                const childIds = children.get(node.id) || [];
                childIds.forEach(childId => {
                    currentInDegree.set(childId, (currentInDegree.get(childId) || 0) - 1);
                });
            }
        }

        // Find initial ready nodes within the downstream set
        let readyNodes = workflow.nodes.filter(node =>
            downstreamSet.has(node.id) && currentInDegree.get(node.id) === 0
        );

        // Mark downstream nodes as pending
        for (const node of workflow.nodes) {
            if (downstreamSet.has(node.id) && !readyNodes.find(r => r.id === node.id)) {
                onStatusUpdate?.(node.id, 'pending');
            }
        }

        let waveNumber = 1;

        while (readyNodes.length > 0) {
            const waveExecutions = readyNodes.map(async (node) => {
                onStatusUpdate?.(node.id, 'running');

                try {
                    const executor = getNodeExecutor(node.type);
                    if (!executor) {
                        throw new Error(`No executor found for node type: ${node.type}`);
                    }

                    // Gather inputs from all parents (same logic as executeWorkflow)
                    const parentIds = parents.get(node.id) || [];
                    let input = null;

                    if (node.type === 'merge_image') {
                        const incomingEdges = workflow.edges.filter(e => e.target === node.id);
                        let baseEdge = incomingEdges.find(e => (e as any).targetHandle === 'base');
                        let overlayEdge = incomingEdges.find(e => (e as any).targetHandle === 'overlay');

                        if (!baseEdge || !overlayEdge) {
                            for (const edge of incomingEdges) {
                                const sourceNode = workflow.nodes.find(n => n.id === edge.source);
                                if (!sourceNode) continue;
                                if (sourceNode.type === 'remove_background' && !overlayEdge) {
                                    overlayEdge = edge;
                                } else if ((sourceNode.type === 'ai_generate_image' || sourceNode.type === 'scrape_images') && !baseEdge) {
                                    baseEdge = edge;
                                }
                            }
                            if (!baseEdge && incomingEdges.length >= 1) baseEdge = incomingEdges[0];
                            if (!overlayEdge && incomingEdges.length >= 2) overlayEdge = incomingEdges[1];
                        }

                        input = {
                            base: baseEdge ? nodeOutputs.get(baseEdge.source) : null,
                            overlay: overlayEdge ? nodeOutputs.get(overlayEdge.source) : null,
                        };
                    } else if (node.type === 'compositor') {
                        const incomingEdges = workflow.edges.filter(e => e.target === node.id);
                        const handleInputs: Record<string, any> = {};
                        for (const edge of incomingEdges) {
                            const handleId = (edge as any).targetHandle || 'default';
                            handleInputs[handleId] = nodeOutputs.get(edge.source);
                        }
                        input = handleInputs;
                    } else if (parentIds.length === 1) {
                        input = nodeOutputs.get(parentIds[0]);
                    } else if (parentIds.length > 1) {
                        const allInputs = parentIds.map(pid => nodeOutputs.get(pid)).filter(Boolean);
                        if (allInputs.length > 0 && Array.isArray(allInputs[0])) {
                            input = allInputs.flat();
                        } else {
                            input = allInputs[0];
                        }
                    }

                    // Execute node with strict 60s timeout to prevent indefinite engine hangs
                    const timeoutPromise = new Promise<NodeExecutionResult>((_, reject) =>
                        setTimeout(() => reject(new Error(`Timeout: Node ${node.type} failed to complete in 60s`)), 60000)
                    );

                    const result: NodeExecutionResult = await Promise.race([
                        executor(node.data.config, input, context),
                        timeoutPromise
                    ]);
                    if (!result.success) {
                        throw new Error(result.error || 'Node execution failed');
                    }

                    return { nodeId: node.id, success: true, output: result.data };
                } catch (error) {
                    return {
                        nodeId: node.id,
                        success: false,
                        error: error instanceof Error ? error.message : 'Unknown error',
                    };
                }
            });

            const waveResults = await Promise.allSettled(waveExecutions);
            const nextReadyNodes: WorkflowNode[] = [];

            waveResults.forEach((result, index) => {
                const node = readyNodes[index];

                if (result.status === 'fulfilled' && result.value.success) {
                    completedNodes.add(node.id);
                    nodeOutputs.set(node.id, result.value.output);
                    onStatusUpdate?.(node.id, 'success');
                    onNodeOutput?.(node.id, result.value.output);

                    const childIds = children.get(node.id) || [];
                    childIds.forEach(childId => {
                        if (!blockedNodes.has(childId) && downstreamSet.has(childId)) {
                            const newDegree = (currentInDegree.get(childId) || 0) - 1;
                            currentInDegree.set(childId, newDegree);
                            if (newDegree === 0) {
                                const childNode = workflow.nodes.find(n => n.id === childId);
                                if (childNode) nextReadyNodes.push(childNode);
                            }
                        }
                    });
                } else {
                    const errorMsg = result.status === 'fulfilled' ? result.value.error : 'Promise rejected';
                    if (!firstError) firstError = `${node.type} failed: ${errorMsg}`;
                    failedNodes.add(node.id);
                    onStatusUpdate?.(node.id, 'error');

                    const blockDownstream = (nodeId: string) => {
                        const childIds = children.get(nodeId) || [];
                        childIds.forEach(childId => {
                            if (!blockedNodes.has(childId)) {
                                blockedNodes.add(childId);
                                blockDownstream(childId);
                            }
                        });
                    };
                    blockDownstream(node.id);
                }
            });

            readyNodes = nextReadyNodes;
        }

        // Find final output from downstream completed nodes with no children (or no downstream children)
        const finalNodes = Array.from(completedNodes).filter(nodeId => {
            if (!downstreamSet.has(nodeId)) return false; // skip pre-seeded upstream
            const childIds = children.get(nodeId) || [];
            return childIds.length === 0 || childIds.every(c => !downstreamSet.has(c));
        });

        let finalResult;
        if (finalNodes.length === 1) {
            finalResult = nodeOutputs.get(finalNodes[0]);
        } else if (finalNodes.length > 1) {
            const outputs = finalNodes.map(nid => nodeOutputs.get(nid)).filter(Boolean);
            finalResult = outputs.every(o => Array.isArray(o)) ? outputs.flat() : outputs;
        } else {
            finalResult = null;
        }

        return {
            success: completedNodes.size > 0,
            result: finalResult,
            error: failedNodes.size > 0 ? (firstError || `${failedNodes.size} node(s) failed`) : undefined,
        };

    } catch (error) {
        console.error('💥 Workflow partial execution error:', error);
        return {
            success: false,
            result: null,
            error: error instanceof Error ? error.message : 'Unknown execution error',
        };
    }
}

/**
 * Validate workflow structure
 */
export function validateWorkflow(workflow: Workflow): {
    valid: boolean;
    errors: string[];
} {
    const errors: string[] = [];

    if (!workflow.nodes || workflow.nodes.length === 0) {
        errors.push('Workflow must have at least one node');
    }

    // Check for invalid node types
    const validTypes = ['scrape_images', 'remove_background', 'filter_sort', 'ai_generate_image', 'upscale_image', 'merge_image', 'media_input', 'compositor'];
    workflow.nodes.forEach(node => {
        if (!validTypes.includes(node.type)) {
            errors.push(`Invalid node type: ${node.type}`);
        }
    });

    // Check for orphaned edges
    workflow.edges.forEach(edge => {
        const sourceExists = workflow.nodes.some(n => n.id === edge.source);
        const targetExists = workflow.nodes.some(n => n.id === edge.target);

        if (!sourceExists) {
            errors.push(`Edge references non-existent source node: ${edge.source}`);
        }
        if (!targetExists) {
            errors.push(`Edge references non-existent target node: ${edge.target}`);
        }
    });

    // Check for cycles (DAG validation) using DFS
    const adj = new Map<string, string[]>();
    workflow.nodes.forEach(n => adj.set(n.id, []));
    workflow.edges.forEach(e => {
        if (adj.has(e.source)) {
            adj.get(e.source)!.push(e.target);
        }
    });

    const visiting = new Set<string>();
    const visited = new Set<string>();

    const hasCycle = (nodeId: string): boolean => {
        if (visiting.has(nodeId)) return true;
        if (visited.has(nodeId)) return false;

        visiting.add(nodeId);
        const children = adj.get(nodeId) || [];
        for (const child of children) {
            if (hasCycle(child)) return true;
        }
        visiting.delete(nodeId);
        visited.add(nodeId);
        return false;
    };

    for (const node of workflow.nodes) {
        if (!visited.has(node.id)) {
            if (hasCycle(node.id)) {
                errors.push('Workflow contains an invalid cycle (feedback loop). Execution rejected.');
                break;
            }
        }
    }

    return {
        valid: errors.length === 0,
        errors,
    };
}

/**
 * Strip heavy base64 and output caches from a workflow before saving to the DB.
 * This prevents the massive base64 payloads from causing a Postgres 57014 timeout.
 */
export function stripHeavyNodeData(workflow: Workflow): Workflow {
    // Deep clone to avoid mutating the active execution state
    const cleanWorkflow = JSON.parse(JSON.stringify(workflow)) as Workflow;
    if (cleanWorkflow.nodes) {
        cleanWorkflow.nodes.forEach(node => {
            if (node.data) {
                delete (node.data as any).output;
                if ((node.data as any).outputMetadata) {
                    delete (node.data as any).outputMetadata.preview_urls;
                }
            }
        });
    }
    return cleanWorkflow;
}
