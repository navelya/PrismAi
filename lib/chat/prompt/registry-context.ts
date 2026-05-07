import { sharedRegistry } from '@/lib/nodes/core/shared-registry';

export interface RegistryContextInput {
  models: Array<{
    id: number;
    display_name: string;
    node_type_id: string | null;
    providers?: { name: string } | null;
  }>;
  nodeTypes: Array<{
    id: string;
    display_name: string;
  }>;
}

/**
 * Formats the static node registry + live ai_models catalog as text for
 * the system prompt. Output is ~60-80 lines for the current registry.
 *
 * The static registry portion is stable across requests, so callers should
 * mark this slice as cacheable when constructing the Anthropic system
 * content blocks (see provider/anthropic.ts).
 */
export function formatRegistryContext(input: RegistryContextInput): string {
  const nodeDocs: string[] = [];

  for (const [type, def] of Object.entries(sharedRegistry)) {
    const inputs = def.handles?.inputs?.map((h: any) => {
      const t = Array.isArray(h.expectedType) ? h.expectedType.join('|') : h.expectedType || 'any';
      return `"${h.id}" (${t})`;
    }).join(', ') || 'none';

    const outputs = def.handles?.outputs?.map((h: any) => {
      return `"${h.id}" (${h.dataType || 'any'})`;
    }).join(', ') || 'none';

    let block = `\n--- Node Type: ${type} ---`;
    if (def.meta?.description) block += `\nDescription: ${def.meta.description}`;
    block += `\nInputs (use as targetHandle): ${inputs}`;
    block += `\nOutputs (use as sourceHandle): ${outputs}`;
    block += `\nConfig schema (populate strictly inside data.config):`;
    if (def.aiSchema && Object.keys(def.aiSchema).length > 0) {
      block += `\n${JSON.stringify(def.aiSchema, null, 2)}`;
    } else {
      block += `\n  {}`;
    }
    nodeDocs.push(block);
  }

  // Group ai_models by node_type_id so the model can pick the right
  // generator for each capability bucket.
  const modelLines: string[] = [];
  for (const nt of input.nodeTypes) {
    const modelsForType = input.models.filter(m => m.node_type_id === nt.id);
    if (modelsForType.length === 0) continue;
    modelLines.push(`  - "${nt.id}" (${nt.display_name}):`);
    for (const m of modelsForType) {
      const provider = m.providers?.name ? ` [${m.providers.name}]` : '';
      modelLines.push(`      • model_id ${m.id}: ${m.display_name}${provider}`);
    }
  }

  return `NODE REGISTRY (static):
${nodeDocs.join('\n')}

AI GENERATOR MODELS (live from ai_models):
${modelLines.length > 0 ? modelLines.join('\n') : '  (none active)'}`;
}
