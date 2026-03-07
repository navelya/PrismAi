import { streamText } from 'ai';
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

// 👑 חזרנו לאובייקט נקי לחלוטין! בלי פונקציית tool(), בלי @ts-ignore
// 👑 אובייקט נקי לחלוטין! בלי tool(), בלי בעיות TypeScript.
// אבל הפעם - לא נותנים לו z.any(). מכריחים אותו לייצר את המבנה המדויק!
const prismTools: any = {
    build_workflow: {
        description: 'Create or modify a workflow canvas based on the user request. YOU MUST provide valid nodes and edges.',
        parameters: z.object({
            name: z.string().describe('CRITICAL: A short, creative name for this workflow.'),
            message: z.string().describe('MANDATORY: Your natural, short conversational response to the user explaining what you built.'),
            nodes: z.array(z.object({
                id: z.string(),
                type: z.string(),
                position: z.object({ x: z.number(), y: z.number() }),
                data: z.object({ config: z.any() }) // ההגדרות עצמן חופשיות כדי שישאב אותן מה-Registry
            })).describe('Array of workflow nodes. You MUST include id, type, position {x,y}, and data {config} for each node.'),
            edges: z.array(z.object({
                id: z.string(),
                source: z.string(),
                target: z.string(),
                sourceHandle: z.string(),
                targetHandle: z.string()
            })).describe('Array of workflow edges to connect the nodes.')
        })
    }
};

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { prompt, sessionId, previousWorkflow, attachedImages } = body;

        const supabase = createServiceClient();

        if (sessionId) {
            await supabase.from('messages').insert({
                session_id: sessionId,
                role: 'user',
                content: prompt,
                status: 'completed',
                created_at: new Date().toISOString()
            });
        }

        let workflowContext = "";
        if (previousWorkflow && previousWorkflow.nodes && previousWorkflow.nodes.length > 0) {
            workflowContext = `
            CURRENT WORKFLOW ON CANVAS:
            ${JSON.stringify({ nodes: previousWorkflow.nodes, edges: previousWorkflow.edges })}

            CRITICAL MODIFICATION RULE:
            You must return the ENTIRE updated workflow. Keep existing nodes/edges and just add/connect what the user asked for.`;
        }

        let imagesContext = "";
        if (attachedImages && attachedImages.length > 0) {
            imagesContext = `
            USER ATTACHED IMAGES:
            The user attached ${attachedImages.length} image(s). Ensure you add your media/upload node to handle them.`;
        }

        const cleanNodesContext = getCleanNodesContext();

        const result = streamText({
            model: google('gemini-2.5-flash'),
            system: `You are Prism AI - an advanced systems architect. 
            Your primary job is to help users automate tasks by creating visual node-based workflows.
            
            CAPABILITIES & AVAILABLE NODES:
            You can build workflows using ONLY these exact nodes:
            ${cleanNodesContext}

            ${workflowContext}
            ${imagesContext}

CRITICAL RULES:
            1. You MUST call the 'build_workflow' tool.
            2. EXPLAIN YOUR WORK: You MUST write a short, conversational explanation of the workflow you built INSIDE the tool's 'message' parameter. NEVER leave the message empty!
            3. You MUST provide a creative 'name' for the workflow inside the tool parameters.
            4. CONFIGURATIONS & LAYERS: You MUST populate settings inside 'data.config'. If a node uses dynamic items like 'layers', generate them in 'data.config'.
            5. CONNECTIONS: Connect nodes logically. For dynamic nodes (like compositor layers), invent logical targetHandles (e.g., 'layer_0') and force the connections!`,

            prompt: prompt,
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

                    try {
                        for await (const part of result.fullStream as any) {
                            if (part.type === 'text-delta') {
                                const textChunk = part.textDelta || part.text || "";
                                finalContent += textChunk;

                                if (isClientConnected) {
                                    try {
                                        controller.enqueue(encoder.encode(JSON.stringify({ type: 'text', content: textChunk }) + '\n'));
                                    } catch (e) { isClientConnected = false; }
                                }
                            }
                            else if (part.type === 'tool-call') {
                                const args = part.args || part.input || {};
                                finalWorkflow = args;
                                workflowName = args.name || "";

                                const toolMsg = args.message || "";

                                if (toolMsg && !finalContent.includes(toolMsg)) {
                                    finalContent = finalContent ? `${finalContent}\n\n${toolMsg}` : toolMsg;
                                }

                                if (isClientConnected) {
                                    try {
                                        controller.enqueue(encoder.encode(JSON.stringify({
                                            type: 'tool',
                                            name: part.toolName,
                                            message: toolMsg,
                                            workflow: args
                                        }) + '\n'));
                                    } catch (e) { isClientConnected = false; }
                                }
                            }
                        }

                        if (sessionId) {
                            await supabase.from('messages').insert({
                                session_id: sessionId,
                                role: 'assistant',
                                content: finalContent,
                                workflow: finalWorkflow,
                                metadata: finalWorkflow ? { type: 'workflow' } : { type: 'chat' },
                                status: 'completed',
                                created_at: new Date(Date.now() + 1000).toISOString()
                            });

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