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

// 1. PROPER TOOL DEFINITIONS
const prismTools = {
    generate_id: tool({
        description: `Generates a unique UUID for a new node. 
        
CRITICAL: Call this BEFORE creating each node to get a unique ID. You will use this ID when calling add_node and add_connection.

WORKFLOW:
1. Call generate_id() to get an ID
2. Store/remember that ID
3. Use it in add_node(id: <that_id>, ...)
4. Use it in add_connection(source: <that_id>, ...)`,
        inputSchema: z.object({}),  // No parameters needed
        execute: async () => {
            const id = crypto.randomUUID();
            return {
                id,
                message: `Generated ID: ${id}. Use this exact ID in add_node.`
            };
        }
    }),
    
    add_node: tool({
        description: `Adds exactly ONE node to the workflow canvas using a pre-generated ID.
        
CRITICAL: You MUST call generate_id() FIRST to get an ID, then provide that ID here. Do NOT skip generate_id().

Call this tool once per node. Do NOT call it in parallel — call it, wait for the result, then call it again for the next node.`,
        inputSchema: z.object({
            id: z.string().optional().describe('Node ID from generate_id() - a UUID like "550e8400-e29b-41d4-a716-446655440000". REQUIRED - call generate_id() first!'),
            type: z.string().describe('The type of node to add. Static types: "prompt", "compositor", "media_input". For AI models, ALWAYS use "ai_generator".'),
            node_type_id: z.string().optional().describe('REQUIRED when type is "ai_generator"! The node type ID (sub-category) like "image_generation", "remove_background". See DYNAMIC NODE TYPES section.'),
            model_id: z.number().optional().describe('REQUIRED when type is "ai_generator"! The specific model ID to use. Must belong to the node_type_id. See DYNAMIC NODE TYPES section for available models.'),
            position: z.object({
                x: z.number().describe('X coordinate. Space nodes 400px apart horizontally. Use layers: inputs (x:0-400), processing (x:600-1000), outputs (x:1200+).'),
                y: z.number().describe('Y coordinate. Main flow: y=100, top branch: y=-200, bottom branch: y=400.')
            }),
            data: z.object({
                config: z.any()
            }).describe(`CRITICAL: Populate config strictly according to the schema for the requested node type:\n\n${cleanNodesDocs}`)
        }),
        execute: async (args) => {
            return {
                success: true,
                nodeId: args.id,
                message: `Node ${args.id} of type ${args.type} scheduled for creation.`
            };
        }
    }),
    
    add_connection: tool({
        description: `Creates a connection (edge) between two nodes in the workflow.

CRITICAL RULES:
- Both source and target nodes MUST already exist (you created them with add_node)
- Use the EXACT node IDs from generate_id() (UUIDs like "a1b2c3d4-...")
- Specify targetHandle for nodes with multiple inputs (e.g., "image", "text", "prompt")
- For simple single-input nodes, targetHandle can be omitted
- Cannot create self-connections (source === target)
- Cannot connect incompatible types (image to text, etc.)

EXAMPLES:
✅ add_connection(source: "uuid-1234-...", target: "uuid-5678-...", targetHandle: "prompt")
✅ add_connection(source: "uuid-5678-...", target: "uuid-9012-...")
❌ add_connection(source: "node_1", target: "node_2") // Wrong - must use UUIDs from generate_id`,
        
        inputSchema: z.object({
            source: z.string().describe('Source node ID (the UUID from generate_id)'),
            target: z.string().describe('Target node ID (the UUID from generate_id)'),
            sourceHandle: z.string().optional().describe('Source output handle ID (usually can be omitted)'),
            targetHandle: z.string().optional().describe('Target input handle ID (REQUIRED for multi-input nodes like text_overlay, compositor)')
        }),
        
        execute: async (args) => {
            return {
                success: true,
                message: `Connection from ${args.source} to ${args.target} scheduled.`
            };
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
            const nodeList = previousWorkflow.nodes.map(n => `  - ID: "${n.id}", Type: ${n.type}`).join('\n');
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
                `      • Model ID: ${m.id} - ${m.display_name}${m.providers ? ` (${m.providers.name})` : ''}`
            ).join('\n');
            
            return `  - Node Type: "${nt.id}" (${nt.display_name})
${modelsList || '      (No models available)'}`;
        }).join('\n\n');
        
        const categoriesList = (categoriesData || []).map(c => `${c.display_name} (${c.id})`).join(', ');

        // 2. BEHAVIORAL SYSTEM PROMPT
        const systemPrompt = `You are Prism, an advanced systems architect helping users automate tasks via visual node-based workflows.

        YOUR WORKSPACE:
        - Chat: Use standard text to answer questions, brainstorm, or explain concepts.
        - Canvas: Use your tools to build or modify the actual workflow.

        WORKFLOW BUILDING PROCESS (3-PHASE APPROACH):
        
        PHASE 0 - Generate Node IDs:
        - Call generate_id() for EACH node you plan to create
        - Store these IDs - you'll use them in Phase 1 and Phase 2
        - Example: id_prompt = generate_id() → returns {id: "550e8400-e29b-..."}
        
        PHASE 1 - Create ALL Nodes:
        - Use add_node with the IDs from Phase 0
        - add_node(id: <id_from_phase_0>, type: "...", position: {...}, data: {...})
        - Position nodes in logical layers:
          * Input nodes (prompts, media): x = 0-400
          * Processing nodes (generators, transformers): x = 600-1000  
          * Output nodes: x = 1200+
        - Space nodes 400px apart horizontally (x: 0, 400, 800, etc.)
        - Use Y-axis for parallel branches:
          * Main flow: y = 100
          * Top branch: y = -200
          * Bottom branch: y = 400
        - Call add_node sequentially, one at a time (NEVER in parallel)
        
        PHASE 2 - Create ALL Connections:
        - Use add_connection with the IDs from Phase 0
        - add_connection(source: <id_from_phase_0>, target: <id_from_phase_0>, ...)
        - Specify targetHandle for nodes with multiple inputs:
          * text_overlay: targetHandle "image" or "text"
          * compositor: targetHandle "layer_0", "layer_1", etc.
          * ai_generator: targetHandle "prompt" or "image"
        - For simple single-input nodes, targetHandle can be omitted
        - Call add_connection sequentially, one at a time

        COMPLETE EXAMPLE:
        User: "Create a text-to-image workflow"
        
        You: "Sure! Creating a 2-node text-to-image workflow."
        
        // PHASE 0: Generate IDs
        generate_id() → {id: "550e8400-e29b-41d4-a716-446655440000"}  // Store as id_prompt
        generate_id() → {id: "6ba7b810-9dad-11d1-80b4-00c04fd430c8"}  // Store as id_generator
        
        // PHASE 1: Create nodes with those IDs
        add_node(id: "550e8400-e29b-41d4-a716-446655440000", type: "prompt", position: {x: 0, y: 100}, data: {config: {text: ""}})
        add_node(id: "6ba7b810-9dad-11d1-80b4-00c04fd430c8", type: "ai_generator", node_type_id: "image_generation", model_id: 123, position: {x: 500, y: 100}, data: {config: {}})
        
        // PHASE 2: Connect using those IDs
        add_connection(source: "550e8400-e29b-41d4-a716-446655440000", target: "6ba7b810-9dad-11d1-80b4-00c04fd430c8", targetHandle: "prompt")
        
        You: "Workflow complete! Ready to execute."

        RULES OF ENGAGEMENT:
        1. Chat Naturally: If the user asks a general question, respond conversationally via text. Do NOT generate a workflow.
        2. Workflow Introduction: When building a workflow, give ONE brief intro (e.g. "Sure! Creating a 5-node workflow."). Then proceed with Phase 0 → Phase 1 → Phase 2. Give a SHORT completion summary at the end.
        3. Sequential ONLY: NEVER call tools in parallel. Always wait for one tool result before calling the next.
        4. Handle IDs: Always check the node type's input/output handles (provided below). Use exact handle IDs.
        5. **ID Management: ALWAYS use generate_id() first, then use those exact UUIDs. NEVER make up IDs.**
        6. **Dynamic Nodes: For AI models, use type="ai_generator" with node_type_id and model_id. Pick the best model for the task.**
        
        AVAILABLE CATEGORIES: ${categoriesList}
        
        DYNAMIC NODE TYPES (Sub-categories with available models):
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
                    let newlyAddedNodes: any[] = []; // Track nodes created in this specific session
                    let newlyAddedEdges: any[] = []; // Track edges created in this specific session
                    let hasContent = false;

                    try {
                        const result = streamText({
                            model: google('gemini-2.5-flash'),
                            system: systemPrompt,
                            messages: mappedHistory,
                            tools: prismTools,
                            maxToolRoundtrips: 25,  // Allow multiple tool calls with results fed back
                            stopWhen: stepCountIs(50),
                        });

                        for await (const part of result.fullStream as any) {
                            if (!isClientConnected) break;

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
                                hasContent = true;

                                if (part.toolName === 'generate_id') {
                                    // Just a notification - the ID is already returned by execute()
                                    // No need to stream anything to UI for ID generation
                                    continue;
                                }
                                else if (part.toolName === 'add_node') {
                                    const aiArgs = part.args || part.input || {};

                                    // AI provides the ID from generate_id()
                                    let nodeId = aiArgs.id;
                                    
                                    // TEMPORARY DEBUG: Generate fallback ID if not provided
                                    if (!nodeId) {
                                        nodeId = crypto.randomUUID();
                                        console.log(`⚠️ AI did NOT provide node ID. Generated fallback: ${nodeId}`);
                                        // Stream warning to UI
                                        controller.enqueue(encoder.encode(JSON.stringify({
                                            type: 'error',
                                            content: `⚠️ Warning: AI did not call generate_id() first. Using fallback ID.`
                                        }) + '\n'));
                                    } else {
                                        console.log(`✅ AI provided node ID: ${nodeId}`);
                                    }
                                    
                                    // Validate UUID format
                                    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                                    if (!uuidRegex.test(nodeId)) {
                                        controller.enqueue(encoder.encode(JSON.stringify({
                                            type: 'error',
                                            content: `Invalid node ID format: "${nodeId}". Must be a valid UUID.`
                                        }) + '\n'));
                                        continue;
                                    }
                                    
                                    // Check for duplicate IDs
                                    const allNodes = [...(previousWorkflow?.nodes || []), ...newlyAddedNodes];
                                    if (allNodes.some(n => n.id === nodeId)) {
                                        controller.enqueue(encoder.encode(JSON.stringify({
                                            type: 'error',
                                            content: `Node ID "${nodeId}" already exists. Generate a new ID with generate_id().`
                                        }) + '\n'));
                                        continue;
                                    }

                                    // 🔥 HANDLE DYNAMIC AI_GENERATOR NODES
                                    let nodeData = aiArgs.data;
                                    let nodeType = aiArgs.type;
                                    
                                    if (aiArgs.type === 'ai_generator') {
                                        // Validate required parameters
                                        if (!aiArgs.node_type_id) {
                                            console.error(`❌ AI did not provide node_type_id for ai_generator node`);
                                            controller.enqueue(encoder.encode(JSON.stringify({
                                                type: 'error',
                                                content: `⚠️ ai_generator nodes require node_type_id (e.g., "image_generation"). See DYNAMIC NODE TYPES section.`
                                            }) + '\n'));
                                            continue;
                                        }
                                        
                                        if (!aiArgs.model_id) {
                                            console.error(`❌ AI did not provide model_id for ai_generator node`);
                                            controller.enqueue(encoder.encode(JSON.stringify({
                                                type: 'error',
                                                content: `⚠️ ai_generator nodes require model_id. See available models under node type "${aiArgs.node_type_id}".`
                                            }) + '\n'));
                                            continue;
                                        }
                                        
                                        // Fetch the full model configuration
                                        const { data: modelData } = await supabase
                                            .from('ai_models')
                                            .select('*')
                                            .eq('id', aiArgs.model_id)
                                            .single();
                                        
                                        if (!modelData) {
                                            console.error(`❌ Model ID ${aiArgs.model_id} not found`);
                                            controller.enqueue(encoder.encode(JSON.stringify({
                                                type: 'error',
                                                content: `Model ID ${aiArgs.model_id} not found. Please select a valid model from the catalog.`
                                            }) + '\n'));
                                            continue;
                                        }
                                        
                                        // Validate model belongs to the specified node type
                                        if (modelData.node_type_id !== aiArgs.node_type_id) {
                                            console.error(`❌ Model ${aiArgs.model_id} does not belong to node type ${aiArgs.node_type_id}`);
                                            controller.enqueue(encoder.encode(JSON.stringify({
                                                type: 'error',
                                                content: `Model "${modelData.display_name}" does not belong to node type "${aiArgs.node_type_id}". It belongs to "${modelData.node_type_id}".`
                                            }) + '\n'));
                                            continue;
                                        }
                                        
                                        console.log(`✅ AI selected: ${modelData.display_name} (ID: ${modelData.id}) for node type: ${aiArgs.node_type_id}`);
                                        
                                        // Populate node data matching the manual drag behavior
                                        nodeData = {
                                            config: {
                                                node_type_id: aiArgs.node_type_id,
                                                model_id: modelData.id,
                                                control_values: aiArgs.data?.config?.control_values || {},
                                            }
                                        };
                                    }

                                    // Assemble the safe node object
                                    const safeNodePayload = {
                                        id: nodeId,
                                        type: nodeType,
                                        position: aiArgs.position,
                                        data: nodeData,
                                        serverTime: Date.now()
                                    };

                                    // Keep track of it for the database update later
                                    newlyAddedNodes.push(safeNodePayload);

                                    // Stream the single node immediately to the UI
                                    try {
                                        controller.enqueue(encoder.encode(JSON.stringify({
                                            type: 'tool',
                                            name: 'add_node',
                                            workflow: safeNodePayload
                                        }) + '\n'));
                                    } catch (e) { isClientConnected = false; }
                                }
                                else if (part.toolName === 'add_connection') {
                                    const aiArgs = part.args || {};
                                    
                                    // 🔍 DEBUG: Log what AI is actually sending
                                    console.log('🔗 AI called add_connection with:', JSON.stringify(aiArgs, null, 2));
                                    
                                    // VALIDATION 1: Check nodes exist
                                    const allNodes = [...(previousWorkflow?.nodes || []), ...newlyAddedNodes];
                                    console.log('📦 Available nodes:', allNodes.map(n => n.id));
                                    
                                    const sourceNode = allNodes.find(n => n.id === aiArgs.source);
                                    const targetNode = allNodes.find(n => n.id === aiArgs.target);
                                    
                                    if (!sourceNode || !targetNode) {
                                        controller.enqueue(encoder.encode(JSON.stringify({
                                            type: 'error',
                                            content: `Cannot connect: ${!sourceNode ? 'source' : 'target'} node "${!sourceNode ? aiArgs.source : aiArgs.target}" not found`
                                        }) + '\n'));
                                        continue;
                                    }
                                    
                                    // VALIDATION 2: Prevent self-connections
                                    if (aiArgs.source === aiArgs.target) {
                                        controller.enqueue(encoder.encode(JSON.stringify({
                                            type: 'error',
                                            content: `Cannot create self-connection on node ${aiArgs.source}`
                                        }) + '\n'));
                                        continue;
                                    }
                                    
                                    // VALIDATION 3: Auto-detect handles if not specified
                                    let sourceHandle = aiArgs.sourceHandle;
                                    let targetHandle = aiArgs.targetHandle;
                                    
                                    // Auto-detect source handle
                                    if (!sourceHandle) {
                                        const sourceDef = sharedRegistry[sourceNode.type];
                                        const outputs = sourceDef?.handles?.outputs || [];
                                        if (outputs.length === 1) {
                                            sourceHandle = outputs[0].id;
                                        } else if (outputs.length > 1) {
                                            sourceHandle = outputs[0].id;
                                        }
                                    }
                                    
                                    // Auto-detect target handle
                                    if (!targetHandle) {
                                        const targetDef = sharedRegistry[targetNode.type];
                                        const inputs = targetDef?.handles?.inputs || [];
                                        if (inputs.length === 1) {
                                            targetHandle = inputs[0].id;
                                        } else if (inputs.length > 1) {
                                            // Find first available input (not already connected)
                                            const existingEdges = [...(previousWorkflow?.edges || []), ...newlyAddedEdges];
                                            const availableInput = inputs.find(inp => {
                                                const alreadyConnected = existingEdges.some(e => 
                                                    e.target === aiArgs.target && e.targetHandle === inp.id
                                                );
                                                return !alreadyConnected;
                                            });
                                            targetHandle = availableInput?.id || inputs[0].id;
                                        }
                                    }
                                    
                                    // VALIDATION 4: Check handles exist
                                    const sourceDef = sharedRegistry[sourceNode.type];
                                    const targetDef = sharedRegistry[targetNode.type];
                                    
                                    const sourceHandleExists = sourceDef?.handles?.outputs?.some(o => o.id === sourceHandle);
                                    const targetHandleExists = targetDef?.handles?.inputs?.some(i => i.id === targetHandle);
                                    
                                    if (!sourceHandleExists || !targetHandleExists) {
                                        controller.enqueue(encoder.encode(JSON.stringify({
                                            type: 'error',
                                            content: `Invalid handle: ${!sourceHandleExists ? 'source' : 'target'} handle "${!sourceHandleExists ? sourceHandle : targetHandle}" not found on ${!sourceHandleExists ? sourceNode.type : targetNode.type}`
                                        }) + '\n'));
                                        continue;
                                    }
                                    
                                    // VALIDATION 5: Type compatibility (basic check)
                                    const sourceHandleDef = sourceDef?.handles?.outputs?.find(o => o.id === sourceHandle);
                                    const targetHandleDef = targetDef?.handles?.inputs?.find(i => i.id === targetHandle);
                                    
                                    const sourceType = String(sourceHandleDef?.dataType || 'any').toLowerCase();
                                    const targetType = String(targetHandleDef?.expectedType || 'any').toLowerCase();
                                    
                                    if (sourceType !== 'any' && targetType !== 'any') {
                                        const normSource = sourceType.replace('_array', '');
                                        const normTarget = targetType.replace('_array', '');
                                        if (normSource !== normTarget) {
                                            controller.enqueue(encoder.encode(JSON.stringify({
                                                type: 'error',
                                                content: `Type mismatch: Cannot connect ${sourceType} to ${targetType}`
                                            }) + '\n'));
                                            continue;
                                        }
                                    }
                                    
                                    // Generate edge ID (same pattern as React Flow)
                                    const handleSuffix = targetHandle ? `-${targetHandle}` : '';
                                    const edgeId = `${aiArgs.source}->${aiArgs.target}${handleSuffix}`;
                                    
                                    // Check for duplicate
                                    const existingEdges = [...(previousWorkflow?.edges || []), ...newlyAddedEdges];
                                    if (existingEdges.some(e => e.id === edgeId)) {
                                        controller.enqueue(encoder.encode(JSON.stringify({
                                            type: 'error',
                                            content: `Connection already exists between these nodes`
                                        }) + '\n'));
                                        continue;
                                    }
                                    
                                    // Create the edge
                                    const safeEdgePayload = {
                                        id: edgeId,
                                        source: aiArgs.source,
                                        target: aiArgs.target,
                                        sourceHandle: sourceHandle || null,
                                        targetHandle: targetHandle || null,
                                        serverTime: Date.now()
                                    };
                                    
                                    // Track it for database update
                                    newlyAddedEdges.push(safeEdgePayload);
                                    
                                    // Stream to UI immediately
                                    try {
                                        controller.enqueue(encoder.encode(JSON.stringify({
                                            type: 'tool',
                                            name: 'add_connection',
                                            edge: safeEdgePayload
                                        }) + '\n'));
                                    } catch (e) { isClientConnected = false; }
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

                            if (newlyAddedNodes.length > 0 || newlyAddedEdges.length > 0) {
                                const existingNodes = previousWorkflow?.nodes || [];
                                const existingEdges = previousWorkflow?.edges || [];

                                const updatedCanvasState = {
                                    nodes: [...existingNodes, ...newlyAddedNodes],
                                    edges: [...existingEdges, ...newlyAddedEdges]
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