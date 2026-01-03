import { generateWithGemini } from './gemini-client';
import { Workflow, WorkflowNode, WorkflowEdge, ScrapeImagesConfig } from '../nodes/types';
import { autoLayoutNodes } from '../utils/graph-layout';

/**
 * Parse user request and convert to workflow using Gemini
 * Can create new workflows or modify existing ones based on context
 */
export async function parseRequestToWorkflow(
    userPrompt: string,
    previousWorkflow?: Workflow | null
): Promise<{
    success: boolean;
    workflow?: Workflow;
    error?: string;
}> {
    console.log('🎯 === WORKFLOW GENERATION START ===');
    console.log('📝 User Prompt:', userPrompt);
    console.log('🔄 Previous Workflow:', previousWorkflow ? 'YES' : 'NO');
    console.log('🔑 Gemini API Key Present:', !!process.env.GEMINI_API_KEY);

    try {
        // Build context-aware prompt
        let fullPrompt = userPrompt;

        if (previousWorkflow && previousWorkflow.nodes && previousWorkflow.nodes.length > 0) {
            console.log('📋 Including current workflow context...');
            console.log('  - Current nodes:', previousWorkflow.nodes.length);
            console.log('  - Current edges:', previousWorkflow.edges?.length || 0);

            fullPrompt = `Current workflow in the editor:
${JSON.stringify(previousWorkflow, null, 2)}

User's request: "${userPrompt}"

IMPORTANT: Analyze the request carefully:
- If it's a MODIFICATION (e.g., "change them to X", "make it Y", "add Z", "remove background", "sort by...", "give me X instead"):
  → Modify the current workflow above, preserve node IDs
- If it's a NEW REQUEST (e.g., "get me X", "find Y", "search for Z"):
  → Create a completely new workflow

For modifications, maintain node IDs and only change what's requested.
Return the modified or new workflow as JSON.`;
        }

        // Generate workflow using Gemini
        console.log('🤖 Calling Gemini API...');
        const response = await generateWithGemini(fullPrompt);
        console.log('✅ Gemini Response Received');
        console.log('📄 Raw Response:', response.substring(0, 200) + '...');

        // Clean response (remove markdown code blocks if present)
        let cleanedResponse = response.trim();
        if (cleanedResponse.startsWith('```')) {
            cleanedResponse = cleanedResponse
                .replace(/```json\n?/g, '')
                .replace(/```\n?/g, '')
                .trim();
        }

        // Parse JSON
        console.log('🔍 Parsing JSON...');
        const workflow: Workflow = JSON.parse(cleanedResponse);
        console.log('✅ Parsed Workflow Successfully');
        console.log('📊 Workflow Details:');
        console.log('  - Name:', workflow.name);
        console.log('  - Nodes:', workflow.nodes?.length);
        console.log('  - Edges:', workflow.edges?.length);


        if (workflow.nodes?.[0]) {
            const firstNode = workflow.nodes[0];
            console.log('  - First Node Type:', firstNode.type);
            if (firstNode.type === 'scrape_images' && 'searchTerm' in firstNode.data.config) {
                console.log('  - Search Term:', (firstNode.data.config as ScrapeImagesConfig).searchTerm);
                console.log('  - Limit:', (firstNode.data.config as ScrapeImagesConfig).limit);
            }
        }

        // Validate basic structure
        if (!workflow.nodes || !Array.isArray(workflow.nodes)) {
            throw new Error('Invalid workflow: missing or invalid nodes array');
        }

        if (!workflow.edges || !Array.isArray(workflow.edges)) {
            throw new Error('Invalid workflow: missing or invalid edges array');
        }

        // Validate node types
        const validTypes = ['scrape_images', 'remove_background', 'filter_sort', 'ai_generate_image'];
        for (const node of workflow.nodes) {
            if (!validTypes.includes(node.type)) {
                throw new Error(`Invalid node type: ${node.type}`);
            }
        }

        // ✨ AUTO-LAYOUT: Apply intelligent positioning to the generated workflow
        console.log('📐 Applying auto-layout to AI-generated workflow...');
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

        return {
            success: true,
            workflow,
        };
    } catch (error) {
        console.error('❌ === WORKFLOW GENERATION ERROR ===');
        console.error('Error Type:', error instanceof Error ? error.constructor.name : typeof error);
        console.error('Error Message:', error instanceof Error ? error.message : String(error));
        console.error('Stack:', error instanceof Error ? error.stack : 'N/A');

        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to parse workflow',
        };
    }
}

/**
 * Fallback workflow generation (if Gemini fails)
 */
export function createFallbackWorkflow(userPrompt: string): Workflow {
    // Extract keywords from prompt
    const promptLower = userPrompt.toLowerCase();

    const nodes = [];
    const edges = [];
    let nodeCount = 0;

    // Parse search term and limit with better extraction
    const searchTerm = extractSearchTerm(promptLower);
    const limit = extractNumber(promptLower) || 10;

    // Detect source websites with improved regex
    let sources: string[] | undefined;
    const sourceRegex = /(?:from|on)\s+([\w.-]+\.[\w]+)/g;
    const sourceMatches = [...promptLower.matchAll(sourceRegex)];
    if (sourceMatches.length > 0) {
        sources = sourceMatches.map(match => match[1]);
    }

    // Detect image size with more keywords
    let imageSize: 'small' | 'medium' | 'large' | 'xlarge' | 'any' | undefined;
    if (promptLower.includes('xlarge') || promptLower.includes('extra large') || promptLower.includes('huge') || promptLower.includes('massive')) {
        imageSize = 'xlarge';
    } else if (promptLower.includes('large') || promptLower.includes('big')) {
        imageSize = 'large';
    } else if (promptLower.includes('medium')) {
        imageSize = 'medium';
    } else if (promptLower.includes('small') || promptLower.includes('tiny') || promptLower.includes('little')) {
        imageSize = 'small';
    }

    // Detect image type with more keywords
    let imageType: 'photo' | 'clipart' | 'lineart' | 'face' | 'any' | undefined;
    if (promptLower.includes('photo') || promptLower.includes('photograph')) {
        imageType = 'photo';
    } else if (promptLower.includes('clipart') || promptLower.includes('clip art') || promptLower.includes('illustration')) {
        imageType = 'clipart';
    } else if (promptLower.includes('lineart') || promptLower.includes('line art') || promptLower.includes('drawing') || promptLower.includes('vector')) {
        imageType = 'lineart';
    } else if (promptLower.includes('face') || promptLower.includes('portrait') || promptLower.includes('headshot')) {
        imageType = 'face';
    }

    // Detect color type with more keywords
    let colorType: 'color' | 'gray' | 'mono' | 'any' | undefined;
    if (promptLower.includes('grayscale') || promptLower.includes('gray scale') || promptLower.includes('grey') ||
        promptLower.includes('black and white') || promptLower.includes('b&w') || promptLower.includes('bw')) {
        colorType = 'gray';
    } else if (promptLower.includes('monochrome') || promptLower.includes('mono')) {
        colorType = 'mono';
    } else if (promptLower.includes('color') || promptLower.includes('colour') || promptLower.includes('colorful')) {
        colorType = 'color';
    }

    // Build comprehensive scrape config
    const scrapeConfig: ScrapeImagesConfig = {
        searchTerm: searchTerm || 'images',
        limit,
        ...(sources && { sources }),
        imageSize: imageSize || 'any',
        imageType: imageType || 'any',
        colorType: colorType || 'any',
        safeSearch: 'medium' as const,
    };

    const scrapeNode = {
        id: `node_${nodeCount++}`,
        type: 'scrape_images' as const,
        position: { x: 0, y: 100 },
        data: {
            label: 'Scrape Images',
            config: scrapeConfig,
        },
    };
    nodes.push(scrapeNode);

    let lastNodeId = scrapeNode.id;

    // Check for background removal
    if (promptLower.includes('remove background') || promptLower.includes('no background')) {
        const bgNode = {
            id: `node_${nodeCount++}`,
            type: 'remove_background' as const,
            position: { x: 200, y: 100 },
            data: {
                label: 'Remove Background',
                config: { format: 'png' as const },
            },
        };
        nodes.push(bgNode);
        edges.push({
            id: `edge_${lastNodeId}_${bgNode.id}`,
            source: lastNodeId,
            target: bgNode.id,
        });
        lastNodeId = bgNode.id;
    }

    // Check for sorting
    if (promptLower.includes('sort')) {
        const criteria: 'resolution' | 'size' | 'format' = promptLower.includes('resolution') ? 'resolution' :
            promptLower.includes('size') ? 'size' : 'resolution';
        const order: 'asc' | 'desc' = promptLower.includes('desc') || promptLower.includes('largest') ? 'desc' : 'asc';

        const sortNode = {
            id: `node_${nodeCount++}`,
            type: 'filter_sort' as const,
            position: { x: nodes.length * 200, y: 100 },
            data: {
                label: 'Filter & Sort',
                config: { criteria, order },
            },
        };
        nodes.push(sortNode);
        edges.push({
            id: `edge_${lastNodeId}_${sortNode.id}`,
            source: lastNodeId,
            target: sortNode.id,
        });
    }

    return {
        name: `Workflow: ${userPrompt.substring(0, 50)}`,
        nodes,
        edges,
    };
}

/**
 * Extract search term from prompt
 */
function extractSearchTerm(prompt: string): string {
    let text = prompt.toLowerCase();

    // Remove "hey," "hi," etc at start
    text = text.replace(/^(hey|hi|hello),?\s*/gi, '');

    // Remove action words
    text = text.replace(/^(get me|give me|show me|find me)\s+/gi, '');

    // Remove "10 pics of" pattern
    text = text.replace(/^\d+\s+(pics?|images?|photos?)\s+(of\s+)?/gi, '');

    // Remove trailing words
    text = text.replace(/\s+(pics?|images?|photos?)$/gi, '').trim();

    console.log('✅ Search term:', text || 'images');
    return text || 'images';
}


/**
 * Extract number from prompt (for limit)
 */
function extractNumber(prompt: string): number | null {
    const match = prompt.match(/\b(\d+)\b/);
    return match ? parseInt(match[1]) : null;
}
