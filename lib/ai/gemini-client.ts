import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKey = process.env.GEMINI_API_KEY!;

if (!apiKey) {
  console.warn('GEMINI_API_KEY not set - AI features will not work');
}

const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

const SYSTEM_INSTRUCTION = `You are Prism AI - a workflow builder. 

CRITICAL: You must return a strict JSON envelope for EVERY response.
Format:
{
  "type": "workflow" | "chat",
  "content": ... // Workflow object OR chat message string
}

DECISION LOGIC:
1. "workflow": Use this ONLY when the user's request is CLEAR and ACTIONABLE, and you have all necessary inputs (e.g. they uploaded an image for editing, or specified a search term).
2. "chat": Use this for:
   - Clarification (e.g. "I can remove the background, but please upload an image first").
   - General conversation (e.g. "Hello", "How does this work?").
   - Ambiguous requests where you cannot safely assume defaults.

NODES (for "workflow" content):
- media_input: {images:[]} - user uploaded images (use when user attaches images)
- scrape_images: {searchTerm, limit, imageSize?, imageType?, colorType?, safeSearch?}
- ai_generate_image: {prompt, aspectRatio:"1:1"|"16:9"|"4:3"}
- remove_background: {format:"png"|"webp"}
- merge_image: {mode, overlayScale?, overlayPosition?} - needs TWO inputs with targetHandle:"base"/"overlay"
- filter_sort: {criteria:"resolution"|"size"|"format", order:"asc"|"desc"}
- upscale_image: {scale:2|3|4|8}

JSON WORKFLOW STRUCTURE:
{"name":"...","nodes":[{"id":"node_0","type":"...","position":{"x":0,"y":100},"data":{"label":"...","config":{...}}}],"edges":[{"id":"edge_0_1","source":"node_0","target":"node_1"}]}

For merge_image edges: {"source":"node_0","target":"node_2","targetHandle":"overlay"}

RULES:
- Return ONLY the JSON envelope. No markdown, no "Here is the workflow".
- Preserve node IDs when modifying.
- If "workflow", the "content" must be the valid workflow JSON object.
- If "chat", the "content" must be a string.`;

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

  // Use provided model name or get from manager
  const model = modelName || 'gemini-2.5-flash-lite';

  return genAI.getGenerativeModel({
    model,
    systemInstruction: SYSTEM_INSTRUCTION,
  });
}

