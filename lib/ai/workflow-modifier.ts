import { generateWithGemini } from './gemini-client';
import { Workflow } from '@/lib/nodes/types';
import { Message } from './intent-classifier';

export interface ModificationResult {
    isModification: boolean;
    updatedWorkflow?: Workflow;
    changes?: string;
}

/**
 * Detect and apply contextual workflow modifications
 * 
 * Examples:
 * - "make them red" → updates searchTerm to "red [existing term]"
 * - "change to blue" → updates searchTerm with "blue"
 * - "get 20 instead" → updates limit to 20
 * - "make it large" → updates imageSize to "large"
 */
export async function detectAndModifyWorkflow(
    userMessage: string,
    currentWorkflow: Workflow | null,
    conversationHistory: Message[]
): Promise<ModificationResult> {

    if (!currentWorkflow || currentWorkflow.nodes.length === 0) {
        return { isModification: false };
    }

    console.log('🔄 Checking for workflow modification...');

    // Get the first node (assuming scrape_images for now)
    const firstNode = currentWorkflow.nodes[0];
    if (firstNode.type !== 'scrape_images') {
        return { isModification: false };
    }

    const currentConfig = firstNode.data.config as any;

    const prompt = `You are analyzing whether a user wants to modify an existing workflow.

Current Workflow:
- Search Term: "${currentConfig.searchTerm}"
- Limit: ${currentConfig.limit}
- Image Size: ${currentConfig.imageSize || 'any'}
- Image Type: ${currentConfig.imageType || 'any'}
- Color Type: ${currentConfig.colorType || 'any'}

User Message: "${userMessage}"

Recent Conversation:
${conversationHistory.slice(-3).map(m => `${m.type}: ${m.content}`).join('\n')}

Is the user trying to MODIFY the existing workflow? Look for:
- References: "them", "it", "those", "the flowers"
- Modifications: "make", "change", "update", "switch"
- Additions: "add", "include"
- Color changes: "make them red", "change to blue"
- Quantity changes: "get 20 instead", "show me 5"
- Size changes: "make it large", "show small ones"

If YES, extract the modifications:

Return ONLY valid JSON:
{
  "isModification": true/false,
  "searchTerm": "updated search term (or null if no change)",
  "limit": updated_number (or null if no change),
  "imageSize": "small|medium|large|xlarge" (or null if no change),
  "imageType": "photo|clipart|lineart" (or null if no change),
  "colorType": "color|gray|mono" (or null if no change),
  "reasoning": "why this is/isn't a modification"
}`;

    try {
        const response = await generateWithGemini(prompt);
        const cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const result = JSON.parse(cleaned);

        console.log('🔍 Modification detection result:', result);

        if (!result.isModification) {
            return { isModification: false };
        }

        // Apply modifications to workflow
        const updatedConfig = { ...currentConfig };
        let changes: string[] = [];

        if (result.searchTerm) {
            updatedConfig.searchTerm = result.searchTerm;
            changes.push(`search term → "${result.searchTerm}"`);
        }
        if (result.limit) {
            updatedConfig.limit = result.limit;
            changes.push(`limit → ${result.limit}`);
        }
        if (result.imageSize && result.imageSize !== 'any') {
            updatedConfig.imageSize = result.imageSize;
            changes.push(`size → ${result.imageSize}`);
        }
        if (result.imageType && result.imageType !== 'any') {
            updatedConfig.imageType = result.imageType;
            changes.push(`type → ${result.imageType}`);
        }
        if (result.colorType && result.colorType !== 'any') {
            updatedConfig.colorType = result.colorType;
            changes.push(`color → ${result.colorType}`);
        }

        // Create updated workflow
        const updatedWorkflow: Workflow = {
            ...currentWorkflow,
            name: `Scrape ${updatedConfig.searchTerm}`,
            nodes: [
                {
                    ...firstNode,
                    data: {
                        ...firstNode.data,
                        config: updatedConfig,
                    },
                },
                ...currentWorkflow.nodes.slice(1),
            ],
        };

        return {
            isModification: true,
            updatedWorkflow,
            changes: changes.join(', '),
        };

    } catch (error) {
        console.error('❌ Modification detection failed:', error);

        // Fallback: simple keyword detection
        const lower = userMessage.toLowerCase();

        if (lower.match(/\b(them|it|those|that)\b/) &&
            lower.match(/\b(red|blue|green|yellow|purple|orange|pink|black|white)\b/)) {

            // Color modification detected
            const colorMatch = lower.match(/\b(red|blue|green|yellow|purple|orange|pink|black|white)\b/);
            if (colorMatch) {
                const color = colorMatch[1];
                const updatedConfig = {
                    ...currentConfig,
                    searchTerm: `${color} ${currentConfig.searchTerm}`,
                };

                return {
                    isModification: true,
                    updatedWorkflow: {
                        ...currentWorkflow,
                        name: `Scrape ${updatedConfig.searchTerm}`,
                        nodes: [{
                            ...firstNode,
                            data: { ...firstNode.data, config: updatedConfig },
                        }],
                    },
                    changes: `added "${color}" to search`,
                };
            }
        }

        return { isModification: false };
    }
}
