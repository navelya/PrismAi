import { streamText, tool } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/service';
import { sharedRegistry } from '@/lib/nodes/core/shared-registry';
import { waitUntil } from '@vercel/functions';
import { Workflow } from '@/lib/nodes/types';
import { applyAddNodeOp, applyRemoveNodeOp, applyUpdateNodeOp } from '@/lib/workflow/graph-ops';
import { applyWorkflowPatch, createEmptyWorkflow, mergeWorkflowPatches, WorkflowPatch } from '@/lib/workflow/workflow-patch';

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
        console.error('Error reading registry:', e);
    }
    return nodesStr;
}

const cleanNodesDocs = getCleanNodesContext();
const nodeTypes = Object.keys(sharedRegistry) as [string, ...string[]];

function getBaseWorkflow(previousWorkflow: any): Workflow {
    if (previousWorkflow && Array.isArray(previousWorkflow.nodes) && Array.isArray(previousWorkflow.edges)) {
        return previousWorkflow as Workflow;
    }
    return createEmptyWorkflow();
}

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { messages, sessionId, previousWorkflow, attachedImages } = body;

        const supabase = createServiceClient();

        const [{ data: modelsData }, { data: categoriesData }, { data: nodeTypesData }] = await Promise.all([
            supabase.from('ai_models')
                .select('id, display_name, category_id, node_type_id, inputs_schema, outputs_schema, replicate_model_id, providers(name)')
                .eq('is_active', true)
                .order('display_name') as any,
            supabase.from('categories')
                .select('id, display_name')
                .order('display_name') as any,
            supabase.from('node_types')
                .select('id, display_name, parent_categories')
                .order('display_name') as any
        ]);

        const chatWindow = (messages || [])
            .filter((m: any) => m.content && m.content.trim().length > 0)
            .slice(-8);

        const mappedHistory = chatWindow.map((m: any) => ({
            role: (m.role || m.type) === 'assistant' ? 'assistant' : 'user',
            content: m.content
        }));

        let workflowContext = '';
        if (previousWorkflow && previousWorkflow.nodes && previousWorkflow.nodes.length > 0) {
            const nodeList = previousWorkflow.nodes.map((n: any) => `  - ID: "${n.id}", Type: ${n.type}`).join('\n');
            workflowContext = `\nCURRENT CANVAS STATE:
Existing Nodes:
${nodeList}

Full State: ${JSON.stringify({ nodes: previousWorkflow.nodes, edges: previousWorkflow.edges })}`;
        }

        let imagesContext = '';
        if (attachedImages && attachedImages.length > 0) {
            imagesContext = `\nUSER ATTACHED IMAGES: The user attached ${attachedImages.length} image(s). Ensure you add a media_input node when needed.`;
        }

        const nodeTypesCatalog = (nodeTypesData as any[] || []).map((nt: any) => {
            const modelsForType = (modelsData as any[] || []).filter((m: any) => m.node_type_id === nt.id);
            const modelsList = modelsForType.map((m: any) =>
                `      • Model ID: ${m.id} - ${m.display_name}${m.providers && typeof m.providers === 'object' && 'name' in m.providers ? ` (${(m.providers as any).name})` : ''}`
            ).join('\n');

            return `  - Node Type: "${nt.id}" (${nt.display_name})
${modelsList || '      (No models available)'}`;
        }).join('\n\n');

        const categoriesList = (categoriesData as any[] || []).map((c: any) => `${c.display_name} (${c.id})`).join(', ');

        const workingWorkflowState = {
            workflow: getBaseWorkflow(previousWorkflow),
            idMap: new Map<string, string>()
        };

        const prisfolTools = {
            add_node: tool({
                description: `Add one OR MORE nodes to the canvas in a single call. Always batch all nodes for a workflow/request into ONE call.
Each node in 'nodes' may reference IDs of earlier nodes in the SAME array (in order) or existing canvas IDs.
IMPORTANT: Build nodes in topological order — a node's 'inputs' may only reference nodes that appear before it in the array OR existing canvas IDs.`,
                inputSchema: z.object({
                    nodes: z.array(z.object({
                        id: z.string().describe('Simple temporary node ID (e.g. "n1", "prompt_1").'),
                        type: z.enum(nodeTypes).describe('Base node type.'),
                        node_type_id: z.string().optional().describe('Required when type is ai_generator.'),
                        model_id: z.number().optional().describe('Optional model ID when relevant.'),
                        position: z.object({ x: z.number(), y: z.number() }).describe('Position hint — auto-calculated, any value is fine.'),
                        data: z.object({ config: z.any() }).describe(`Node config matching schema:\n\n${cleanNodesDocs}`),
                        inputs: z.array(z.object({
                            source: z.string().describe('Source node ID (existing canvas ID or ID from earlier in this array).'),
                            sourceHandle: z.string().optional(),
                            targetHandle: z.string().optional()
                        })).optional().default([])
                    })).min(1).describe('All nodes to add — include every node for this workflow/request here.')
                }),
                execute: async (args) => {
                    const patches: any[] = [];
                    for (const nodeArgs of args.nodes) {
                        const result = applyAddNodeOp(workingWorkflowState.workflow, nodeArgs, workingWorkflowState.idMap);
                        if (!result.success) return result;
                        workingWorkflowState.workflow = result.workflow;
                        if (result.patch) patches.push(result.patch);
                    }
                    const merged = patches.reduce((acc, p) => mergeWorkflowPatches(acc, p), null as WorkflowPatch | null);
                    return { success: true, patch: merged };
                }
            }),
            update_node: tool({
                description: `Update one existing node. This tool can also replace all inbound edges using 'replace_inputs'.`,
                inputSchema: z.object({
                    id: z.string().describe('Existing node ID (canvas UUID or previously used temporary ID).'),
                    data: z.object({
                        config: z.any().optional()
                    }).optional(),
                    position: z.object({
                        x: z.number(),
                        y: z.number()
                    }).describe('Node position (will be auto-calculated — you may pass any value).').optional(),
                    replace_inputs: z.array(z.object({
                        source: z.string(),
                        sourceHandle: z.string().optional(),
                        targetHandle: z.string().optional()
                    })).optional()
                }),
                execute: async (args) => {
                    const result = applyUpdateNodeOp(workingWorkflowState.workflow, args, workingWorkflowState.idMap);
                    if (!result.success) return result;

                    workingWorkflowState.workflow = result.workflow;
                    return {
                        success: true,
                        patch: result.patch
                    };
                }
            }),
            remove_node: tool({
                description: 'Remove one node and all connected edges.',
                inputSchema: z.object({
                    id: z.string().describe('Existing node ID (canvas UUID or previously used temporary ID).')
                }),
                execute: async (args) => {
                    const result = applyRemoveNodeOp(workingWorkflowState.workflow, args, workingWorkflowState.idMap);
                    if (!result.success) return result;

                    workingWorkflowState.workflow = result.workflow;
                    return {
                        success: true,
                        patch: result.patch
                    };
                }
            })
        };

        const systemPrompt = `You are Prism, a calm, confident, and friendly AI workflow lead. You help users build visual node-based AI workflows on a canvas.

VOICE & TONE:
- Use first person naturally ("I'll set that up...", "My suggestion here is...").
- Be professional, direct, and conversational.
- Never sound robotic.

EXECUTION PROTOCOL (CRITICAL):
- When the user asks to create/modify a workflow, call tools IMMEDIATELY in the same response.
- Use ONLY these tools: add_node, update_node, remove_node.
- Keep text extremely concise (1 sentence max), then act immediately with tool calls.
- BATCHING RULE: For any workflow creation, include ALL new nodes in a SINGLE add_node call. Never call add_node more than once per response unless a later node depends on a runtime UUID only known after the first call.
- add_node accepts an array — always use it to batch every node for the task.
- Do NOT output numbered lists, plans, or explanations before calling tools.

TOPOLOGICAL ORDER (MANDATORY):
- Build in strict topological order.
- A node can only be created after all nodes in its inputs already exist.
- In add_node.inputs and update_node.replace_inputs, reference only previously created IDs.

ID RULES:
- For new nodes, generate simple IDs (e.g. "n1", "n2", "prompt_1").
- Reuse those same simple IDs in later tool calls.
- System maps simple IDs to runtime UUIDs automatically.

CANVAS LAYOUT:
- Positions are managed automatically — you do not need to calculate coordinates.
- Focus on correct node types, connections, and configuration only.

DESIGN STRATEGY:
- Default behavior: execute immediately.
- Only ask for confirmation if the user explicitly requests planning first.
- If user asks to create a simple/new workflow, prefer add_node calls over update_node.
- Use update_node only when user explicitly asks to modify existing nodes.

CORE NODE TYPES: ${nodeTypes.filter(t => t !== 'ai_generator').join(', ')}

DYNAMIC NODE TYPES (AI models grouped by capability):
${nodeTypesCatalog}

AVAILABLE CATEGORIES: ${categoriesList}
Note: When using ai_generator, include node_type_id.
${workflowContext}
${imagesContext}`;

        let isClientConnected = true;

        const stream = new ReadableStream({
            start(controller) {
                const encoder = new TextEncoder();

                waitUntil((async () => {
                    let finalContent = '';
                    let accumulatedPatch: WorkflowPatch | null = null;
                    let hasContent = false;

                    try {
                        const result = streamText({
                            model: google('gemini-2.5-flash'),
                            system: systemPrompt,
                            messages: mappedHistory,
                            tools: prisfolTools,
                        });

                        for await (const part of result.fullStream as any) {
                            if (!isClientConnected) break;

                            // Mark hasContent on ANY part — prevents false "couldn't generate" errors
                            // that fire when the model thinks silently before its first text/tool output.
                            hasContent = true;

                            if (part.type === 'text-delta') {
                                const textChunk = part.textDelta || part.text || '';
                                if (textChunk) {
                                    finalContent += textChunk;
                                    try {
                                        controller.enqueue(encoder.encode(JSON.stringify({ type: 'text', content: textChunk }) + '\n'));
                                    } catch {
                                        isClientConnected = false;
                                    }
                                }
                            }
                            else if (part.type === 'tool-call') {
                                if (!finalContent.trim()) {
                                    const fallback = "I'm setting that up on the canvas for you now...";
                                    finalContent = fallback;
                                    try {
                                        controller.enqueue(encoder.encode(JSON.stringify({ type: 'text', content: fallback }) + '\n'));
                                    } catch {
                                        isClientConnected = false;
                                    }
                                }
                            }
                            else if (part.type === 'tool-result') {
                                hasContent = true;

                                if (part.toolName === 'add_node' || part.toolName === 'update_node' || part.toolName === 'remove_node') {
                                    const toolResult = (part as any).output || (part as any).result;

                                    if (!toolResult) {
                                        controller.enqueue(encoder.encode(JSON.stringify({
                                            type: 'error',
                                            content: '⚠️ Tool execution returned no result.'
                                        }) + '\n'));
                                        continue;
                                    }

                                    if (toolResult.success && toolResult.patch) {
                                        accumulatedPatch = mergeWorkflowPatches(accumulatedPatch, toolResult.patch);

                                        try {
                                            controller.enqueue(encoder.encode(JSON.stringify({
                                                type: 'tool',
                                                name: part.toolName,
                                                patch: toolResult.patch
                                            }) + '\n'));
                                        } catch {
                                            isClientConnected = false;
                                        }
                                    } else {
                                        controller.enqueue(encoder.encode(JSON.stringify({
                                            type: 'error',
                                            content: `⚠️ ${toolResult.error || 'Tool execution failed.'}`
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

                        if (sessionId && hasContent) {
                            const dbOperations: Promise<any>[] = [];

                            if (messages && messages.length > 0) {
                                const lastUserMsg = messages[messages.length - 1];
                                if (lastUserMsg.role === 'user' || lastUserMsg.type === 'user') {
                                    dbOperations.push(
                                        Promise.resolve(supabase.from('messages').insert({
                                            session_id: sessionId,
                                            role: 'user',
                                            content: lastUserMsg.content,
                                            status: 'completed',
                                            created_at: new Date().toISOString()
                                        }) as any)
                                    );
                                }
                            }

                            if (finalContent) {
                                dbOperations.push(
                                    Promise.resolve(supabase.from('messages').insert({
                                        session_id: sessionId,
                                        role: 'assistant',
                                        content: finalContent,
                                        status: 'completed',
                                        created_at: new Date(Date.now() + 1000).toISOString()
                                    }) as any)
                                );
                            }

                            if (accumulatedPatch) {
                                const merged = applyWorkflowPatch(getBaseWorkflow(previousWorkflow), accumulatedPatch);
                                dbOperations.push(
                                    Promise.resolve(supabase.from('sessions').update({
                                        canvas_state: { nodes: merged.nodes, edges: merged.edges },
                                        updated_at: new Date().toISOString()
                                    }).eq('id', sessionId) as any)
                                );
                            }

                            if (dbOperations.length > 0) {
                                await Promise.all(dbOperations);
                            }
                        }
                    } catch (err) {
                        console.error('Background AI Error:', err);
                        if (isClientConnected) {
                            try {
                                controller.enqueue(encoder.encode(JSON.stringify({
                                    type: 'error',
                                    content: 'Sorry, I encountered an internal error while building.'
                                }) + '\n'));
                            } catch { }
                        }
                        if (sessionId) {
                            await supabase.from('messages').insert({
                                session_id: sessionId,
                                role: 'assistant',
                                content: 'Sorry, I encountered an internal error while building.',
                                status: 'error',
                                created_at: new Date(Date.now() + 1000).toISOString()
                            });
                        }
                    } finally {
                        if (isClientConnected) {
                            try { controller.close(); } catch { }
                        }
                    }
                })());
            },
            cancel() {
                isClientConnected = false;
            }
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
