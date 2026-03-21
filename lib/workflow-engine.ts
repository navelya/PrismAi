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
    userId?: string,
    sessionId?: string
) {
    return executeWorkflowFromNode(
        workflow,
        executionId,
        workflow.nodes[0]?.id || '',
        cachedOutputs || {},
        onStatusUpdate,
        onNodeOutput,
        'all',
        userId,
        sessionId
    );
}

export async function executeWorkflowFromNode(
    workflow: Workflow,
    executionId: string,
    startNodeId: string,
    cachedOutputs: Record<string, any>,
    onStatusUpdate?: (nodeId: string, status: NodeStatus, currentWorkflow?: Workflow) => void,
    onNodeOutput?: (nodeId: string, output: any) => void,
    runMode: RunMode = 'chain',
    userId?: string,
    sessionId?: string
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
        // Ensure that any node in T has its ancestors (D) available for data flow.
        const executionSet = new Set<string>([...targetSet, ...dependencySet]);

        // 🛠️ DEBUG LOG: Verify the execution set before running
        console.log(`[WorkflowEngine] targetSet size: ${targetSet.size}, executionSet size: ${executionSet.size}`);

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
            userId,
            sessionId,
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

                    if (node.type === 'compositor' || node.type === 'ai_generator') {
                        const incomingEdges = workflow.edges.filter(e => e.target === node.id);
                        const handleInputs: Record<string, any> = {};
                        for (const edge of incomingEdges) {
                            const handleId = (edge as any).targetHandle || 'default';
                            const value = nodeOutputs.get(edge.source);
                            
                            if (handleInputs[handleId] === undefined) {
                                handleInputs[handleId] = value;
                            } else {
                                // If already has a value, convert to array and accumulate
                                if (!Array.isArray(handleInputs[handleId])) {
                                    handleInputs[handleId] = [handleInputs[handleId]];
                                }
                                if (Array.isArray(value)) {
                                    handleInputs[handleId].push(...value);
                                } else {
                                    handleInputs[handleId].push(value);
                                }
                            }
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
                        executor(node.data?.config, input, { ...context, nodeId: node.id }),
                        timeoutPromise
                    ]);

                    if (!result.success) throw new Error(result.error || 'Node execution failed');

                    return { 
                        nodeId: node.id, 
                        success: true, 
                        output: result.data,
                        status: result.status || 'success'
                    };
                } catch (error) {
                    return {
                        nodeId: node.id,
                        success: false,
                        status: 'error',
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
                    if (result.value.status === 'pending') {
                        // ASYNC BRANCH: Mark as pending and STOP downstream propagation for this node.
                        // The webhook handler will resume this branch later.
                        // CRITICAL: Persist 'pending' status to workflow object for DB save
                        if (node.data) {
                            (node.data as any).status = 'pending';
                        }
                        onStatusUpdate?.(node.id, 'pending', workflow);
                        continue;
                    }

                    completedNodes.add(node.id);
                    nodeOutputs.set(node.id, result.value.output);

                    if (node.data) {
                        (node.data as any).output = result.value.output;
                        // CRITICAL: Persist 'success' status to workflow object for DB save
                        (node.data as any).status = 'success';
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
                    
                    // CRITICAL: Persist 'error' status to workflow object for DB save
                    if (node.data) {
                        (node.data as any).status = 'error';
                        (node.data as any).error = errorMsg;
                    }
                    
                    onStatusUpdate?.(node.id, 'error');

                    const blockDownstream = (nodeId: string) => {
                        const childIds = children.get(nodeId) || [];
                        childIds.forEach(childId => {
                            if (!blockedNodes.has(childId) && executionSet.has(childId)) {
                                blockedNodes.add(childId);
                                // Also set error status on blocked downstream nodes
                                const childNode = workflow.nodes.find(n => n.id === childId);
                                if (childNode?.data) {
                                    (childNode.data as any).status = 'error';
                                    (childNode.data as any).error = `Blocked by upstream failure: ${node.type}`;
                                }
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

