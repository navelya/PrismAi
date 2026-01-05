import { generateWithGemini } from './gemini-client';
import { Workflow, ScrapeImagesConfig } from '@/lib/nodes/types';
import { autoLayoutNodes } from '@/lib/utils/graph-layout';

/**
 * Generate complete workflow using 100% Gemini AI
 * No regex. No fallbacks. Pure intelligence.
 */
export async function generateWorkflowWithGemini(
    userPrompt: string,
    previousWorkflow?: Workflow | null
): Promise<Workflow> {
    console.log('🤖 === GEMINI WORKFLOW GENERATION ===');
    console.log('📝 User Prompt:', userPrompt);
    console.log('🔄 Has Context:', !!previousWorkflow);

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
        console.log('🚀 Calling Gemini AI...');
        const response = await generateWithGemini(fullPrompt);
        console.log('✅ Gemini Response Received');

        // Clean response - remove markdown if present
        let cleaned = response.trim();
        if (cleaned.startsWith('```')) {
            cleaned = cleaned
                .replace(/```json\n?/g, '')
                .replace(/```\n?/g, '')
                .trim();
        }

        console.log('🔍 Parsing JSON...');
        const workflow: Workflow = JSON.parse(cleaned);

        // Log success
        console.log('✅ Workflow Generated Successfully!');
        console.log('📊 Workflow Details:');
        console.log('  - Name:', workflow.name);
        console.log('  - Nodes:', workflow.nodes.length);
        console.log('  - Edges:', workflow.edges?.length || 0);

        // Log each node
        workflow.nodes.forEach((node, idx) => {
            console.log(`  - Node ${idx}:`, node.type);
            if (node.type === 'scrape_images') {
                const config = node.data.config as ScrapeImagesConfig;
                if (config.searchTerm) {
                    console.log(`    → Search: "${config.searchTerm}"`);
                    console.log(`    → Limit: ${config.limit}`);
                }
            }
        });

        // Validate structure
        if (!workflow.nodes || !Array.isArray(workflow.nodes)) {
            throw new Error('Invalid workflow: missing nodes array');
        }

        if (!workflow.edges) {
            workflow.edges = [];
        }

        // ✨ AUTO-LAYOUT: Apply intelligent positioning to the generated workflow
        console.log('📐 Applying auto-layout to generated workflow...');
        const layoutPositions = autoLayoutNodes(workflow.nodes, workflow.edges);

        // Update node positions based on layout calculation
        workflow.nodes = workflow.nodes.map(node => {
            const position = layoutPositions.get(node.id);
            if (position) {
                console.log(`  → Positioned ${node.type} at (${position.x}, ${position.y})`);
                return {
                    ...node,
                    position: position
                };
            }
            return node;
        });

        console.log('✅ Auto-layout applied successfully!');

        return workflow;

    } catch (error) {
        console.error('❌ Workflow Generation Failed:', error);
        console.error('Error details:', error instanceof Error ? error.message : 'Unknown error');

        throw new Error(`Failed to generate workflow: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}
