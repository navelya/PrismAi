import { sharedRegistry } from '@/lib/nodes/core/shared-registry';

// Helper to format the schema cleanly
function formatSchemaForAI(schema: any, prefix = ''): string {
    if (!schema || !schema.properties) return '  - No configurable settings\n';
    let lines = '';
    const requiredFields = schema.required || [];
    for (const [key, prop] of (Object.entries(schema.properties) as [string, any][])) {
        const isRequired = requiredFields.includes(key);
        const reqStr = isRequired ? ' (REQUIRED)' : ' (optional)';
        const fullKey = prefix ? `${prefix}.${key}` : key;
        lines += `  - ${fullKey} (${prop.type})${reqStr}\n`;
    }
    return lines;
}

// ONLY returns the list of available nodes and their inputs/outputs
export function getAvailableNodesContext() {
    let nodesStr = 'AVAILABLE NODES FOR WORKFLOW:\n\n';

    for (const [type, def] of Object.entries(sharedRegistry)) {
        const inputs = def.handles.inputs.map((h: any) => `"${h.id}"`).join(', ') || 'none';
        const outputs = def.handles.outputs.map((h: any) => `"${h.id}"`).join(', ') || 'none';

        nodesStr += `Node Type: ${type}\n`;
        nodesStr += `Expected Inputs: ${inputs}\n`;
        nodesStr += `Outputs: ${outputs}\n`;
        nodesStr += `Configurable Properties (placed in data.config):\n`;
        nodesStr += formatSchemaForAI(def.aiSchema);
        nodesStr += `\n---\n`;
    }

    return nodesStr;
}