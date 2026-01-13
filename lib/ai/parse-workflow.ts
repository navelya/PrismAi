import { generateWithGemini } from './gemini-client';
import { Workflow, WorkflowNode, WorkflowEdge, ScrapeImagesConfig } from '../nodes/types';
import { autoLayoutNodesAsync } from '../utils/graph-layout';

/**
 * Parse user request and convert to workflow using Gemini
 * Optimized for speed - minimal logging, fast layout
 */
export async function parseRequestToWorkflow(
    userPrompt: string,
    previousWorkflow?: Workflow | null,
    userImages?: string[]
): Promise<{
    success: boolean;
    type?: 'workflow' | 'chat';
    workflow?: Workflow;
    message?: string;
    error?: string;
}> {
    try {
        // Build context-aware prompt (compact format)
        let fullPrompt = userPrompt;

        // If user attached images, tell AI to create media_input node
        if (userImages && userImages.length > 0) {
            fullPrompt += `\n[USER ATTACHED ${userImages.length} IMAGE(S) - create a media_input node as source. Config: {images:[]}]`;
        }

        if (previousWorkflow?.nodes?.length) {
            // Compact workflow context - only essential info
            // CRITICAL: Strip base64 images from media_input nodes to avoid token explosion
            const compactWorkflow = {
                nodes: previousWorkflow.nodes.map(n => {
                    const config = { ...n.data.config };
                    // Remove large base64 data from media_input nodes
                    if (n.type === 'media_input' && config && 'images' in config) {
                        config.images = [`[${(config.images as string[])?.length || 0} images attached]`];
                    }
                    return {
                        id: n.id,
                        type: n.type,
                        config
                    };
                }),
                edges: previousWorkflow.edges?.map(e => ({
                    source: e.source,
                    target: e.target,
                    targetHandle: (e as any).targetHandle
                }))
            };
            fullPrompt = `Current:${JSON.stringify(compactWorkflow)}\nRequest:"${userPrompt}"${userImages?.length ? `\n[USER ATTACHED ${userImages.length} IMAGE(S) - create media_input node as source]` : ''}\nModify or create new as needed.`;
        }

        // Generate workflow using Gemini
        const response = await generateWithGemini(fullPrompt);

        // Clean response (remove markdown and find JSON object)
        let cleanedResponse = response.trim();

        // Remove markdown code blocks
        if (cleanedResponse.includes('```')) {
            cleanedResponse = cleanedResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '');
        }

        // Find the first '{' and last '}' to extract the JSON object
        const firstBrace = cleanedResponse.indexOf('{');
        const lastBrace = cleanedResponse.lastIndexOf('}');

        if (firstBrace !== -1 && lastBrace !== -1) {
            cleanedResponse = cleanedResponse.substring(firstBrace, lastBrace + 1);
        } else {
            console.warn('⚠️ No JSON object found in response, treating as chat:', cleanedResponse);
            // Fallback: treat as raw chat if no JSON found
            return {
                success: true,
                type: 'chat',
                message: response
            };
        }

        // Parse JSON Envelope
        let envelope: any;
        try {
            envelope = JSON.parse(cleanedResponse);
        } catch (e) {
            console.warn('⚠️ Failed to parse JSON envelope, treating as chat:', cleanedResponse);
            return {
                success: true,
                type: 'chat',
                message: response
            };
        }

        // HANDLE CHAT RESPONSE
        if (envelope.type === 'chat') {
            return {
                success: true,
                type: 'chat',
                message: typeof envelope.content === 'string' ? envelope.content : JSON.stringify(envelope.content)
            };
        }

        // HANDLE WORKFLOW RESPONSE
        // If type is explicitly 'workflow', OR if it looks like a workflow (legacy fallback)
        let workflow: Workflow;
        if (envelope.type === 'workflow') {
            workflow = envelope.content;
        } else if (envelope.nodes && Array.isArray(envelope.nodes)) {
            // Legacy/Direct workflow format fallback
            workflow = envelope as Workflow;
        } else {
            // Unknown structure - assume chat/error
            return {
                success: true,
                type: 'chat',
                message: typeof envelope.content === 'string' ? envelope.content : "I'm not sure how to handle that."
            };
        }

        // Validate basic structure
        if (!workflow.nodes || !Array.isArray(workflow.nodes)) {
            throw new Error('Invalid workflow: missing nodes array');
        }
        if (!workflow.edges) workflow.edges = [];

        // Validate node types and normalize structure
        const validTypes = ['scrape_images', 'remove_background', 'filter_sort', 'ai_generate_image', 'upscale_image', 'merge_image', 'media_input'];
        workflow.nodes = workflow.nodes.map((node, index) => {
            if (!validTypes.includes(node.type)) {
                throw new Error(`Invalid node type: ${node.type}`);
            }

            // Ensure node has a valid ID (ELK requires string IDs)
            if (!node.id || typeof node.id !== 'string') {
                node.id = `node_${index}`;
            }

            // Ensure node has proper data.config structure
            // AI might return config at top level or under data
            if (!node.data) {
                node.data = { label: node.type, config: (node as any).config || {} };
            } else if (!node.data.config) {
                node.data.config = {};
            }

            // Clean up top-level config if it was moved to data
            if ((node as any).config) {
                node.data.config = { ...node.data.config, ...(node as any).config };
                delete (node as any).config;
            }

            // Inject user-uploaded images into media_input nodes
            if (node.type === 'media_input' && userImages && userImages.length > 0) {
                node.data.config = { ...node.data.config, images: userImages };
            }

            return node;
        });

        // AUTO-LAYOUT: Always apply ELK layout for consistent positioning
        const layoutPositions = await autoLayoutNodesAsync(workflow.nodes, workflow.edges);
        workflow.nodes = workflow.nodes.map(node => {
            const position = layoutPositions.get(node.id);
            return position ? { ...node, position } : {
                ...node,
                position: node.position || { x: 0, y: 100 }
            };
        });

        return { success: true, type: 'workflow', workflow };
    } catch (error) {
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
