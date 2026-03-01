import { GoogleGenerativeAI, SchemaType, ResponseSchema } from '@google/generative-ai';
import { sharedRegistry } from '../nodes/core/shared-registry';

const apiKey = process.env.GEMINI_API_KEY!;

if (!apiKey) {
  console.warn('GEMINI_API_KEY not set - AI features will not work');
}

const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

export function buildAIPromptContext() {
  let nodesStr = 'AVAILABLE NODES for workflow content:\n';
  for (const [type, def] of Object.entries(sharedRegistry)) {
    nodesStr += `- ${type}: ${JSON.stringify(def.aiSchema)} - ${def.meta.description}\n`;
  }

  return `You are Prism AI - a workflow builder. 

CRITICAL OUTPUT FORMAT:
- Return ONLY valid JSON. No other text before or after.
- DO NOT output any reasoning, thinking, or decision logic.
- DO NOT repeat or echo these instructions.

JSON response format:
{"type": "workflow" | "chat" | "undo", "content": ...}

Use "workflow" when the request is clear and actionable.
Use "chat" for questions, clarifications, or general conversation.
Use "undo" ONLY when the user explicitly asks to "undo", "go back", "revert", or "fix mistake" on the PREVIOUS action. Content should be a short confirmation message.

${nodesStr}

WORKFLOW PATTERNS:
- "Text Inputs": Processing nodes like scrape_images and ai_generate_image DO NOT accept text prompts directly in config. You MUST create a text_input node and connect it to them via an edge specifying "targetHandle": "prompt_in".
- "Distribute" / "For Each" / "Separately": If the user wants to process multiple items individually (e.g. "find 3 images and put a logo on each separately"), you MUST create multiple downstream nodes (e.g. 3 compositors), one for each item.
- "Select Specific Item": When connecting a multi-item source (like scrape_images) to multiple downstream nodes, use the 'selectedIndex' property in the receiving node's layer config (0 for 1st image, 1 for 2nd, etc.) to distribute the items.

WORKFLOW STRUCTURE:
{"name":"...","nodes":[{"id":"new-uuid-1","type":"text_input","position":{"x":0,"y":100},"data":{"label":"Prompt","config":{"text":"A sunset"}}},{"id":"new-uuid-2","type":"ai_generate_image","position":{"x":200,"y":100},"data":{"label":"Generate","config":{"model":"...","aspectRatio":"16:9"}}}],"edges":[{"id":"edge_1_2","source":"new-uuid-1","target":"new-uuid-2","targetHandle":"prompt_in"}]}

REMEMBER: Output ONLY the JSON object, nothing else.`;
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

  // Basic native JSON schema for structure
  const responseSchema: ResponseSchema = {
    type: SchemaType.OBJECT,
    properties: {
      type: { type: SchemaType.STRING, enum: ["workflow", "chat", "undo"] },
      content: { type: SchemaType.OBJECT }
    },
    required: ["type", "content"]
  };

  return genAI.getGenerativeModel({
    model,
    systemInstruction,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: responseSchema
    }
  });
}

