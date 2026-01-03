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
 */
export async function executeWorkflow(
    workflow: Workflow,
    executionId: string,
    onStatusUpdate?: (nodeId: string, status: NodeStatus) => void
): Promise<{
    success: boolean;
    result: any;
    error?: string;
}> {
    try {
        if (!workflow.nodes || workflow.nodes.length === 0) {
            throw new Error('Workflow has no nodes');
        }

        console.log('🚀 Starting PARALLEL workflow execution');
        console.log(`  - Nodes: ${workflow.nodes.length}`);
        console.log(`  - Edges: ${workflow.edges.length}`);

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

        // Find initial ready nodes (no dependencies)
        let readyNodes = workflow.nodes.filter(node => currentInDegree.get(node.id) === 0);

        console.log(`📍 Initial ready nodes: ${readyNodes.map(n => n.type).join(', ')}`);

        let waveNumber = 1;

        // Execute in waves until no more progress
        while (readyNodes.length > 0) {

            // Execute all ready nodes in parallel
            const waveExecutions = readyNodes.map(async (node) => {
                // Mark as running
                onStatusUpdate?.(node.id, 'running');

                try {
                    const executor = getNodeExecutor(node.type);
                    if (!executor) {
                        throw new Error(`No executor found for node type: ${node.type}`);
                    }

                    // Gather inputs from all parents
                    const parentIds = parents.get(node.id) || [];
                    let input = null;

                    if (parentIds.length === 1) {
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

                    // Execute node
                    const result: NodeExecutionResult = await executor(node.data.config, input, context);

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

            waveResults.forEach((result, index) => {
                const node = readyNodes[index];

                if (result.status === 'fulfilled' && result.value.success) {
                    // Node succeeded
                    completedNodes.add(node.id);
                    nodeOutputs.set(node.id, result.value.output);
                    onStatusUpdate?.(node.id, 'success');

                    // Unlock children
                    const childIds = children.get(node.id) || [];
                    childIds.forEach(childId => {
                        if (!blockedNodes.has(childId)) {
                            const newDegree = (currentInDegree.get(childId) || 0) - 1;
                            currentInDegree.set(childId, newDegree);

                            // If child is now ready, add to next wave
                            if (newDegree === 0) {
                                const childNode = workflow.nodes.find(n => n.id === childId);
                                if (childNode) {
                                    nextReadyNodes.push(childNode);
                                }
                            }
                        }
                    });

                } else {
                    // Node failed
                    const errorMsg = result.status === 'fulfilled' ? result.value.error : 'Promise rejected';
                    failedNodes.add(node.id);
                    onStatusUpdate?.(node.id, 'error');

                    // Block all downstream nodes in this branch
                    const blockDownstream = (nodeId: string) => {
                        const childIds = children.get(nodeId) || [];
                        childIds.forEach(childId => {
                            if (!blockedNodes.has(childId)) {
                                blockedNodes.add(childId);
                                // Recursively block descendants
                                blockDownstream(childId);
                            }
                        });
                    };

                    blockDownstream(node.id);
                }
            });

            // Move to next wave
            readyNodes = nextReadyNodes;
            waveNumber++;

            // Safety check to prevent infinite loops
            if (waveNumber > 100) {
                throw new Error('Execution exceeded maximum wave limit (possible cycle)');
            }
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
            error: failedNodes.size > 0 ? `${failedNodes.size} node(s) failed` : undefined,
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
    const validTypes = ['scrape_images', 'remove_background', 'filter_sort', 'ai_generate_image'];
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

    return {
        valid: errors.length === 0,
        errors,
    };
}
