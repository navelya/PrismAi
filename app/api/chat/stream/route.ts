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

// 1. PROPER TOOL DEFINITION
// Dynamic schema docs are injected directly into the Zod description.
const prismTools = {
    add_node: tool({
        description: 'Adds exactly ONE node to the workflow canvas. Call this tool once per node. Do NOT call it in parallel — call it, wait for the result, then call it again for the next node.',
        inputSchema: z.object({
            type: z.string().describe('The type of node to add (e.g., "prompt", "compositor", "media_input").'),
            position: z.object({
                x: z.number().describe('X coordinate. Space nodes out logically to prevent overlapping.'),
                y: z.number().describe('Y coordinate. Keep them roughly aligned.')
            }),
            data: z.object({
                config: z.any()
            }).describe(`CRITICAL: Populate config strictly according to the schema for the requested node type:\n\n${cleanNodesDocs}`)
        }),
        execute: async (args) => {
            return {
                success: true,
                message: `Node successfully scheduled to be added to the canvas.`
            };
        }
    })
};

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { messages, sessionId, previousWorkflow, attachedImages } = body;

        const supabase = createServiceClient();

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
            workflowContext = `\nCURRENT CANVAS STATE:\n${JSON.stringify({ nodes: previousWorkflow.nodes, edges: previousWorkflow.edges })}`;
        }

        let imagesContext = "";
        if (attachedImages && attachedImages.length > 0) {
            imagesContext = `\nUSER ATTACHED IMAGES: The user attached ${attachedImages.length} image(s). Ensure you add a media_input node.`;
        }

        // Lightweight list of available nodes for the chat prompt
        const availableNodes = Object.keys(sharedRegistry).join(', ');

        // 2. BEHAVIORAL SYSTEM PROMPT
        const systemPrompt = `You are Prism, an advanced systems architect helping users automate tasks via visual node-based workflows.

        YOUR WORKSPACE:
        - Chat: Use standard text to answer questions, brainstorm, or explain concepts.
        - Canvas: Use your tools to build or modify the actual workflow.

        RULES OF ENGAGEMENT:
        1. Chat Naturally: If the user asks a general question, respond conversationally via text. Do NOT generate a workflow.
        2. One intro, then tools: When the user asks you to build a workflow, give a SINGLE brief intro message (e.g. "Sure! Adding 10 nodes now."). Then call add_node repeatedly — one call per step — until done. Do NOT add commentary between tool calls. After all nodes are added, give a SHORT completion summary.
        3. Sequential ONLY: NEVER call add_node in parallel. Call it EXACTLY ONCE per step, wait for the result, then call it again for the next node.
        4. Node Connections: For all image inputs, use "prompt_in" or the first available handle ID. NEVER use "images_in".
        
        AVAILABLE NODE TYPES: ${availableNodes}
        ${workflowContext}
        ${imagesContext}`;

        const stream = new ReadableStream({
            start(controller) {
                const encoder = new TextEncoder();
                let isClientConnected = true;

                waitUntil((async () => {
                    let finalContent = "";
                    let newlyAddedNodes: any[] = []; // Track nodes created in this specific session
                    let hasContent = false;
                    let lastToolCallTime = 0; // Track timing for server-side throttling

                    try {
                        const result = streamText({
                            model: google('gemini-2.5-flash'),
                            system: systemPrompt,
                            messages: mappedHistory,
                            tools: prismTools,
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

                                if (part.toolName === 'add_node') {
                                    // SERVER-SIDE THROTTLING: Enforce minimum 400ms between node additions
                                    const now = Date.now();
                                    const timeSinceLastCall = now - lastToolCallTime;
                                    const minimumDelay = 400;
                                    
                                    if (lastToolCallTime > 0 && timeSinceLastCall < minimumDelay) {
                                        const waitTime = minimumDelay - timeSinceLastCall;
                                        await new Promise(r => setTimeout(r, waitTime));
                                    }
                                    lastToolCallTime = Date.now();

                                    const aiArgs = part.args || part.input || {};

                                    // 1. SERVER generates the secure UUID
                                    const realNodeId = crypto.randomUUID();

                                    // 2. Assemble the safe node object
                                    const safeNodePayload = {
                                        id: realNodeId,
                                        type: aiArgs.type,
                                        position: aiArgs.position,
                                        data: aiArgs.data,
                                        serverTime: Date.now() // Add timestamp for client tracking
                                    };

                                    // 3. Keep track of it for the database update later
                                    newlyAddedNodes.push(safeNodePayload);

                                    // 5. Stream the single node immediately to the UI
                                    try {
                                        controller.enqueue(encoder.encode(JSON.stringify({
                                            type: 'tool',
                                            name: 'add_node',
                                            workflow: safeNodePayload
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

                            if (newlyAddedNodes.length > 0) {
                                const existingNodes = previousWorkflow?.nodes || [];
                                const existingEdges = previousWorkflow?.edges || [];

                                const updatedCanvasState = {
                                    nodes: [...existingNodes, ...newlyAddedNodes],
                                    edges: existingEdges // Edges remain untouched for now
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