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
            fullPrompt = `Current:${JSON.stringify(compactWorkflow)}\nRequest:"${userPrompt}"${userImages?.length ? `\n[USER ATTACHED ${userImages.length} IMAGE(S) - create media_input node as source]` : ''}\nModify or create new as needed. IMPORTANT: Preserve existing node IDs where possible to maintain state.`;
        }

        // Generate workflow using Gemini
        const response = await generateWithGemini(fullPrompt);

        // Clean response (remove markdown and find JSON object)
        let cleanedResponse = response.trim();

        // Remove markdown code blocks
        if (cleanedResponse.includes('```')) {
            cleanedResponse = cleanedResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '');
        }

        // Try to find a valid envelope JSON object - look for {"type": pattern
        let envelope: any = null;

        // Strategy 1: Find all potential JSON objects starting with {"type"
        const typePattern = /\{"type"\s*:\s*"(workflow|chat)"/g;
        let match;
        const candidates: string[] = [];

        while ((match = typePattern.exec(cleanedResponse)) !== null) {
            // Try to extract a valid JSON starting from this position
            let braceCount = 0;
            let inString = false;
            let escape = false;
            let startPos = match.index;
            let endPos = startPos;

            for (let i = startPos; i < cleanedResponse.length; i++) {
                const char = cleanedResponse[i];

                if (escape) {
                    escape = false;
                    continue;
                }

                if (char === '\\' && inString) {
                    escape = true;
                    continue;
                }

                if (char === '"' && !escape) {
                    inString = !inString;
                    continue;
                }

                if (!inString) {
                    if (char === '{') braceCount++;
                    if (char === '}') {
                        braceCount--;
                        if (braceCount === 0) {
                            endPos = i + 1;
                            break;
                        }
                    }
                }
            }

            if (endPos > startPos) {
                candidates.push(cleanedResponse.substring(startPos, endPos));
            }
        }

        // Try to parse each candidate, preferring workflow over chat
        for (const candidate of candidates) {
            try {
                const parsed = JSON.parse(candidate);
                if (parsed.type === 'workflow' && parsed.content) {
                    envelope = parsed;
                    break; // Prefer workflow
                } else if (parsed.type === 'chat' && !envelope) {
                    envelope = parsed;
                }
            } catch {
                continue;
            }
        }

        // Fallback: try simple first/last brace approach
        if (!envelope) {
            const firstBrace = cleanedResponse.indexOf('{');
            const lastBrace = cleanedResponse.lastIndexOf('}');

            if (firstBrace !== -1 && lastBrace !== -1) {
                try {
                    envelope = JSON.parse(cleanedResponse.substring(firstBrace, lastBrace + 1));
                } catch {
                    // Failed to parse
                }
            }
        }

        // Final Robust Attempt: fix common LLM JSON errors
        if (!envelope) {
            try {
                // 1. Try parsing the cleaned response directly (sometimes regex misses)
                envelope = JSON.parse(cleanedResponse);
            } catch {
                try {
                    // 2. Try fixing trailing commas (common AI error)
                    // Replaces ", }" with "}" and ", ]" with "]"
                    const repaired = cleanedResponse.replace(/,\s*([}\]])/g, '$1');
                    envelope = JSON.parse(repaired);
                } catch {
                    // 3. Try to rescue if it's a valid JSON but with some extra text at the end that regex missed
                    // (already covered by first/last brace, but maybe braces were unbalanced in text?)
                    // If we found a "type": "workflow" but failed to parse, we can try to force it.
                    if (cleanedResponse.includes('"type"')) {
                        console.warn('⚠️ Found JSON pattern but failed to parse. content:', cleanedResponse.substring(0, 100) + '...');
                    }
                }
            }
        }

        if (!envelope) {
            console.warn('⚠️ No valid JSON envelope found, treating as chat');
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

        // HYDRATION: Restore state (images, positions) from previous workflow
        if (previousWorkflow) {
            hydrateWorkflow(workflow, previousWorkflow);
        }

        return { success: true, type: 'workflow', workflow };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Failed to parse workflow',
        };
    }
}

/**
 * Restore state (heavy data, positions) from old workflow to new workflow
 * Matches nodes by ID
 */
function hydrateWorkflow(newWorkflow: Workflow, oldWorkflow: Workflow) {
    newWorkflow.nodes.forEach(newNode => {
        const oldNode = oldWorkflow.nodes.find(n => n.id === newNode.id);
        if (oldNode) {
            // 1. Restore Position (Prioritize user-defined positions over auto-layout if they exist)
            // Logic: If the node existed before, keep its place unless it was significantly moved by layout
            // For now, we strictly prefer the old position to prevent "jumping"
            if (oldNode.position) {
                newNode.position = oldNode.position;
            }

            // 2. Restore Heavy Data (Media Input)
            // The AI only sees placeholders like "[1 images attached]", we need to put the real base64 back
            if (newNode.type === 'media_input' && oldNode.type === 'media_input') {
                const newConfig = newNode.data.config as any; // Cast to any to access dynamic props
                const oldConfig = oldNode.data.config as any;

                // If new config has placeholder or is empty, and old config had images
                // Check if images is a placeholder array or empty
                const hasPlaceholder = Array.isArray(newConfig.images) &&
                    (newConfig.images.length === 0 ||
                        (typeof newConfig.images[0] === 'string' && newConfig.images[0].startsWith('[')));

                if (hasPlaceholder && oldConfig.images && oldConfig.images.length > 0) {

                    newConfig.images = oldConfig.images;
                }
            }
        }
    });
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


    return text || 'images';
}


/**
 * Extract number from prompt (for limit)
 */
function extractNumber(prompt: string): number | null {
    const match = prompt.match(/\b(\d+)\b/);
    return match ? parseInt(match[1]) : null;
}
