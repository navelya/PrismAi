import { streamText, tool, stepCountIs } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/service';
import { sharedRegistry } from '@/lib/nodes/core/shared-registry';
import { waitUntil } from '@vercel/functions';

export const runtime = 'edge';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const google = createGoogleGenerativeAI({
    apiKey: process.env.GEMINI_API_KEY!
});

// Helper to generate dynamic schema docs for the tool description
function getCleanNodesContext() {
    let nodesStr = '';
    try {
        for (const [type, def] of Object.entries(sharedRegistry)) {
            const inputs = def.handles?.inputs?.map((h: any) => `"${h.id}" (Type: ${Array.isArray(h.expectedType) ? h.expectedType.join('|') : h.expectedType || 'any'})`).join(', ') || 'none';
            const outputs = def.handles?.outputs?.map((h: any) => `"${h.id}" (Type: ${h.dataType || 'any'})`).join(', ') || 'none';

            nodesStr += `\n--- Node Type: ${type} ---\n`;
            if (def.meta?.description) nodesStr += `Description: ${def.meta.description}\n`;
            nodesStr += `Inputs (Use as targetHandle): ${inputs}\n`;
            nodesStr += `Outputs (Use as sourceHandle): ${outputs}\n`;
            nodesStr += `Configuration Schema (Populate strictly inside 'data.config'):\n`;

            if (def.aiSchema && Object.keys(def.aiSchema).length > 0) {
                nodesStr += JSON.stringify(def.aiSchema, null, 2) + '\n';
            } else {
                nodesStr += `  {}\n`;
            }
        }
    } catch (e) {
        console.error("Error reading registry:", e);
    }
    return nodesStr;
}

const cleanNodesDocs = getCleanNodesContext();

// 1. UNIFIED TOOL DEFINITION
const prismTools = {
    mutate_workflow: tool({
        description: `Mutates the workflow canvas in a single atomic operation. This tool replaces the old sequential add_node/add_connection pattern.

CAPABILITIES:
- Add multiple nodes and edges at once
- Update existing node configurations  
- Remove nodes and edges by ID

USAGE:
1. Analyze the CURRENT CANVAS STATE provided in the system prompt
2. Use simple temporary IDs (e.g., "new_node_1", "new_node_2") for nodes you're creating
3. When connecting new nodes, use those same temporary IDs
4. When connecting to/from EXISTING nodes on canvas, use their exact UUID from the canvas state
5. The server will automatically map your temporary IDs to permanent UUIDs

EXAMPLES:
Create new workflow: mutate_workflow({ add_nodes: [...], add_edges: [...] })
Add to existing: mutate_workflow({ add_nodes: [{id: "new_prompt", ...}], add_edges: [{source: "new_prompt", target: "existing-uuid-123", ...}] })
Update node: mutate_workflow({ update_nodes: [{id: "existing-uuid", data: {config: {...}}}] })
Remove items: mutate_workflow({ remove_nodes: ["uuid1", "uuid2"], remove_edges: ["edge-uuid"] })`,
        
        inputSchema: z.object({
            add_nodes: z.array(z.object({
                id: z.string().describe('Use simple IDs for NEW nodes (e.g., "new_node_1", "prompt", "generator"). Server generates UUIDs.'),
                type: z.string().describe('Node type: "prompt", "compositor", "media_input", or "ai_generator"'),
                node_type_id: z.string().optional().describe('REQUIRED when type="ai_generator". The sub-category like "image_generation", "remove_background".'),
                model_id: z.number().optional().describe('REQUIRED when type="ai_generator". The specific model ID.'),
                position: z.object({
                    x: z.number().describe('X coordinate. Space 400px apart. Layers: inputs (0-400), processing (600-1000), outputs (1200+)'),
                    y: z.number().describe('Y coordinate. Main flow: 100, top branch: -200, bottom: 400')
                }),
                data: z.object({
                    config: z.any()
                }).describe(`Node configuration. Must match schema:\n\n${cleanNodesDocs}`)
            })).optional().default([]),
            
            add_edges: z.array(z.object({
                source: z.string().describe('Source node ID. Use temporary ID for new nodes, exact UUID for existing nodes.'),
                target: z.string().describe('Target node ID. Use temporary ID for new nodes, exact UUID for existing nodes.'),
                sourceHandle: z.string().optional().describe('Source output handle (usually omitted)'),
                targetHandle: z.string().optional().describe('Target input handle. ai_generator: "prompt"/"image", compositor: "layer_0"/"layer_1"')
            })).optional().default([]),
            
            update_nodes: z.array(z.object({
                id: z.string().describe('Existing node UUID from canvas state'),
                data: z.object({
                    config: z.any().optional()
                }).describe('Fields to merge into node data')
            })).optional().default([]),
            
            remove_nodes: z.array(z.string()).optional().default([]).describe('Array of node UUIDs to remove'),
            remove_edges: z.array(z.string()).optional().default([]).describe('Array of edge IDs to remove')
        }),
        
        execute: async (args) => {
            try {
                console.log('🔧 mutate_workflow execute called with:', JSON.stringify(args, null, 2));
                
                // Create mapping from temporary semantic IDs to permanent UUIDs
                const idMap = new Map<string, string>();
                
                // Generate UUIDs for all new nodes and transform node types
                const resolvedNodes = args.add_nodes.map(node => {
                    const uuid = crypto.randomUUID();
                    idMap.set(node.id, uuid);
                    
                    // ✅ CRITICAL FIX: When type="ai_generator" and node_type_id exists,
                    // the actual type should be the node_type_id (e.g., "image_generation")
                    // This makes the dynamic nodes render with their specific UI
                    const actualType = (node.type === 'ai_generator' && node.node_type_id) 
                        ? node.node_type_id 
                        : node.type;
                    
                    console.log(`  ID mapping: "${node.id}" → "${uuid}" | Type: "${node.type}" → "${actualType}"`);
                    
                    // ✅ CRITICAL FIX: Move node_type_id and model_id into data.config
                    // The AIGeneratorNode component expects them at data.config.node_type_id
                    const enhancedData = {
                        ...node.data,
                        config: {
                            ...node.data?.config,
                            ...(node.node_type_id && { node_type_id: node.node_type_id }),
                            ...(node.model_id && { model_id: node.model_id })
                        }
                    };
                    
                    return {
                        ...node,
                        id: uuid,
                        type: actualType,
                        data: enhancedData
                    };
                });
                
                // Resolve edge IDs: if source/target is in the map, use UUID; otherwise assume it's existing
                const resolvedEdges = args.add_edges.map(edge => {
                    const resolvedSource = idMap.get(edge.source) || edge.source;
                    const resolvedTarget = idMap.get(edge.target) || edge.target;
                    console.log(`  Edge: "${edge.source}" → "${resolvedSource}", "${edge.target}" → "${resolvedTarget}"`);
                    return {
                        ...edge,
                        id: crypto.randomUUID(),
                        source: resolvedSource,
                        target: resolvedTarget
                    };
                });
                
                const patch = {
                    addedNodes: resolvedNodes,
                    addedEdges: resolvedEdges,
                    updatedNodes: args.update_nodes,
                    removedNodeIds: args.remove_nodes,
                    removedEdgeIds: args.remove_edges
                };
                
                console.log('✅ Tool execute returning patch:', JSON.stringify(patch, null, 2));
                
                // Return the patch object
                return {
                    success: true,
                    patch
                };
            } catch (error) {
                console.error('❌ Tool execute error:', error);
                return {
                    success: false,
                    error: String(error)
                };
            }
        }
    })
};

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { messages, sessionId, previousWorkflow, attachedImages } = body;

        const supabase = createServiceClient();
        
        // 🔥 FETCH MODEL CATALOG (same as node window uses)
        const { data: modelsData } = await supabase
            .from('ai_models')
            .select('id, display_name, category_id, node_type_id, inputs_schema, outputs_schema, replicate_model_id, providers(name)')
            .eq('is_active', true)
            .order('display_name');
        
        const { data: categoriesData } = await supabase
            .from('categories')
            .select('id, display_name')
            .order('display_name');
        
        const { data: nodeTypesData } = await supabase
            .from('node_types')
            .select('id, display_name, parent_categories')
            .order('display_name');

        // Save the new user message to DB
        if (sessionId && messages && messages.length > 0) {
            const lastUserMsg = messages[messages.length - 1];
            if (lastUserMsg.type === 'user') {
                await supabase.from('messages').insert({
                    session_id: sessionId,
                    role: 'user',
                    content: lastUserMsg.content,
                    status: 'completed',
                    created_at: new Date().toISOString()
                });
            }
        }

        // Build the sliding window context
        const chatWindow = (messages || [])
            .filter((m: any) => m.content && m.content.trim().length > 0)
            .slice(-8);

        const mappedHistory = chatWindow.map((m: any) => ({
            role: (m.role || m.type) === 'assistant' ? 'assistant' : 'user',
            content: m.content
        }));

        let workflowContext = "";
        if (previousWorkflow && previousWorkflow.nodes && previousWorkflow.nodes.length > 0) {
            const nodeList = previousWorkflow.nodes.map((n: any) => `  - ID: "${n.id}", Type: ${n.type}`).join('\n');
            workflowContext = `\nCURRENT CANVAS STATE:
Existing Nodes:
${nodeList}

Full State: ${JSON.stringify({ nodes: previousWorkflow.nodes, edges: previousWorkflow.edges })}`;
        }

        let imagesContext = "";
        if (attachedImages && attachedImages.length > 0) {
            imagesContext = `\nUSER ATTACHED IMAGES: The user attached ${attachedImages.length} image(s). Ensure you add a media_input node.`;
        }

        // Lightweight list of available nodes for the chat prompt
        const availableNodes = Object.keys(sharedRegistry).join(', ');
        
        // 🔥 FORMAT MODEL CATALOG FOR AI - Group by Node Type (Sub-category)
        const nodeTypesCatalog = (nodeTypesData || []).map(nt => {
            const modelsForType = (modelsData || []).filter(m => m.node_type_id === nt.id);
            const modelsList = modelsForType.map(m => 
                `      • Model ID: ${m.id} - ${m.display_name}${m.providers && typeof m.providers === 'object' && 'name' in m.providers ? ` (${(m.providers as any).name})` : ''}`
            ).join('\n');
            
            return `  - Node Type: "${nt.id}" (${nt.display_name})
${modelsList || '      (No models available)'}`;
        }).join('\n\n');
        
        const categoriesList = (categoriesData || []).map(c => `${c.display_name} (${c.id})`).join(', ');

        // 2. BEHAVIORAL SYSTEM PROMPT
        const systemPrompt = `You are Prism, an AI assistant that helps users build visual workflows through natural conversation.

        YOU CAN:
        - Chat naturally and answer questions about workflows, automation, or AI models
        - Build and modify workflows on the canvas using the mutate_workflow tool
        - Understand user intent and act on simple requests immediately
        - Ask for clarification only when the request is genuinely ambiguous or complex

        WORKFLOW TOOL (mutate_workflow):
        - For NEW nodes: use simple temporary IDs like "node_1", "node_2"
        - For EXISTING nodes: use their exact UUID from the canvas state below
        - Include all changes (additions, updates, removals) in ONE tool call
        - For AI model nodes: use type="ai_generator" with node_type_id and model_id
        
        CANVAS POSITIONING:
        - Input nodes: x = 0-400
        - Processing nodes: x = 600-1000  
        - Output nodes: x = 1200+
        - Space nodes 400px apart horizontally
        - Vertical: Main flow (y=100), branches (y=-200 or y=400)

        BE NATURAL:
        - For simple requests: Just do it and briefly confirm what you did
        - For complex requests: Ask questions if you need clarity
        - Always respond with text - never just use a tool silently
        - Be friendly and conversational
        
        AVAILABLE CATEGORIES: ${categoriesList}
        
        DYNAMIC NODE TYPES (AI models grouped by capability):
${nodeTypesCatalog}
        
        STATIC NODE TYPES: prompt, compositor, media_input
        ${workflowContext}
        ${imagesContext}`;

        const stream = new ReadableStream({
            start(controller) {
                const encoder = new TextEncoder();
                let isClientConnected = true;

                waitUntil((async () => {
                    let finalContent = "";
                    let appliedPatch: any = null; // Track the final patch that was applied
                    let hasContent = false;

                    try {
                        const result = streamText({
                            model: google('gemini-2.5-flash'),
                            system: systemPrompt,
                            messages: mappedHistory,
                            tools: prismTools,
                        });

                        for await (const part of result.fullStream as any) {
                            if (!isClientConnected) break;

                            // Log all part types for debugging
                            if (part.type !== 'text-delta') {
                                console.log(`📡 Stream event type: ${part.type}`, part.toolName || '');
                            }

                            // 3. SEPARATED STREAMING LOGIC
                            if (part.type === 'text-delta') {
                                const textChunk = part.textDelta || part.text || "";
                                if (textChunk) {
                                    hasContent = true;
                                    finalContent += textChunk;

                                    try {
                                        controller.enqueue(encoder.encode(JSON.stringify({ type: 'text', content: textChunk }) + '\n'));
                                    } catch (e) { isClientConnected = false; }
                                }
                            }
                            else if (part.type === 'tool-call') {
                                // Log tool calls to see if AI is calling the tool
                                console.log('🔧 Tool called:', part.toolName, 'with args:', JSON.stringify(part.args, null, 2));
                                hasContent = true;
                            }
                            else if (part.type === 'tool-result') {
                                hasContent = true;

                                if (part.toolName === 'mutate_workflow') {
                                    console.log('🔍 Tool result received:', JSON.stringify(part, null, 2));
                                    
                                    // The result is in part.output (not part.result)
                                    const result = (part as any).output || (part as any).result;
                                    
                                    if (!result) {
                                        console.error('❌ Tool result is undefined:', part);
                                        controller.enqueue(encoder.encode(JSON.stringify({
                                            type: 'error',
                                            content: '⚠️ Tool execution returned no result.'
                                        }) + '\n'));
                                        continue;
                                    }
                                    
                                    console.log('✅ Result extracted:', JSON.stringify(result, null, 2));
                                    
                                    // Check if result has the expected structure
                                    if (result.success && result.patch) {
                                        appliedPatch = result.patch;
                                        
                                        console.log('✅ mutate_workflow applied:', JSON.stringify(appliedPatch, null, 2));
                                        
                                        // Stream the patch to the client
                                        try {
                                            controller.enqueue(encoder.encode(JSON.stringify({
                                                type: 'tool',
                                                name: 'mutate_workflow',
                                                patch: appliedPatch
                                            }) + '\n'));
                                        } catch (e) { isClientConnected = false; }
                                    } else {
                                        console.error('❌ Unexpected result structure:', result);
                                        controller.enqueue(encoder.encode(JSON.stringify({
                                            type: 'error',
                                            content: '⚠️ Tool execution returned invalid structure.'
                                        }) + '\n'));
                                    }
                                }
                            }
                        }

                        if (!hasContent && isClientConnected) {
                            controller.enqueue(encoder.encode(JSON.stringify({
                                type: 'error',
                                content: "I'm sorry, I couldn't generate a response. Please try again."
                            }) + '\n'));
                        }

                        // Save assistant response to DB
                        if (sessionId && hasContent) {
                            if (finalContent) {
                                await supabase.from('messages').insert({
                                    session_id: sessionId,
                                    role: 'assistant',
                                    content: finalContent,
                                    status: 'completed',
                                    created_at: new Date(Date.now() + 1000).toISOString()
                                });
                            }

                            if (appliedPatch) {
                                // State merger: apply the patch to the previous workflow
                                const prevNodes = previousWorkflow?.nodes || [];
                                const prevEdges = previousWorkflow?.edges || [];

                                // 1. Filter out removed items
                                let mergedNodes = prevNodes.filter((node: any) => 
                                    !appliedPatch.removedNodeIds?.includes(node.id)
                                );
                                let mergedEdges = prevEdges.filter((edge: any) => 
                                    !appliedPatch.removedEdgeIds?.includes(edge.id)
                                );

                                // 1.5. Also remove edges connected to removed nodes
                                if (appliedPatch.removedNodeIds && appliedPatch.removedNodeIds.length > 0) {
                                    const removedNodeSet = new Set(appliedPatch.removedNodeIds);
                                    mergedEdges = mergedEdges.filter((edge: any) => 
                                        !removedNodeSet.has(edge.source) && !removedNodeSet.has(edge.target)
                                    );
                                    console.log('🗑️ [DB] Cleaned up edges connected to deleted nodes');
                                }

                                // 2. Apply updates to existing nodes
                                if (appliedPatch.updatedNodes && appliedPatch.updatedNodes.length > 0) {
                                    mergedNodes = mergedNodes.map((node: any) => {
                                        const update = appliedPatch.updatedNodes.find((u: any) => u.id === node.id);
                                        if (update) {
                                            return {
                                                ...node,
                                                data: {
                                                    ...node.data,
                                                    ...update.data,
                                                    config: {
                                                        ...node.data?.config,
                                                        ...update.data?.config
                                                    }
                                                }
                                            };
                                        }
                                        return node;
                                    });
                                }

                                // 3. Add new nodes and edges
                                if (appliedPatch.addedNodes) {
                                    mergedNodes = [...mergedNodes, ...appliedPatch.addedNodes];
                                }
                                if (appliedPatch.addedEdges) {
                                    mergedEdges = [...mergedEdges, ...appliedPatch.addedEdges];
                                }

                                // 4. Save the merged state
                                const updatedCanvasState = {
                                    nodes: mergedNodes,
                                    edges: mergedEdges
                                };

                                await supabase.from('sessions').update({
                                    canvas_state: updatedCanvasState,
                                    updated_at: new Date().toISOString()
                                }).eq('id', sessionId);
                            }
                        }

                    } catch (err) {
                        console.error("Background AI Error:", err);
                        if (isClientConnected) {
                            try {
                                controller.enqueue(encoder.encode(JSON.stringify({
                                    type: 'error',
                                    content: "Sorry, I encountered an internal error while building."
                                }) + '\n'));
                            } catch (e) { }
                        }
                        if (sessionId) {
                            await supabase.from('messages').insert({
                                session_id: sessionId,
                                role: 'assistant',
                                content: "Sorry, I encountered an internal error while building.",
                                status: 'error',
                                created_at: new Date(Date.now() + 1000).toISOString()
                            });
                        }
                    } finally {
                        if (isClientConnected) {
                            try { controller.close(); } catch (e) { }
                        }
                    }
                })());
            },
            cancel() { }
        });

        return new Response(stream, {
            headers: {
                'Content-Type': 'application/x-ndjson; charset=utf-8',
                'Cache-Control': 'no-cache, no-transform',
            },
        });

    } catch (error: any) {
        return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }
}