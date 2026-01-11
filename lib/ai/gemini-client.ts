import { GoogleGenerativeAI } from '@google/generative-ai';

const apiKey = process.env.GEMINI_API_KEY!;

if (!apiKey) {
  console.warn('GEMINI_API_KEY not set - AI features will not work');
}

const genAI = apiKey ? new GoogleGenerativeAI(apiKey) : null;

const SYSTEM_INSTRUCTION = `You are Prism AI - a workflow builder. Convert natural language to workflow JSON.

DECISION LOGIC:
1. Check source type: ai_generate_image (controllable via prompt) vs scrape_images (real images, need processing) vs media_input (user uploads)
2. If user attached images, ALWAYS use media_input as source node
3. Choose simplest solution: AI-generated → update prompt. Scraped → may need remove_bg + merge for bg changes
4. Prefer simple over complex

NODES:
- media_input: {images:[]} - user uploaded images (use when user attaches images)
- scrape_images: {searchTerm, limit, imageSize?, imageType?, colorType?, safeSearch?}
- ai_generate_image: {prompt, aspectRatio:"1:1"|"16:9"|"4:3"}
- remove_background: {format:"png"|"webp"}
- merge_image: {mode, overlayScale?, overlayPosition?} - needs TWO inputs with targetHandle:"base"/"overlay"
- filter_sort: {criteria:"resolution"|"size"|"format", order:"asc"|"desc"}
- upscale_image: {scale:2|3|4|8}

JSON FORMAT:
{"name":"...","nodes":[{"id":"node_0","type":"...","position":{"x":0,"y":100},"data":{"label":"...","config":{...}}}],"edges":[{"id":"edge_0_1","source":"node_0","target":"node_1"}]}

For merge_image edges: {"source":"node_0","target":"node_2","targetHandle":"overlay"}

RULES: Preserve node IDs when modifying. Remove filler/articles from search. Return ONLY valid JSON.`;

/**
 * Detect if error is a rate limit error
 */
function isRateLimitError(error: any): boolean {
  const message = error?.message?.toLowerCase() || '';
  const status = error?.status || error?.code;

  return (
    status === 429 ||
    status === 'RESOURCE_EXHAUSTED' ||
    message.includes('rate limit') ||
    message.includes('quota exceeded') ||
    message.includes('resource exhausted') ||
    message.includes('too many requests') ||
    message.includes('429')
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

  // Try up to 3 different models before giving up
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      currentModel = modelManager.getNextAvailableModel();

      const model = getGeminiModel(currentModel);
      const result = await model.generateContent(prompt);
      const response = result.response;

      return response.text();

    } catch (error: any) {
      lastError = error;

      // Check if this is a rate limit error
      if (isRateLimitError(error)) {
        console.warn(`⏱️ Rate limit hit on ${currentModel}, switching models...`);
        modelManager.markAsBlocked(currentModel, error.message || error.toString());

        // Continue to try next model
        continue;
      }

      // Non-rate-limit error - throw immediately
      console.error(`❌ Non-rate-limit error with ${currentModel}:`, error.message);
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

