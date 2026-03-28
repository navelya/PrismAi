import { streamText, tool } from 'ai';
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
    build_workflow: tool({
        description: 'Generates or updates the entire workflow canvas. Call this ONLY when the user explicitly asks to create, modify, or add to a workflow.',
        inputSchema: z.object({
            name: z.string().describe('A short, creative name for this workflow.'),
            nodes: z.array(z.object({
                id: z.string(),
                type: z.string(),
                position: z.object({ x: z.number(), y: z.number() }),
                data: z.object({ config: z.any() })
            })).describe(`Array of workflow nodes. CRITICAL: You MUST populate data.config strictly according to these schemas for each node type:\n\n${cleanNodesDocs}`),
            edges: z.array(z.object({
                id: z.string(),
                source: z.string(),
                target: z.string(),
                sourceHandle: z.string(),
                targetHandle: z.string()
            })).describe('Array of workflow edges connecting the nodes. Ensure you use the exact sourceHandle and targetHandle IDs specified in the node docs.')
        })
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
        1. Chat Naturally: If the user asks a general question, respond conversationally. Do NOT generate a workflow.
        2. Think Aloud & Act: When the user asks you to build or modify a workflow, first reply with a brief text message explaining what you are about to do. Then, call the 'build_workflow' tool.
        3. Node Connections: For all image inputs, use "prompt_in" or the first available handle ID. NEVER use "images_in".
        
        AVAILABLE NODE TYPES: ${availableNodes}
        ${workflowContext}
        ${imagesContext}`;

        const result = streamText({
            model: google('gemini-2.5-flash'),
            system: systemPrompt,
            messages: mappedHistory,
            tools: prismTools,
        });

        const stream = new ReadableStream({
            start(controller) {
                const encoder = new TextEncoder();
                let isClientConnected = true;

                waitUntil((async () => {
                    let finalContent = "";
                    let finalWorkflow = null;
                    let workflowName = "";
                    let hasContent = false;

                    try {
                        for await (const part of result.fullStream as any) {
                            // 3. SEPARATED STREAMING LOGIC
                            if (part.type === 'text-delta') {
                                const textChunk = part.textDelta || part.text || "";
                                if (textChunk) hasContent = true;
                                finalContent += textChunk;

                                if (isClientConnected) {
                                    try {
                                        controller.enqueue(encoder.encode(JSON.stringify({ type: 'text', content: textChunk }) + '\n'));
                                    } catch (e) { isClientConnected = false; }
                                }
                            }
                            else if (part.type === 'tool-call') {
                                hasContent = true;
                                const args = part.args || part.input || {};
                                finalWorkflow = args;
                                workflowName = args.name || "";

                                if (isClientConnected) {
                                    try {
                                        controller.enqueue(encoder.encode(JSON.stringify({
                                            type: 'tool',
                                            name: part.toolName,
                                            workflow: args
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

                            if (finalWorkflow) {
                                const sessionUpdate: any = {
                                    canvas_state: finalWorkflow,
                                    updated_at: new Date().toISOString()
                                };

                                if (workflowName && workflowName !== 'New Workflow') {
                                    let officialTitle = workflowName.replace(/^Workflow:\s*/i, '');
                                    if (officialTitle.length > 2) {
                                        sessionUpdate.title = officialTitle;
                                    }
                                }

                                await supabase.from('sessions').update(sessionUpdate).eq('id', sessionId);
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