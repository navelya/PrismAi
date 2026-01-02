import { Workflow, WorkflowNode, ExecutionContext, NodeExecutionResult } from './nodes/types';
import { getNodeExecutor } from './nodes/registry';

/**
 * Topological sort for directed acyclic graph (DAG)
 * Returns nodes in execution order
 */
function topologicalSort(nodes: WorkflowNode[], edges: { source: string; target: string }[]): WorkflowNode[] {
    const adjacencyList = new Map<string, string[]>();
    const inDegree = new Map<string, number>();

    // Initialize
    nodes.forEach(node => {
        adjacencyList.set(node.id, []);
        inDegree.set(node.id, 0);
    });

    // Build graph
    edges.forEach(edge => {
        adjacencyList.get(edge.source)?.push(edge.target);
        inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
    });

    // Find nodes with no incoming edges
    const queue: WorkflowNode[] = [];
    nodes.forEach(node => {
        if (inDegree.get(node.id) === 0) {
            queue.push(node);
        }
    });

    const sorted: WorkflowNode[] = [];

    while (queue.length > 0) {
        const current = queue.shift()!;
        sorted.push(current);

        const neighbors = adjacencyList.get(current.id) || [];
        neighbors.forEach(neighborId => {
            const newDegree = (inDegree.get(neighborId) || 0) - 1;
            inDegree.set(neighborId, newDegree);

            if (newDegree === 0) {
                const neighborNode = nodes.find(n => n.id === neighborId);
                if (neighborNode) {
                    queue.push(neighborNode);
                }
            }
        });
    }

    // Check for cycles
    if (sorted.length !== nodes.length) {
        throw new Error('Workflow contains a cycle - cannot execute');
    }

    return sorted;
}

/**
 * Execute a complete workflow
 */
export async function executeWorkflow(
    workflow: Workflow,
    executionId: string
): Promise<{
    success: boolean;
    result: any;
    error?: string;
}> {
    try {
        if (!workflow.nodes || workflow.nodes.length === 0) {
            throw new Error('Workflow has no nodes');
        }

        // Sort nodes in execution order
        const sortedNodes = topologicalSort(workflow.nodes, workflow.edges);

        // Create execution context
        const context: ExecutionContext = {
            workflowId: workflow.id || 'temp',
            executionId,
            data: null,
        };

        // Storage for node outputs
        const nodeOutputs = new Map<string, any>();

        // Execute nodes in order
        for (const node of sortedNodes) {
            const executor = getNodeExecutor(node.type);

            if (!executor) {
                throw new Error(`No executor found for node type: ${node.type}`);
            }

            // Get input from predecessors (merge if multiple)
            const incomingEdges = workflow.edges.filter(e => e.target === node.id);
            let input = null;

            if (incomingEdges.length === 1) {
                // Single input - use it directly
                const sourceNodeId = incomingEdges[0].source;
                input = nodeOutputs.get(sourceNodeId);
            } else if (incomingEdges.length > 1) {
                // Multiple inputs - merge them intelligently
                const allInputs = incomingEdges
                    .map(edge => nodeOutputs.get(edge.source))
                    .filter(Boolean);

                if (allInputs.length > 0 && Array.isArray(allInputs[0])) {
                    // Arrays (e.g., images) - flatten into single array
                    input = allInputs.flat();
                    console.log(`🔀 Merged ${allInputs.length} parallel inputs: ${input.length} total items`);
                } else {
                    // Non-arrays - use first input as fallback
                    input = allInputs[0];
                }
            }
            // else: no inputs, node is a source node (input stays null)

            // Execute node
            const result: NodeExecutionResult = await executor(node.data.config, input, context);

            if (!result.success) {
                throw new Error(`Node ${node.id} (${node.type}) failed: ${result.error}`);
            }

            // Store output
            nodeOutputs.set(node.id, result.data);
            context.data = result.data;
        }

        // Return the output of the last node
        const finalNode = sortedNodes[sortedNodes.length - 1];
        const finalOutput = nodeOutputs.get(finalNode.id);

        return {
            success: true,
            result: finalOutput,
        };
    } catch (error) {
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
