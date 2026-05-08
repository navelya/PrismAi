import { sharedRegistry } from '@/lib/nodes/core/shared-registry';

export interface RegistryContextInput {
  models: Array<{
    id: number;
    display_name: string;
    node_type_id: string | null;
    /**
     * JSONB column from ai_models. The keys at the top of `properties`
     * are the dynamic input handle ids that the rendered ai_generator
     * node will expose for this specific model. Edges targeting an
     * ai_generator MUST use one of these keys as their targetHandle.
     */
    inputs_schema?: any;
    providers?: { name: string } | null;
  }>;
  nodeTypes: Array<{
    id: string;
    display_name: string;
  }>;
}

/**
 * Extract handle ids from an ai_models.inputs_schema JSONB. The schema
 * shape is `{ handles: [{ api_mapping_key, ... }, ...] }` (see
 * components/canvas/AIGeneratorNode.tsx, which uses the same path to
 * render React Flow handles). The `api_mapping_key` of each entry is
 * the React Flow handle id that edges must target. Returns [] if the
 * schema is missing or malformed.
 */
function extractInputHandleIds(schema: any): string[] {
  if (!schema || typeof schema !== 'object') return [];
  const handles = schema.handles;
  if (!Array.isArray(handles)) return [];
  const ids: string[] = [];
  for (const h of handles) {
    const key = h?.api_mapping_key;
    if (typeof key === 'string' && key.length > 0) ids.push(key);
  }
  return ids;
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

    // --- REQUIRED CONFIG block (plain English, unmissable) ---
    if (type === 'ai_generator') {
      block += `\n\nREQUIRED CONFIG for ai_generator:`;
      block += `\n- \`model_id\` (number): REQUIRED. Pick from "AI GENERATOR MODELS" list above. Set both at the top level (model_id field) AND inside data.config.model_id.`;
      block += `\n- \`node_type_id\` (string): REQUIRED. Must match the type bucket the chosen model belongs to.`;
      block += `\n- Without model_id, this node cannot run.`;
    } else if (type === 'compositor') {
      // Override the misleading aiSchema docs. The canvas reads edges that
      // target the static handle "layers"; sourceHandleId in config.layers
      // stores the runtime edge id (not a handle name). The compositor has
      // an orphan-edge fallback that auto-creates layers from incoming
      // edges, so the model should leave config.layers empty.
      block += `\n\nREQUIRED CONFIG for compositor:`;
      block += `\n- All edges connecting INTO a compositor MUST use targetHandle: "layers" (the only valid handle on this node).`;
      block += `\n- Do NOT use targetHandle values like "layer_0", "layer_1", etc. — they don't exist and will be rejected by the canvas.`;
      block += `\n- Leave \`config.layers\` as an empty array \`[]\`. The canvas auto-creates layers from incoming edges.`;
      block += `\n- The aiSchema below for this node is misleading — ignore the layer/sourceHandleId guidance there. Trust THIS section instead.`;
    } else if (def.aiSchema && Object.keys(def.aiSchema).length > 0) {
      const topRequired: string[] = Array.isArray(def.aiSchema.required) ? def.aiSchema.required : [];
      const properties: Record<string, any> = def.aiSchema.properties || {};

      // Collect nested required fields from array property items
      const nestedRequiredByProp: Record<string, string[]> = {};
      for (const [propKey, propDef] of Object.entries(properties)) {
        if (
          propDef &&
          typeof propDef === 'object' &&
          (propDef as any).type === 'array' &&
          (propDef as any).items &&
          Array.isArray((propDef as any).items.required)
        ) {
          nestedRequiredByProp[propKey] = (propDef as any).items.required as string[];
        }
      }

      const hasRequired = topRequired.length > 0 || Object.keys(nestedRequiredByProp).length > 0;
      if (hasRequired) {
        block += `\n\nREQUIRED CONFIG for ${type}:`;
        for (const field of topRequired) {
          const propDef = properties[field] as any;
          const fieldType = propDef?.type || 'value';
          const nestedRequired = nestedRequiredByProp[field];
          if (fieldType === 'array' && nestedRequired) {
            block += `\n- \`${field}\`: array. ONE ENTRY PER INBOUND EDGE. Each item needs:`;
            for (const nestedField of nestedRequired) {
              const itemProps = propDef?.items?.properties?.[nestedField] as any;
              const nestedType = itemProps?.type || 'string';
              const nestedDesc = itemProps?.description ? ` — ${itemProps.description}` : '';
              if (nestedField === 'sourceHandleId') {
                block += `\n    • ${nestedField} (${nestedType}): MUST match the targetHandle set on the edge connecting to this node (e.g., "layer_0", "layer_1")`;
              } else {
                block += `\n    • ${nestedField} (${nestedType})${nestedDesc}`;
              }
            }
            block += `\n- Without \`${field}\` populated, edges to this node will fail.`;
          } else {
            const desc = propDef?.description ? ` — ${propDef.description}` : '';
            block += `\n- \`${field}\` (${fieldType}): REQUIRED${desc}`;
          }
        }
        // Surface nested required for fields that aren't in top-level required but have nested required
        for (const [propKey, nestedRequired] of Object.entries(nestedRequiredByProp)) {
          if (topRequired.includes(propKey)) continue; // already handled above
          const propDef = properties[propKey] as any;
          block += `\n- \`${propKey}\`: array. Each item needs:`;
          for (const nestedField of nestedRequired) {
            const itemProps = propDef?.items?.properties?.[nestedField] as any;
            const nestedType = itemProps?.type || 'string';
            const nestedDesc = itemProps?.description ? ` — ${itemProps.description}` : '';
            if (nestedField === 'sourceHandleId') {
              block += `\n    • ${nestedField} (${nestedType}): MUST match the targetHandle set on the edge connecting to this node`;
            } else {
              block += `\n    • ${nestedField} (${nestedType})${nestedDesc}`;
            }
          }
        }
      }
    }

    nodeDocs.push(block);
  }

  // Group ai_models by node_type_id so the model can pick the right
  // generator for each capability bucket. For each model, surface its
  // dynamic input handle names from inputs_schema.properties — these
  // are the targetHandle values valid for edges into an ai_generator
  // configured with that model_id.
  const modelLines: string[] = [];
  for (const nt of input.nodeTypes) {
    const modelsForType = input.models.filter(m => m.node_type_id === nt.id);
    if (modelsForType.length === 0) continue;
    modelLines.push(`  - "${nt.id}" (${nt.display_name}):`);
    for (const m of modelsForType) {
      const provider = m.providers?.name ? ` [${m.providers.name}]` : '';
      const handleIds = extractInputHandleIds(m.inputs_schema);
      const handlesPart = handleIds.length > 0
        ? `; input handles: ${handleIds.map(h => `"${h}"`).join(', ')}`
        : '';
      modelLines.push(`      • model_id ${m.id}: ${m.display_name}${provider}${handlesPart}`);
    }
  }

  return `NODE REGISTRY (static):
${nodeDocs.join('\n')}

AI GENERATOR MODELS (live from ai_models):
${modelLines.length > 0 ? modelLines.join('\n') : '  (none active)'}`;
}
