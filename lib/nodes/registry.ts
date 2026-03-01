import { NodeExecutor } from './types';
import { serverRegistry } from './core/server-registry';

/**
 * Node Registry
 * Maps node types to their executor functions dynamically from the new plugin architecture.
 */
export const nodeRegistry: Record<string, NodeExecutor> = Object.entries(serverRegistry).reduce((acc, [type, def]) => {
    acc[type] = def.executor;
    return acc;
}, {} as Record<string, NodeExecutor>);

/**
 * Get executor for a node type
 */
export function getNodeExecutor(nodeType: string): NodeExecutor | null {
    return nodeRegistry[nodeType] || null;
}
