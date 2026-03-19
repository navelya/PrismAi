/**
 * STAGE 3: Node-Actor Pattern Implementation
 * 
 * This module implements the "Check Forward" pattern where each node acts independently.
 * When a node completes, it triggers its children if their dependencies are satisfied.
 * This replaces the centralized "wave" scheduler with a decentralized reactive model.
 */

import { Workflow, WorkflowNode, ExecutionContext, NodeExecutionResult, NodeStatus } from '../nodes/types';
import { getNodeExecutor } from '../nodes/registry';
import { sharedRegistry } from '../nodes/core/shared-registry';
import { updateNodeState } from '../db/node-state';
import { SupabaseClient } from '@supabase/supabase-js';

export interface NodeActorContext {
    workflow: Workflow;
    executionId: string;
    supabase: SupabaseClient;
    sessionId: string;
    userId: string;
    nodeOutputs: Map<string, any>; // Shared execution state
    completedNodes: Set<string>;
    failedNodes: Set<string>;
    blockedNodes: Set<string>;
    executionStartTime?: number; // Track when execution started
    maxExecutionTime?: number; // Maximum execution time in ms
    nodeTimeout?: number; // Timeout per node in ms
    onStatusUpdate?: (nodeId: string, status: NodeStatus, currentWorkflow?: Workflow) => void;
    onNodeOutput?: (nodeId: string, output: any) => void;
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
    } | null>;
}

/**
 * Build dependency graph helper (same as workflow-engine)
 */
function buildDependencyGraph(nodes: WorkflowNode[], edges: { source: string; target: string }[]) {
    const parents = new Map<string, string[]>();
    const children = new Map<string, string[]>();

    nodes.forEach(node => {
        parents.set(node.id, []);
        children.set(node.id, []);
    });

    edges.forEach(edge => {
        children.get(edge.source)?.push(edge.target);
        parents.get(edge.target)?.push(edge.source);
    });

    return { parents, children };
}

/**
 * Execute a single node atomically
 * 
 * @param nodeId - ID of the node to execute
 * @param ctx - Actor context with shared state
 * @param forceOverwrite - Force cache bypass (for target nodes)
 * @returns { success: boolean, status: 'success' | 'error' | 'pending' }
 */
export async function executeNode(
    nodeId: string,
    ctx: NodeActorContext,
    forceOverwrite: boolean = false
): Promise<{ success: boolean; status: NodeStatus; error?: string }> {
    const { workflow, executionId, supabase, sessionId, userId, nodeOutputs, completedNodes, failedNodes } = ctx;
    
    const node = workflow.nodes.find(n => n.id === nodeId);
    if (!node) {
        console.error(`[executeNode] Node ${nodeId} not found in workflow`);
        return { success: false, status: 'error', error: 'Node not found' };
    }

    // STAGE 4: Check if we're approaching the serverless function timeout
    if (ctx.executionStartTime && ctx.maxExecutionTime) {
        const elapsed = Date.now() - ctx.executionStartTime;
        const remaining = ctx.maxExecutionTime - elapsed;
        
        // Leave 10 seconds buffer for cleanup
        if (remaining < 10000) {
            const errorMsg = 'Execution time limit approaching, stopping to prevent timeout';
            console.warn(`[executeNode] ${errorMsg} (${remaining}ms remaining)`);
            
            failedNodes.add(nodeId);
            if (node.data) {
                (node.data as any).error = errorMsg;
            }
            ctx.onStatusUpdate?.(nodeId, 'error', workflow);
            
            return { success: false, status: 'error', error: errorMsg };
        }
    }

    try {
        // Update status to 'running'
        ctx.onStatusUpdate?.(nodeId, 'running');

        // Get node executor
        const executor = getNodeExecutor(node.type);
        if (!executor) {
            throw new Error(`No executor found for node type: ${node.type}`);
        }

        // Build dependency graph
        const { parents, children } = buildDependencyGraph(workflow.nodes, workflow.edges);
        const parentIds = parents.get(nodeId) || [];

        // Prepare input based on node type
        let input = null;
        const executionContext: ExecutionContext = { 
            workflowId: workflow.id || 'temp',
            executionId, 
            userId, 
            sessionId, 
            nodeId,
            data: null // Required by type, but currently only used for internal node communication
        };

        if (node.type === 'compositor' || node.type === 'ai_generator') {
            // Multi-handle input nodes
            const incomingEdges = workflow.edges.filter(e => e.target === nodeId);
            const handleInputs: Record<string, any> = {};
            
            for (const edge of incomingEdges) {
                const handleId = (edge as any).targetHandle || 'default';
                const value = nodeOutputs.get(edge.source);
                
                if (handleInputs[handleId] === undefined) {
                    handleInputs[handleId] = value;
                } else {
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

        // STAGE 4: Use configurable timeout per node (default 60s)
        const nodeTimeout = ctx.nodeTimeout || 60000;
        const timeoutPromise = new Promise<NodeExecutionResult>((_, reject) =>
            setTimeout(() => reject(new Error(`Timeout: Node ${node.type} failed to complete in ${nodeTimeout / 1000}s`)), nodeTimeout)
        );

        const result: NodeExecutionResult = await Promise.race([
            executor(node.data?.config, input, executionContext),
            timeoutPromise
        ]);

        if (!result.success) {
            throw new Error(result.error || 'Node execution failed');
        }

        // Check if node is async (pending status)
        if (result.status === 'pending') {
            // CRITICAL: Persist 'pending' status to workflow object for DB save
            if (node.data) {
                (node.data as any).status = 'pending';
            }
            ctx.onStatusUpdate?.(nodeId, 'pending', workflow);
            return { success: true, status: 'pending' };
        }

        // Mark node as completed
        completedNodes.add(nodeId);
        nodeOutputs.set(nodeId, result.data);

        // Update node data in workflow object
        if (node.data) {
            (node.data as any).output = result.data;
            // CRITICAL: Persist 'success' status to workflow object for DB save
            (node.data as any).status = 'success';

            // Set preview URLs for output metadata
            const outputStr = result.data;
            if (Array.isArray(outputStr) && outputStr.length > 0 && outputStr[0]?.url) {
                (node.data as any).outputMetadata = { preview_urls: outputStr.slice(0, 4).map((o: any) => o.url) };
            } else if (outputStr && typeof outputStr === 'object' && outputStr.url) {
                (node.data as any).outputMetadata = { preview_urls: [outputStr.url] };
            }
        }

        // Persist node output if callback provided
        if (ctx.onNodePersist) {
            const previousMeta = (node.data as any)?.outputMetadata;
            const prevThumbnailPaths: string[] = previousMeta?.thumbnailPaths ?? [];

            const inputsForHashing = parentIds.flatMap(pid => {
                const val = nodeOutputs.get(pid);
                if (Array.isArray(val)) return val.map(v => typeof v === 'object' ? JSON.stringify(v) : String(v));
                if (typeof val === 'object') return [JSON.stringify(val)];
                return [String(val)];
            });

            const isLeaf = (children.get(nodeId) || []).length === 0;

            try {
                const persistMeta = await ctx.onNodePersist(
                    nodeId,
                    node.type,
                    (node.data as any)?.config ?? {},
                    inputsForHashing,
                    result.data,
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
                console.warn(`[Persist] Node ${nodeId} persist failed:`, persistErr);
            }
        }

        // Update status to 'success'
        ctx.onStatusUpdate?.(nodeId, 'success', workflow);
        ctx.onNodeOutput?.(nodeId, result.data);

        return { success: true, status: 'success' };

    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[executeNode] Node ${nodeId} failed:`, errorMsg);

        failedNodes.add(nodeId);
        
        // CRITICAL: Persist 'error' status to workflow object for DB save
        if (node.data) {
            (node.data as any).status = 'error';
            (node.data as any).error = errorMsg;
        }

        ctx.onStatusUpdate?.(nodeId, 'error', workflow);

        return { success: false, status: 'error', error: errorMsg };
    }
}

/**
 * Check if a node's dependencies are satisfied and trigger execution if ready
 * 
 * @param nodeId - ID of the node to check
 * @param ctx - Actor context
 * @param forceOverwrite - Force cache bypass
 */
async function checkAndExecuteIfReady(
    nodeId: string,
    ctx: NodeActorContext,
    forceOverwrite: boolean = false
): Promise<void> {
    const { workflow, completedNodes, failedNodes, blockedNodes } = ctx;
    const { parents } = buildDependencyGraph(workflow.nodes, workflow.edges);

    // Skip if already completed, failed, or blocked
    if (completedNodes.has(nodeId) || failedNodes.has(nodeId) || blockedNodes.has(nodeId)) {
        return;
    }

    // Check if all parent dependencies are completed
    const parentIds = parents.get(nodeId) || [];
    const allParentsCompleted = parentIds.every(pid => completedNodes.has(pid));

    if (allParentsCompleted) {
        // All dependencies satisfied - execute this node
        const result = await executeNode(nodeId, ctx, forceOverwrite);
        
        if (result.success && result.status === 'success') {
            // Node completed successfully - check forward to children
            await checkForward(nodeId, ctx);
        } else if (!result.success) {
            // Node failed - propagate blocker to children
            await propagateBlocker(nodeId, ctx);
        }
        // If status is 'pending', we wait for webhook to resume
    }
}

/**
 * STAGE 3: "Check Forward" Pattern
 * 
 * When a node completes, check all its children and trigger execution for any that are ready
 * 
 * @param nodeId - ID of the node that just completed
 * @param ctx - Actor context
 */
export async function checkForward(nodeId: string, ctx: NodeActorContext): Promise<void> {
    const { workflow } = ctx;
    const { children } = buildDependencyGraph(workflow.nodes, workflow.edges);

    const childIds = children.get(nodeId) || [];

    // Check each child node
    await Promise.all(
        childIds.map(childId => checkAndExecuteIfReady(childId, ctx, false))
    );
}

/**
 * STAGE 4: Propagate blocker status to all downstream nodes
 * 
 * @param nodeId - ID of the failed node
 * @param ctx - Actor context
 */
export async function propagateBlocker(nodeId: string, ctx: NodeActorContext): Promise<void> {
    const { workflow, blockedNodes } = ctx;
    const { children } = buildDependencyGraph(workflow.nodes, workflow.edges);

    const childIds = children.get(nodeId) || [];

    for (const childId of childIds) {
        if (!blockedNodes.has(childId)) {
            blockedNodes.add(childId);
            
            // CRITICAL: Persist 'error' status to blocked nodes
            const childNode = workflow.nodes.find(n => n.id === childId);
            if (childNode?.data) {
                (childNode.data as any).status = 'error';
                (childNode.data as any).error = `Blocked by upstream failure`;
            }
            
            ctx.onStatusUpdate?.(childId, 'error', workflow);
            
            // Recursively block downstream
            await propagateBlocker(childId, ctx);
        }
    }
}

/**
 * Initialize node actor context from workflow
 */
export function createNodeActorContext(
    workflow: Workflow,
    executionId: string,
    supabase: SupabaseClient,
    sessionId: string,
    userId: string,
    onStatusUpdate?: (nodeId: string, status: NodeStatus, currentWorkflow?: Workflow) => void,
    onNodeOutput?: (nodeId: string, output: any) => void,
    onNodePersist?: any,
    options?: {
        maxExecutionTime?: number; // Max execution time in ms (default: 110s for 120s serverless limit)
        nodeTimeout?: number; // Timeout per node in ms (default: 60s)
    }
): NodeActorContext {
    return {
        workflow,
        executionId,
        supabase,
        sessionId,
        userId,
        nodeOutputs: new Map(),
        completedNodes: new Set(),
        failedNodes: new Set(),
        blockedNodes: new Set(),
        executionStartTime: Date.now(),
        maxExecutionTime: options?.maxExecutionTime || 110000, // 110s (10s buffer before 120s limit)
        nodeTimeout: options?.nodeTimeout || 60000, // 60s default
        onStatusUpdate,
        onNodeOutput,
        onNodePersist
    };
}

/**
 * Start execution from entry nodes (nodes with no parents)
 * 
 * @param ctx - Actor context
 * @param targetNodeIds - Optional array of specific nodes to execute (for chain/solo modes)
 */
export async function startExecution(
    ctx: NodeActorContext,
    targetNodeIds?: string[]
): Promise<{ success: boolean; error?: string }> {
    const { workflow } = ctx;
    const { parents } = buildDependencyGraph(workflow.nodes, workflow.edges);

    try {
        // Find entry nodes (no parents)
        const entryNodes = workflow.nodes.filter(node => {
            const parentIds = parents.get(node.id) || [];
            return parentIds.length === 0;
        });

        if (entryNodes.length === 0) {
            return { success: false, error: 'No entry nodes found in workflow' };
        }

        // If target nodes specified, only execute those entry nodes that lead to targets
        const nodesToStart = targetNodeIds 
            ? entryNodes.filter(node => targetNodeIds.includes(node.id))
            : entryNodes;

        // Execute all entry nodes in parallel
        await Promise.all(
            nodesToStart.map(node => executeNode(node.id, ctx, targetNodeIds?.includes(node.id) || false))
        );

        // After initial wave, check forward for each completed node
        for (const node of nodesToStart) {
            if (ctx.completedNodes.has(node.id)) {
                await checkForward(node.id, ctx);
            }
        }

        return { success: true };

    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error('[startExecution] Failed:', errorMsg);
        return { success: false, error: errorMsg };
    }
}
