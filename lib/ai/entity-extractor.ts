import { generateWithGemini } from './gemini-client';

export interface WorkflowEntities {
    searchTerm: string;
    limit?: number;
    imageSize?: 'small' | 'medium' | 'large' | 'xlarge' | 'any';
    imageType?: 'photo' | 'clipart' | 'lineart' | 'face' | 'any';
    colorType?: 'color' | 'gray' | 'mono' | 'any';
    sources?: string[];
}

/**
 * Extract workflow entities from natural language using smart NLP
 * 
 * CRITICAL: Preserves full noun phrases (e.g., "red flowers" NOT "flowers")
 * Filters filler words intelligently
 * Extracts all relevant parameters
 */
export async function extractWorkflowEntities(message: string): Promise<WorkflowEntities> {


    const prompt = `You are an entity extractor for a workflow automation platform.

User Message: "${message}"

Extract workflow parameters following these CRITICAL RULES:

1. **Preserve COMPLETE noun phrases** - This is the most important rule!
   ✅ "red flowers" → searchTerm: "red flowers"
   ✅ "large blue ocean" → searchTerm: "large blue ocean"
   ✅ "cute baby animals" → searchTerm: "cute baby animals"
   ✅ "sunset photos" → searchTerm: "sunset"
   ❌ NEVER drop adjectives or modifiers

2. **Ignore filler words and action verbs**
   - Filler: hey, please, um, uh, thanks, hi, hello
   - Action verbs: get, find, search, show, give, fetch, grab
   - These should NOT go in searchTerm

3. **Extract quantities**
   - "10 flowers" → limit: 10
   - "5 images" → limit: 5
   - Default to 10 if not specified

4. **Detect image properties**
   - Size: small, medium, large, xlarge, huge, tiny
   - Type: photo, clipart, illustration, lineart, face
   - Color: grayscale, black and white, monochrome, color

Examples:
- "get 10 red flowers" → { searchTerm: "red flowers", limit: 10 }
- "find large blue cats" → { searchTerm: "large blue cats", limit: 10, imageSize: "large" }
- "hey search for 5 sunsets" → { searchTerm: "sunsets", limit: 5 }
- "20 cute baby animals as photos" → { searchTerm: "cute baby animals", limit: 20, imageType: "photo" }
- "grayscale portraits" → { searchTerm: "portraits", colorType: "gray", limit: 10 }

Return ONLY valid JSON:
{
  "searchTerm": "full noun phrase here",
  "limit": 10,
  "imageSize": "any",
  "imageType": "any",
  "colorType": "any"
}`;

    try {
        const response = await generateWithGemini(prompt);

        // Clean potential markdown
        const cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const entities = JSON.parse(cleaned);



        // Validate and provide defaults
        return {
            searchTerm: entities.searchTerm || 'images',
            limit: entities.limit || 10,
            imageSize: entities.imageSize || 'any',
            imageType: entities.imageType || 'any',
            colorType: entities.colorType || 'any',
            sources: entities.sources,
        };
    } catch (error) {
        console.error('❌ Entity extraction failed:', error);

        // Fallback to improved regex-based extraction
        return extractEntitiesFallback(message);
    }
}

/**
 * Fallback entity extraction using improved regex
 */
function extractEntitiesFallback(message: string): WorkflowEntities {


    const lower = message.toLowerCase();

    // Extract number
    const numberMatch = lower.match(/\b(\d+)\b/);
    const limit = numberMatch ? parseInt(numberMatch[1]) : 10;

    // Remove filler words and action verbs
    let cleaned = lower
        .replace(/\b(hey|hi|hello|please|um|uh|thanks)\b/g, '')
        .replace(/\b(get|find|search|show|give|fetch|grab)\b/g, '')
        .replace(/\b(me|some|of)\b/g, '')
        .replace(/\d+/g, '') // Remove numbers
        .replace(/\s+/g, ' ')
        .trim();

    // Extract size
    let imageSize: WorkflowEntities['imageSize'] = 'any';
    if (cleaned.includes('large') || cleaned.includes('big')) imageSize = 'large';
    if (cleaned.includes('small') || cleaned.includes('tiny')) imageSize = 'small';
    if (cleaned.includes('medium')) imageSize = 'medium';

    // Remove size words from search term
    cleaned = cleaned.replace(/\b(large|small|medium|big|tiny|huge)\b/g, '').trim();

    // Extract type
    let imageType: WorkflowEntities['imageType'] = 'any';
    if (cleaned.includes('photo')) {
        imageType = 'photo';
        cleaned = cleaned.replace(/\bphotos?\b/g, '').trim();
    }
    if (cleaned.includes('clipart') || cleaned.includes('illustration')) {
        imageType = 'clipart';
        cleaned = cleaned.replace(/\b(clipart|illustrations?)\b/g, '').trim();
    }

    // Extract color type
    let colorType: WorkflowEntities['colorType'] = 'any';
    if (cleaned.match(/\b(grayscale|gray|grey|black and white|monochrome)\b/)) {
        colorType = 'gray';
        cleaned = cleaned.replace(/\b(grayscale|gray|grey|black and white|monochrome)\b/g, '').trim();
    }

    // What's left is the search term
    const searchTerm = cleaned.replace(/\bimages?\b/g, '').replace(/\bpics?\b/g, '').trim() || 'images';

    return {
        searchTerm,
        limit,
        imageSize,
        imageType,
        colorType,
    };
}
