import { generateWithGemini } from './gemini-client';

export interface Message {
    id: string;
    type: 'user' | 'assistant';
    content: string;
    timestamp: Date;
}

export interface IntentResult {
    intent: 'workflow' | 'chat' | 'question';
    confidence: number;
    reasoning?: string;
}

/**
 * Format conversation history for context
 */
function formatHistory(messages: Message[]): string {
    // Get last 5 messages for context
    const recentMessages = messages.slice(-5);

    if (recentMessages.length === 0) {
        return 'No previous conversation.';
    }

    return recentMessages
        .map(m => `${m.type === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n');
}

/**
 * Classify user intent using Gemini AI
 * 
 * Determines whether the user wants to:
 * - Create/modify a workflow (WORKFLOW)
 * - Have a casual conversation (CHAT)
 * - Ask a question about the platform (QUESTION)
 */
export async function classifyIntent(
    message: string,
    conversationHistory: Message[] = []
): Promise<IntentResult> {
    console.log('🎯 Classifying intent for:', message);

    const prompt = `You are an intent classifier for a workflow automation platform called "Prism".

Conversation History:
${formatHistory(conversationHistory)}

Current User Message: "${message}"

Your task is to classify this message into ONE of these intents:

1. **WORKFLOW** - User wants to create or modify an automation workflow
   DEFAULT TO THIS if there's ANY doubt!
   
   Triggers (VERY BROAD):
   - ANY action request: "get", "find", "create", "scrape", "show", "give", "fetch"
   - Implicit tasks: "I want", "I need", "can you", "could you"
   - Object requests: mentions specific things (flowers, cats, images, photos)
   - Quantity mentions: any numbers (10, 5, 20)
   - Even vague: "something", "some stuff", "things"
   
   Examples:
   ✅ "get flowers" → WORKFLOW
   ✅ "show me cats" → WORKFLOW  
   ✅ "I want 10 images" → WORKFLOW
   ✅ "find something cool" → WORKFLOW
   ✅ "can you search for sunsets" → WORKFLOW
   ✅ "add cubes" → WORKFLOW
   ✅ "build nodes" → WORKFLOW
   
2. **CHAT** - ONLY for pure greetings with NO request
   - ONLY: "hey", "hi", "hello", "thanks", "thank you", "cool", "nice"
   - NO follow-up request at all
   
   Examples:
   ✅ "hey" → CHAT (greeting only)
   ❌ "hey get flowers" → WORKFLOW (has request!)
   ❌ "hi, show me cats" → WORKFLOW (has action!)
   
3. **QUESTION** - ONLY asking about the platform itself
   - ONLY platform questions: "what can you do", "how does this work"
   - NOT requests for data/images
   
   Examples:
   ✅ "what features do you have" → QUESTION
   ❌ "what flowers do you have" → WORKFLOW (wants images!)

CRITICAL RULE: If there's ANY object, action, or number mentioned → WORKFLOW
When in doubt → WORKFLOW

Return ONLY valid JSON:
{
  "intent": "workflow" | "chat" | "question",
  "confidence": 0.0-1.0,
  "reasoning": "Brief explanation"
}`;

    try {
        const response = await generateWithGemini(prompt);

        // Clean potential markdown
        const cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const result = JSON.parse(cleaned);

        console.log('✅ Intent classified:', result);

        return result;
    } catch (error) {
        console.error('❌ Intent classification failed:', error);

        // Fallback: simple keyword detection
        const lowerMessage = message.toLowerCase();

        // Check for pure greetings (ONLY these with nothing else)
        if (lowerMessage.match(/^(hey|hi|hello|thanks|thank you|cool|nice|awesome)\.?$/)) {
            return { intent: 'chat', confidence: 0.7, reasoning: 'Pure greeting (fallback)' };
        }

        // Check for platform questions
        if (lowerMessage.match(/\b(how do|what can you|explain|help me)\b/) &&
            !lowerMessage.match(/\b(get|find|show|give)\b/)) {
            return { intent: 'question', confidence: 0.6, reasoning: 'Platform question (fallback)' };
        }

        // Everything else is probably a workflow request
        // ANY action verb, object mention, or number = workflow
        if (lowerMessage.match(/\b(get|find|create|scrape|remove|filter|generate|show|give|fetch|search|add|build|make)\b/) ||
            lowerMessage.match(/\b(image|images|photo|photos|picture|pictures|flower|flowers|cat|cats|dog|dogs|sunset|sunsets|cube|cubes|node|nodes)\b/) ||
            lowerMessage.match(/\b\d+\b/)) {
            return { intent: 'workflow', confidence: 0.8, reasoning: 'Action/object detected (fallback)' };
        }

        // Default to workflow (when in doubt, create!)
        return { intent: 'workflow', confidence: 0.5, reasoning: 'Defaulting to workflow (fallback)' };
    }
}
