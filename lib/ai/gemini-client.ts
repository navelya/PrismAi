import { GoogleGenerativeAI, SchemaType, ResponseSchema } from '@google/generative-ai';
import { sharedRegistry } from '../nodes/core/shared-registry';

const apiKey = process.env.GEMINI_API_KEY!;

if (!apiKey) {
  console.warn('GEMINI_API_KEY not set - AI features will not work');
}

const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

/**
 * Recursively format a JSON Schema into a clean, flat list of LLM instructions
 */
function formatSchemaForAI(schema: any, prefix = ''): string {
  if (!schema || !schema.properties) return '  - No configurable settings\n';

  let lines = '';
  const requiredFields = schema.required || [];

  for (const [key, prop] of (Object.entries(schema.properties) as [string, any][])) {
    const isRequired = requiredFields.includes(key);
    const reqStr = isRequired ? ' (REQUIRED)' : ' (optional)';
    const fullKey = prefix ? `${prefix}.${key}` : key;

    let desc = prop.description ? ` - ${prop.description}` : '';
    let typeInfo = prop.type;

    if (prop.enum) {
      typeInfo = `enum[${prop.enum.join(' | ')}]`;
    } else if (prop.type === 'array' && prop.items) {
      if (prop.items.type === 'string') typeInfo = 'array of strings';
      else if (prop.items.type === 'number') typeInfo = 'array of numbers';
      else typeInfo = 'array';
    } else if (prop.type === 'object' && prop.properties) {
      // It's a nested object, describe it and then recurse
      lines += `  - ${fullKey} (object)${reqStr}${desc}\n`;
      lines += formatSchemaForAI(prop, `${fullKey}`);
      continue;
    }

    lines += `  - ${fullKey} (${typeInfo})${reqStr}${desc}\n`;
  }
  return lines;
}

export function buildAIPromptContext() {
  let nodesStr = 'AVAILABLE NODES for workflow content:\n\n';

  for (const [type, def] of Object.entries(sharedRegistry)) {
    const inputs = def.handles.inputs.map((h: any) => `"${h.id}" (${Array.isArray(h.expectedType) ? h.expectedType.join('|') : h.expectedType}${h.isMandatory ? ', REQUIRED' : ''})`).join(', ') || 'none';
    const outputs = def.handles.outputs.map((h: any) => `"${h.id}" (${h.dataType})`).join(', ') || 'none';

    nodesStr += `Node Type: ${type}\n`;
    nodesStr += `Description: ${def.meta.description}\n`;
    nodesStr += `Expected Inputs: ${inputs}\n`;
    nodesStr += `Outputs: ${outputs}\n`;
    nodesStr += `Configurable Properties (MUST be placed in data.config):\n`;
    nodesStr += formatSchemaForAI(def.aiSchema);
    nodesStr += `Default Values: ${JSON.stringify(def.defaultConfig)}\n`;
    nodesStr += `Rule: ALL configurable properties for this node MUST be placed strictly inside the "data.config" object of this node's JSON representation.\n`;
    nodesStr += `\n---\n\n`;
  }

  return `You are Prism AI - an expert workflow systems architect. Your job is to construct workflow JSON structures.
 
CRITICAL OUTPUT FORMAT:
- Return ONLY valid JSON. No other text before or after.
- DO NOT output any reasoning, thinking, or decision logic.

JSON response format:
{
  "type": "workflow" | "chat" | "undo",
  "message": "Optional text response to the user. Required for chat/undo.",
  "workflow": {
    "name": "Workflow Name",
    "nodes": [...],
    "edges": [...]
  }
}

Use "workflow" when the request is clear and actionable.
Use "chat" for questions, clarifications, or general conversation.
Use "undo" ONLY when the user explicitly asks to "undo" or "go back" on the PREVIOUS action.

${nodesStr}

WORKFLOW STRUCTURE TEMPLATE (Strictly follow this generic wrapper for all nodes/edges):
{
  "type": "workflow",
  "message": "Creating workflow...",
  "workflow": {
    "name": "...",
    "nodes": [
      {
        "id": "uuid-1",
        "type": "<node_type_from_registry>",
        "position": { "x": 0, "y": 100 },
        "data": {
          "label": "Human Readable Name",
          "config": { /* EXACT PROPERTIES FROM "Configurable Properties" GO HERE */ }
        }
      }
    ],
    "edges": [
      {
        "id": "edge_1_2",
        "source": "uuid-1",
        "target": "uuid-2",
        "sourceHandle": "<output handle id from source node>",
        "targetHandle": "<input handle id on target node>"
      }
    ]
  }
}

WIRING RULES:
1. Every input handle marked REQUIRED must be satisfied by an incoming edge from a compatible output handle (matching data types).
2. A node's config should only contain values for properties listed in its "Configurable Properties" section. Data coming from another node must arrive via an edge, not be duplicated in config.
3. Read edge sources and targets exactly; missing handle names will break the workflow.

CONFIG RULES (Avoid Schema Blindness):
- The AI MUST read the "Configurable Properties" section for the chosen node type.
- The AI MUST create a "config" object inside the node's "data" object.
- The AI MUST inject ALL requested or required configurable properties into that "data.config" object.
- NEVER leave "config" empty if the node requires a text prompt, an amount limit, or any other explicit configuration. 

REMEMBER: Output ONLY the strict JSON object, nothing else.`;
}
// Dynamic instructions are generated functionally

/**
 * Detect if error is a rate limit error
 */
function isRateLimitError(error: any): boolean {
  const message = error?.message?.toLowerCase() || '';
  const status = error?.status || error?.code;

  return (
    status === 429 ||
    status === 503 ||
    message.includes('rate limit') ||
    message.includes('quota exceeded') ||
    message.includes('resource exhausted') ||
    message.includes('too many requests') ||
    message.includes('overloaded') ||
    message.includes('service unavailable') ||
    message.includes('429') ||
    message.includes('503')
  );
}

/**
 * Generate content with Gemini using automatic model rotation
 */
export async function generateWithGemini(prompt: string): Promise<string> {
  const { ModelManager } = await import('./model-manager');
  const modelManager = ModelManager.getInstance();

  let lastError: Error | null = null;
  let currentModel = '';

  // Try up to 10 models (more than enough to cover our priority list)
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      currentModel = modelManager.getNextAvailableModel();

      const model = getGeminiModel(currentModel);
      const result = await model.generateContent(prompt);
      const response = result.response;

      return response.text();

    } catch (error: any) {
      lastError = error;

      // Check if this is a rate limit error or a 404 (Not Found)
      if (isRateLimitError(error)) {
        console.warn(`⏱️ Rate limit hit on ${currentModel}, switching models...`);
        modelManager.markAsBlocked(currentModel, error.message || error.toString());
        continue;
      }

      // If model not found (404), mark it as blocked/invalid so we don't try it again immediately
      if (error.message?.includes('404') || error.status === 404) {
        console.warn(`🚫 Model ${currentModel} not found (404), blocking and skipping...`);
        // Block it so getNextAvailableModel() picks the next one
        modelManager.markAsBlocked(currentModel, '404 - Not Found');
        continue;
      }

      // Non-recoverable error - throw immediately
      console.error(`❌ Non-recoverable error with ${currentModel}:`, error.message);
      throw error;
    }
  }

  // All 3 attempts failed with rate limits
  throw new Error(
    `All available Gemini models are rate-limited. Please try again in 60 seconds. ` +
    `Last error: ${lastError?.message || 'Unknown error'}`
  );
}

export function getGeminiModel(modelName?: string) {
  if (!genAI) {
    throw new Error('Gemini API not initialized - check GEMINI_API_KEY');
  }

  const model = modelName || 'gemini-2.5-flash-lite';
  const systemInstruction = buildAIPromptContext();

  // Strict schema tying down exactly what we expect
  const responseSchema: ResponseSchema = {
    type: SchemaType.OBJECT,
    properties: {
      type: { type: SchemaType.STRING, enum: ["workflow", "chat", "undo"] },
      message: { type: SchemaType.STRING, description: "Text response for chat/undo" },
      workflow: {
        type: SchemaType.OBJECT,
        properties: {
          name: { type: SchemaType.STRING },
          nodes: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                id: { type: SchemaType.STRING },
                type: { type: SchemaType.STRING },
                position: {
                  type: SchemaType.OBJECT,
                  properties: { x: { type: SchemaType.NUMBER }, y: { type: SchemaType.NUMBER } }
                },
                data: { type: SchemaType.OBJECT }
              },
              required: ["id", "type", "data"]
            }
          },
          edges: {
            type: SchemaType.ARRAY,
            items: {
              type: SchemaType.OBJECT,
              properties: {
                id: { type: SchemaType.STRING },
                source: { type: SchemaType.STRING },
                target: { type: SchemaType.STRING },
                targetHandle: { type: SchemaType.STRING }
              },
              required: ["id", "source", "target"]
            }
          }
        },
        required: ["nodes", "edges"]
      }
    },
    required: ["type"]
  };

  return genAI.getGenerativeModel({
    model,
    systemInstruction,
    generationConfig: {
      responseMimeType: "application/json"
    }
  });
}

