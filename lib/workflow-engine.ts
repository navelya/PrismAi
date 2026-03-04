import { Workflow, WorkflowNode, ExecutionContext, NodeExecutionResult, NodeStatus } from './nodes/types';
import { getNodeExecutor } from './nodes/registry';
import { sharedRegistry } from './nodes/core/shared-registry';

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


export type RunMode = 'all' | 'solo' | 'chain' | 'ab_test';

export async function executeWorkflow(
    workflow: Workflow,
    executionId: string,
    onStatusUpdate?: (nodeId: string, status: NodeStatus, currentWorkflow?: Workflow) => void,
    onNodeOutput?: (nodeId: string, output: any) => void,
    cachedOutputs?: Record<string, any>,
    onNodePersist?: (
        nodeId: string,
        nodeType: string,
        config: any,
        inputUrls: string[],
        output: any,
        prevThumbnailPaths: string[],
        isLeafNode: boolean,
        forceOverwrite?: boolean
    ) => Promise<any>
) {
    return executeWorkflowFromNode(
        workflow,
        executionId,
        workflow.nodes[0]?.id || '',
        cachedOutputs || {},
        onStatusUpdate,
        onNodeOutput,
        onNodePersist,
        'all'
    );
}

export async function executeWorkflowFromNode(
    workflow: Workflow,
    executionId: string,
    startNodeId: string,
    cachedOutputs: Record<string, any>,
    onStatusUpdate?: (nodeId: string, status: NodeStatus, currentWorkflow?: Workflow) => void,
    onNodeOutput?: (nodeId: string, output: any) => void,
    onNodePersist?: (
        nodeId: string,
        nodeType: string,
        config: any,
        inputUrls: string[],
        output: any,
        prevThumbnailPaths: string[],
        isLeafNode: boolean,
        forceOverwrite?: boolean
    ) => Promise<{
        thumbnailPaths: string[];
        thumbnailUrls: string[];
        resultPaths: string[];
        resultUrls: string[];
        computedHash: string;
    } | null>,
    runMode: RunMode = 'chain'
): Promise<{
    success: boolean;
    result: any;
    error?: string;
}> {
    try {
        if (!workflow.nodes || workflow.nodes.length === 0) {
            throw new Error('Workflow has no nodes');
        }

        const { parents, children } = buildDependencyGraph(workflow.nodes, workflow.edges);

        // 1. Compute Target Set (T): Nodes that MUST run (ignoring cache)
        const targetSet = new Set<string>();

        if (runMode === 'all') {
            workflow.nodes.forEach(n => targetSet.add(n.id));
        } else if (runMode === 'solo') {
            targetSet.add(startNodeId);
        } else if (runMode === 'chain') {
            const queue = [startNodeId];
            while (queue.length > 0) {
                const nodeId = queue.shift()!;
                if (!targetSet.has(nodeId)) {
                    targetSet.add(nodeId);
                    (children.get(nodeId) || []).forEach(c => queue.push(c));
                }
            }
        } else if (runMode === 'ab_test') {
            // Find immediate Generative downstream nodes (jumping over utility)
            const queue = [...(children.get(startNodeId) || [])];
            const visited = new Set<string>();
            while (queue.length > 0) {
                const nodeId = queue.shift()!;
                if (visited.has(nodeId)) continue;
                visited.add(nodeId);

                const nodeDef = sharedRegistry[workflow.nodes.find(n => n.id === nodeId)?.type as keyof typeof sharedRegistry];
                if (nodeDef?.category === 'generative') {
                    targetSet.add(nodeId);
                } else {
                    (children.get(nodeId) || []).forEach(c => queue.push(c));
                }
            }
        }

        // 2. Compute Dependency Set (D): Ancestors of all nodes in T
        const dependencySet = new Set<string>();
        const depQueue = Array.from(targetSet);
        while (depQueue.length > 0) {
            const nodeId = depQueue.shift()!;
            const parentIds = parents.get(nodeId) || [];
            for (const pid of parentIds) {
                if (!dependencySet.has(pid)) {
                    dependencySet.add(pid);
                    depQueue.push(pid);
                }
            }
        }

        // 3. Compute Execution Set (E = T union D)
        const executionSet = new Set<string>([...targetSet, ...dependencySet]);

        // Validate strictly upstream connections FOR nodes in T
        for (const tid of targetSet) {
            const node = workflow.nodes.find(n => n.id === tid);
            if (!node) continue;
            const sharedDef = sharedRegistry[node.type as keyof typeof sharedRegistry];
            if (!sharedDef) continue;

            const expectedInputs = sharedDef.handles?.inputs || [];
            const incomingEdges = workflow.edges.filter(e => e.target === tid);

            for (const input of expectedInputs) {
                if (input.isMandatory) {
                    const hasEdge = incomingEdges.some(e => e.targetHandle === input.id || (!e.targetHandle && expectedInputs.length === 1));
                    if (!hasEdge) {
                        throw new Error(`Cannot execute: Missing mandatory upstream dependency [${input.label}] for node ${node.data?.label || node.type}`);
                    }
                }
            }
        }

        const context: ExecutionContext = {
            workflowId: workflow.id || 'temp',
            executionId,
            data: null,
        };

        const nodeOutputs = new Map<string, any>();
        const completedNodes = new Set<string>();
        const failedNodes = new Set<string>();
        const blockedNodes = new Set<string>();

        // Compute in-degree specifically mapped FOR THE EXECUTION SET
        const currentInDegree = new Map<string, number>();
        executionSet.forEach(id => currentInDegree.set(id, 0));

        workflow.edges.forEach(edge => {
            if (executionSet.has(edge.source) && executionSet.has(edge.target)) {
                currentInDegree.set(edge.target, (currentInDegree.get(edge.target) || 0) + 1);
            }
        });

        // Pre-seed dependencies that have cached outputs (and are NOT in target set)
        for (const nodeId of dependencySet) {
            if (!targetSet.has(nodeId)) {
                const node = workflow.nodes.find(n => n.id === nodeId);
                if (node) {
                    let cachedOutput = (node.data as any)?.output;

                    const sharedDef = sharedRegistry[node.type as keyof typeof sharedRegistry];
                    if (sharedDef && sharedDef.family === 'input') {
                        // Input nodes are static holders and don't "run", so their data.output might be stale.
                        // We instantly re-evaluate them here to capture live text/number edits.
                        const executor = getNodeExecutor(node.type);
                        if (executor) {
                            try {
                                const res = await executor(node.data?.config, null, context);
                                if (res.success) cachedOutput = res.data;
                            } catch (e) {
                                console.error(`Failed to evaluate input node ${node.id}`, e);
                            }
                        }
                    }

                    if (!cachedOutput && (node.data as any)?.outputMetadata?.thumbnailUrls?.length) {
                        cachedOutput = (node.data as any).outputMetadata.thumbnailUrls.map((url: string) => ({ url }));
                    }
                    if (!cachedOutput && cachedOutputs && cachedOutputs[nodeId]) {
                        cachedOutput = cachedOutputs[nodeId];
                    }

                    if (cachedOutput !== undefined && cachedOutput !== null) {
                        nodeOutputs.set(nodeId, cachedOutput);
                        completedNodes.add(nodeId);
                        onStatusUpdate?.(nodeId, 'success', workflow);

                        const childIds = children.get(nodeId) || [];
                        childIds.forEach(childId => {
                            if (executionSet.has(childId)) {
                                currentInDegree.set(childId, (currentInDegree.get(childId) || 0) - 1);
                            }
                        });
                    }
                }
            }
        }

        let readyNodes = workflow.nodes.filter(node =>
            executionSet.has(node.id) &&
            (currentInDegree.get(node.id) || 0) <= 0 &&
            !completedNodes.has(node.id)
        );

        for (const tid of targetSet) {
            onStatusUpdate?.(tid, 'pending');
        }

        let firstError: string | undefined;

        while (readyNodes.length > 0) {
            const waveExecutions = readyNodes.map(async (node) => {
                onStatusUpdate?.(node.id, 'running');

                try {
                    const executor = getNodeExecutor(node.type);
                    if (!executor) throw new Error(`No executor found for node type: ${node.type}`);

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

                    const timeoutPromise = new Promise<NodeExecutionResult>((_, reject) =>
                        setTimeout(() => reject(new Error(`Timeout: Node ${node.type} failed to complete in 60s`)), 60000)
                    );

                    const result: NodeExecutionResult = await Promise.race([
                        executor(node.data?.config, input, context),
                        timeoutPromise
                    ]);

                    if (!result.success) throw new Error(result.error || 'Node execution failed');

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

            for (let index = 0; index < waveResults.length; index++) {
                const result = waveResults[index];
                const node = readyNodes[index];

                if (result.status === 'fulfilled' && result.value.success) {
                    completedNodes.add(node.id);
                    nodeOutputs.set(node.id, result.value.output);

                    if (node.data) {
                        (node.data as any).output = result.value.output;

                        const outputStr = result.value.output;
                        if (Array.isArray(outputStr) && outputStr.length > 0 && outputStr[0].url) {
                            (node.data as any).outputMetadata = { preview_urls: outputStr.slice(0, 4).map((o: any) => o.url) };
                        } else if (outputStr && typeof outputStr === 'object' && outputStr.url) {
                            (node.data as any).outputMetadata = { preview_urls: [outputStr.url] };
                        }
                    }

                    if (onNodePersist) {
                        const previousMeta = (node.data as any)?.outputMetadata;
                        const prevThumbnailPaths: string[] = previousMeta?.thumbnailPaths ?? [];

                        const parentIds = parents.get(node.id) || [];
                        // We must hash the ACTUAL inputs passed to this node (including text prompts),
                        // otherwise changing a connected prompt won't bust the cache!
                        const inputsForHashing = parentIds.flatMap(pid => {
                            const val = nodeOutputs.get(pid);
                            // Convert to string representations or extract URLs/text
                            if (Array.isArray(val)) return val.map(v => typeof v === 'object' ? JSON.stringify(v) : String(v));
                            if (typeof val === 'object') return [JSON.stringify(val)];
                            return [String(val)];
                        });

                        const isLeaf = (children.get(node.id) || []).length === 0;

                        try {
                            // If the node is explicitly in the targetSet, the user intentionally ran it.
                            // We MUST force an overwrite to bypass the deterministic DB Cache, generating fresh variants.
                            const forceOverwrite = targetSet.has(node.id);

                            const persistMeta = await onNodePersist(
                                node.id,
                                node.type,
                                (node.data as any)?.config ?? {},
                                inputsForHashing,
                                result.value.output,
                                prevThumbnailPaths,
                                isLeaf,
                                forceOverwrite
                            );
                            if (persistMeta && node.data) {
                                (node.data as any).outputMetadata = {
                                    ...(node.data as any).outputMetadata,
                                    thumbnailPaths: persistMeta.thumbnailPaths,
                                    thumbnailUrls: persistMeta.thumbnailUrls,
                                    resultPaths: persistMeta.resultPaths,
                                    resultUrls: persistMeta.resultUrls,
                                    computedHash: persistMeta.computedHash,
                                };
                            }
                        } catch (persistErr) {
                            console.warn(`[Persist] Node ${node.id} persist failed:`, persistErr);
                        }
                    }

                    onStatusUpdate?.(node.id, 'success', workflow);
                    onNodeOutput?.(node.id, result.value.output);

                    const childIds = children.get(node.id) || [];
                    childIds.forEach(childId => {
                        if (!blockedNodes.has(childId) && executionSet.has(childId)) {
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
                            if (!blockedNodes.has(childId) && executionSet.has(childId)) {
                                blockedNodes.add(childId);
                                onStatusUpdate?.(childId, 'error');
                                blockDownstream(childId);
                            }
                        });
                    };
                    blockDownstream(node.id);
                }
            }

            readyNodes = nextReadyNodes;
        }

        const finalNodes = Array.from(targetSet).filter(nodeId => {
            const childIds = children.get(nodeId) || [];
            return childIds.length === 0 || childIds.every(c => !targetSet.has(c));
        });

        let finalResult;
        if (finalNodes.length === 1 && completedNodes.has(finalNodes[0])) {
            finalResult = nodeOutputs.get(finalNodes[0]);
        } else if (finalNodes.length > 1) {
            const outputs = finalNodes.map(nid => nodeOutputs.get(nid)).filter(Boolean);
            finalResult = outputs.every(o => Array.isArray(o)) ? outputs.flat() : outputs;
        } else {
            finalResult = null;
        }

        return {
            success: failedNodes.size === 0,
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
    workflow.nodes.forEach(node => {
        if (!sharedRegistry[node.type as keyof typeof sharedRegistry]) {
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
                const hasThumbnails = (node.data as any).outputMetadata?.thumbnailUrls?.length > 0;

                // Only strip `output` if it's been uploaded to Supabase Storage (i.e. we have thumbnails).
                // This preserves textual inputs/outputs (Prompt nodes, logic gates) permanently.
                if (hasThumbnails) {
                    delete (node.data as any).output;
                }

                if ((node.data as any).outputMetadata) {
                    // Remove raw base64 preview_urls — keep persisted storage references
                    delete (node.data as any).outputMetadata.preview_urls;
                    // thumbnailPaths, thumbnailUrls, resultPaths, resultUrls, computedHash are KEPT
                }
            }
        });
    }
    return cleanWorkflow;
}
