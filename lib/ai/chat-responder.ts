import { generateWithGemini } from './gemini-client';
import { Message } from './intent-classifier';

/**
 * Generate natural chat responses for casual conversation
 */
export async function generateChatResponse(
    userMessage: string,
    conversationHistory: Message[] = []
): Promise<string> {


    const recentHistory = conversationHistory.slice(-5);
    const historyText = recentHistory
        .map(m => `${m.type === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n');

    const prompt = `You are Prism AI, a friendly and helpful assistant for a workflow automation platform.

Previous Conversation:
${historyText || 'No previous conversation.'}

User: ${userMessage}

Respond naturally and helpfully. You can:
- Greet users warmly
- Answer casual questions
- Be friendly and conversational
- Keep responses concise (1-3 sentences)

Guidelines:
- If they're greeting, greet back and offer help
- If they're thanking you, acknowledge graciously
- If they're asking about you, explain you're an AI assistant for workflow automation
- Be natural and human-like

Respond as the Assistant:`;

    try {
        const response = await generateWithGemini(prompt);

        return response.trim();
    } catch (error) {
        console.error('❌ Chat response failed:', error);
        return "Hi! I'm here to help you create workflow automations. What would you like to do?";
    }
}

/**
 * Answer questions about the Prism platform
 */
export async function answerPlatformQuestion(
    question: string,
    conversationHistory: Message[] = []
): Promise<string> {


    const recentHistory = conversationHistory.slice(-3);
    const historyText = recentHistory
        .map(m => `${m.type === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n');

    const prompt = `You are Prism AI, an expert assistant for the Prism workflow automation platform.

Previous Conversation:
${historyText || 'No previous conversation.'}

User Question: ${question}

Platform Capabilities:
1. **Scrape Images**: Search and download images from sources like Pixabay
   - Configure search terms, limits, sizes, types, colors
   
2. **Remove Background**: Automatically remove backgrounds from images
   - Outputs transparent PNGs
   
3. **Filter & Sort**: Organize images by resolution, size, or format
   - Sort ascending or descending
   
4. **AI Generate Image**: Create images using AI from text descriptions
   - Customize aspect ratios

Provide a clear, helpful answer about Prism's features and how to use them.
Keep it concise (2-4 sentences).

Answer:`;

    try {
        const response = await generateWithGemini(prompt);

        return response.trim();
    } catch (error) {
        console.error('❌ Platform question failed:', error);
        return "Prism helps you automate image workflows! You can search for images, remove backgrounds, filter results, and even generate images with AI. Just tell me what you'd like to do!";
    }
}
