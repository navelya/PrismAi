import { generateWithGemini } from './gemini-client';
import { Workflow, WorkflowNode, WorkflowEdge, NodeType, NodeConfig } from '../nodes/types';
import { createNodeFromType } from '../editor/node-factory';

export interface WorkflowModification {
    type: 'add_node' | 'remove_node' | 'update_config' | 'new_workflow';
    nodeType?: NodeType;
    nodeId?: string;
    config?: Partial<NodeConfig>;
    nodeName?: string;  // For finding nodes by label
}

export interface ModificationResult {
    isModification: boolean;
    modification?: WorkflowModification;
    updatedWorkflow?: Workflow;
    shouldExecute?: boolean;
}

/**
 * Detects if a message is a workflow modification command
 */
export function isModificationCommand(message: string): boolean {
    const lowerMessage = message.toLowerCase();

    const modificationKeywords = [
        'add', 'remove', 'delete', 'change', 'update', 'modify',
        'set', 'adjust', 'increase', 'decrease', 'filter', 'sort'
    ];

    const nodeKeywords = [
        'node', 'cube', 'scrape', 'background', 'filter', 'sort', 'generate'
    ];

    const hasModKeyword = modificationKeywords.some(kw => lowerMessage.includes(kw));
    const hasNodeKeyword = nodeKeywords.some(kw => lowerMessage.includes(kw));

    // If it has modification keywords AND node keywords, likely a modification
    // OR if it's very short and has "add" or "change" (e.g., "add filter")
    return (hasModKeyword && hasNodeKeyword) ||
        (lowerMessage.split(' ').length <= 5 && hasModKeyword);
}

/**
 * Parse a modification command and apply it to the workflow
 */
export async function parseModificationCommand(
    command: string,
    currentWorkflow: Workflow
): Promise<ModificationResult> {
    const lowerCommand = command.toLowerCase();

    // Check if it's actually a modification
    if (!isModificationCommand(command)) {
        return {
            isModification: false,
        };
    }

    try {
        // Try to parse with Gemini first
        const geminiResult = await parseWithGemini(command, currentWorkflow);
        if (geminiResult) {
            return geminiResult;
        }
    } catch (error) {
        // Gemini parsing failed

    }

    // Fallback to rule-based parsing
    return parseFallback(lowerCommand, currentWorkflow);
}

/**
 * Parse modification using Gemini AI
 */
async function parseWithGemini(
    command: string,
    currentWorkflow: Workflow
): Promise<ModificationResult | null> {
    const prompt = `
You are a workflow modification parser. Given a user command and the current workflow, determine what modification they want.

Current workflow has these nodes:
${currentWorkflow.nodes.map(n => `- ${n.id}: ${n.data.label} (${n.type})`).join('\n')}

User command: "${command}"

Return ONLY valid JSON with this structure:
{
  "isModification": boolean,
  "type": "add_node" | "remove_node" | "update_config" | "new_workflow",
  "nodeType": "scrape_images" | "remove_background" | "filter_sort" | "ai_generate_image" (if adding),
  "nodeId": "id of node to modify/remove" (if updating/removing),
  "config": {partial config object} (if updating config),
  "shouldExecute": true/false (whether to auto-run after modification)
}

Examples:
- "add a filter node" → {"isModification": true, "type": "add_node", "nodeType": "filter_sort", "shouldExecute": true}
- "change limit to 20" → {"isModification": true, "type": "update_config", "nodeId": "uuid-node-id", "config": {"limit": 20}, "shouldExecute": true}
- "remove background node" → {"isModification": true, "type": "remove_node", "nodeId": "uuid-node-id", "shouldExecute": true}
`;

    const response = await generateWithGemini(prompt);

    try {
        const parsed = JSON.parse(response);

        if (!parsed.isModification) {
            return { isModification: false };
        }

        const updatedWorkflow = applyModification(parsed, currentWorkflow);

        return {
            isModification: true,
            modification: parsed,
            updatedWorkflow,
            shouldExecute: parsed.shouldExecute ?? true,
        };
    } catch (error) {
        console.error('Failed to parse Gemini response:', error);
        return null;
    }
}

/**
 * Fallback rule-based parser
 */
function parseFallback(
    lowerCommand: string,
    currentWorkflow: Workflow
): ModificationResult {

    // ADD NODE
    if (lowerCommand.includes('add')) {
        let nodeType: NodeType | undefined;

        if (lowerCommand.includes('filter') || lowerCommand.includes('sort')) {
            nodeType = 'filter_sort';
        } else if (lowerCommand.includes('background') || lowerCommand.includes('bg')) {
            nodeType = 'remove_background';
        } else if (lowerCommand.includes('scrape') || lowerCommand.includes('search') || lowerCommand.includes('find')) {
            nodeType = 'scrape_images';
        } else if (lowerCommand.includes('generate') || lowerCommand.includes('ai') || lowerCommand.includes('create')) {
            nodeType = 'ai_generate_image';
        }

        if (nodeType) {
            const updatedWorkflow = addNodeToWorkflow(currentWorkflow, nodeType);
            return {
                isModification: true,
                modification: { type: 'add_node', nodeType },
                updatedWorkflow,
                shouldExecute: true,
            };
        }
    }

    // REMOVE NODE
    if (lowerCommand.includes('remove') || lowerCommand.includes('delete')) {
        let nodeId: string | undefined;

        // Find node to remove based on type mention
        if (lowerCommand.includes('background') || lowerCommand.includes('bg')) {
            nodeId = currentWorkflow.nodes.find(n => n.type === 'remove_background')?.id;
        } else if (lowerCommand.includes('filter') || lowerCommand.includes('sort')) {
            nodeId = currentWorkflow.nodes.find(n => n.type === 'filter_sort')?.id;
        } else if (lowerCommand.includes('scrape') || lowerCommand.includes('search')) {
            nodeId = currentWorkflow.nodes.find(n => n.type === 'scrape_images')?.id;
        }

        if (nodeId) {
            const updatedWorkflow = removeNodeFromWorkflow(currentWorkflow, nodeId);
            return {
                isModification: true,
                modification: { type: 'remove_node', nodeId },
                updatedWorkflow,
                shouldExecute: true,
            };
        }
    }

    // UPDATE CONFIG
    if (lowerCommand.includes('change') || lowerCommand.includes('set') || lowerCommand.includes('update')) {
        // Try to extract number for limit changes
        const numberMatch = lowerCommand.match(/\d+/);
        if (numberMatch && (lowerCommand.includes('limit') || lowerCommand.includes('images'))) {
            const newLimit = parseInt(numberMatch[0]);
            const scrapeNode = currentWorkflow.nodes.find(n => n.type === 'scrape_images');

            if (scrapeNode) {
                const updatedWorkflow = updateNodeConfig(currentWorkflow, scrapeNode.id, { limit: newLimit });
                return {
                    isModification: true,
                    modification: { type: 'update_config', nodeId: scrapeNode.id, config: { limit: newLimit } },
                    updatedWorkflow,
                    shouldExecute: true,
                };
            }
        }
    }

    // Not a recognized modification
    return { isModification: false };
}

/**
 * Apply a modification to a workflow
 */
function applyModification(
    modification: WorkflowModification,
    workflow: Workflow
): Workflow {
    switch (modification.type) {
        case 'add_node':
            if (modification.nodeType) {
                return addNodeToWorkflow(workflow, modification.nodeType);
            }
            break;
        case 'remove_node':
            if (modification.nodeId) {
                return removeNodeFromWorkflow(workflow, modification.nodeId);
            }
            break;
        case 'update_config':
            if (modification.nodeId && modification.config) {
                return updateNodeConfig(workflow, modification.nodeId, modification.config);
            }
            break;
    }

    return workflow;
}

/**
 * Add a new node to the workflow
 */
function addNodeToWorkflow(workflow: Workflow, nodeType: NodeType): Workflow {
    const xPosition = workflow.nodes.length * 200;
    const newNode = createNodeFromType(nodeType, { x: xPosition, y: 100 });
    const newNodeId = newNode.id;

    // If there are existing nodes, connect the last one to this new one
    const newEdges = [...workflow.edges];
    if (workflow.nodes.length > 0) {
        const lastNode = workflow.nodes[workflow.nodes.length - 1];
        newEdges.push({
            id: `edge_${lastNode.id}_${newNodeId}`,
            source: lastNode.id,
            target: newNodeId,
        });
    }

    return {
        ...workflow,
        nodes: [...workflow.nodes, newNode],
        edges: newEdges,
    };
}

/**
 * Remove a node from the workflow
 */
function removeNodeFromWorkflow(workflow: Workflow, nodeId: string): Workflow {
    const nodeIndex = workflow.nodes.findIndex(n => n.id === nodeId);
    if (nodeIndex === -1) return workflow;

    const newNodes = workflow.nodes.filter(n => n.id !== nodeId);
    let newEdges = workflow.edges.filter(e => e.source !== nodeId && e.target !== nodeId);

    // Reconnect edges if node was in the middle
    const incomingEdge = workflow.edges.find(e => e.target === nodeId);
    const outgoingEdge = workflow.edges.find(e => e.source === nodeId);

    if (incomingEdge && outgoingEdge) {
        newEdges.push({
            id: `edge_${incomingEdge.source}_${outgoingEdge.target}`,
            source: incomingEdge.source,
            target: outgoingEdge.target,
        });
    }

    return {
        ...workflow,
        nodes: newNodes,
        edges: newEdges,
    };
}

/**
 * Update a node's configuration
 */
function updateNodeConfig(
    workflow: Workflow,
    nodeId: string,
    configUpdate: Partial<NodeConfig>
): Workflow {
    const newNodes = workflow.nodes.map(node => {
        if (node.id === nodeId) {
            return {
                ...node,
                data: {
                    ...node.data,
                    config: {
                        ...node.data.config,
                        ...configUpdate,
                    },
                },
            };
        }
        return node;
    });

    return {
        ...workflow,
        nodes: newNodes,
    };
}
