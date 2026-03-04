import { generateWithGemini } from './gemini-client';
import { Workflow, ScrapeImagesConfig } from '@/lib/nodes/types';
import { autoLayoutNodesAsync } from '@/lib/utils/graph-layout';

/**
 * Generate complete workflow using 100% Gemini AI
 * No regex. No fallbacks. Pure intelligence.
 */
export async function generateWorkflowWithGemini(
    userPrompt: string,
    previousWorkflow?: Workflow | null
): Promise<Workflow> {


    // Build prompt with context if available
    let fullPrompt = userPrompt;

    if (previousWorkflow) {
        fullPrompt = `Previous workflow context:
${JSON.stringify(previousWorkflow, null, 2)}

New user request: ${userPrompt}

If the user is modifying the previous workflow (e.g., "make them red", "add more", "change to blue"), 
update the existing workflow accordingly. Otherwise, create a new workflow.`;
    }

    try {
        // Single Gemini call generates complete workflow
        const response = await generateWithGemini(fullPrompt);

        // Clean response - remove markdown if present
        let cleaned = response.trim();
        if (cleaned.startsWith('```')) {
            cleaned = cleaned
                .replace(/```json\n?/g, '')
                .replace(/```\n?/g, '')
                .trim();
        }


        let workflow: any = JSON.parse(cleaned);

        // Strict unwrapping: since system prompt now mandates the envelope Format,
        // we extract the 'workflow' object directly.
        if (workflow.type === 'workflow') {
            if (!workflow.workflow) {
                throw new Error('Invalid workflow: missing "workflow" object in AI response');
            }
            workflow = workflow.workflow;
        }


        // Validate structure
        if (!workflow.nodes || !Array.isArray(workflow.nodes)) {
            throw new Error('Invalid workflow: missing nodes array');
        }

        if (!workflow.edges) {
            workflow.edges = [];
        }

        // ✨ AUTO-LAYOUT: Apply ELK.js positioning to the generated workflow
        // ✨ AUTO-LAYOUT: Apply ELK.js positioning to the generated workflow
        const layoutPositions = await autoLayoutNodesAsync(workflow.nodes, workflow.edges);

        // Update node positions based on layout calculation
        workflow.nodes = workflow.nodes.map((node: any) => {
            const position = layoutPositions.get(node.id);
            if (position) {

                return {
                    ...node,
                    position: position
                };
            }
            return node;
        });



        return workflow;

    } catch (error) {
        console.error('❌ Workflow Generation Failed:', error);
        console.error('Error details:', error instanceof Error ? error.message : 'Unknown error');

        throw new Error(`Failed to generate workflow: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
