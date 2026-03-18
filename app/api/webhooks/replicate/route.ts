import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { executeWorkflowFromNode, stripHeavyNodeData } from '@/lib/workflow-engine';
import { saveExecution } from '@/lib/db/workflows';
import { Workflow } from '@/lib/nodes/types';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function createAdminClient() {
    return createClient(supabaseUrl, supabaseServiceKey, {
        auth: { persistSession: false },
    });
}

export async function POST(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const sessionId = searchParams.get('sessionId');
        const nodeId = searchParams.get('nodeId');

        if (!sessionId || !nodeId) {
            return NextResponse.json({ error: 'Missing mandatory context' }, { status: 400 });
        }

        const body = await request.json();
        const { status, output, error, id: predictionId } = body;

        console.log(`[Webhook/Replicate] Received update for ${nodeId} in session ${sessionId}. Status: ${status}`);

        const adminSupabase = createAdminClient();

        // 1. Fetch current session to get workflow state
        const { data: session, error: sessionError } = await adminSupabase
            .from('sessions')
            .select('canvas_state, user_id')
            .eq('id', sessionId)
            .single();

        if (sessionError || !session) {
            console.error('[Webhook/Replicate] Session not found:', sessionError);
            return NextResponse.json({ error: 'Session not found' }, { status: 404 });
        }

        const workflow = session.canvas_state as Workflow;
        const node = workflow.nodes.find(n => n.id === nodeId);

        if (!node) {
            console.error('[Webhook/Replicate] Node not found in session:', nodeId);
            return NextResponse.json({ error: 'Node not found' }, { status: 404 });
        }

        // 2. Handle Completion
        if (status === 'succeeded') {
            // Normalize output (handle array vs single)
            // Replicate AI Generator normalization logic
            const normalizeOutput = (rawOutput: any) => {
                const normalizeItem = (item: any) => {
                    let urlStr = item;
                    if (item && typeof item === 'object' && typeof item.url === 'function') {
                        urlStr = item.url().toString();
                    }
                    return typeof urlStr === 'string' ? { url: urlStr } : urlStr;
                };
                
                if (Array.isArray(rawOutput)) {
                    return rawOutput.map(normalizeItem);
                }
                return normalizeItem(rawOutput);
            };

            const normalizedResult = normalizeOutput(output);
            
            // Update node data in workflow
            node.data.output = normalizedResult;
            
            // Set preview residuals for UI
            if (Array.isArray(normalizedResult) && normalizedResult.length > 0 && normalizedResult[0].url) {
                node.data.outputMetadata = { ...node.data.outputMetadata, preview_urls: normalizedResult.slice(0, 4).map((o: any) => o.url) };
            } else if (normalizedResult && typeof normalizedResult === 'object' && normalizedResult.url) {
                node.data.outputMetadata = { ...node.data.outputMetadata, preview_urls: [normalizedResult.url] };
            }

            // Persistence: In the real app, we'd call persistNodeOutputs here.
            // For now, we update the session and trigger children.
            
            // Update Session canvas_state
            await adminSupabase.from('sessions').update({
                canvas_state: stripHeavyNodeData(workflow),
                status_message: 'AI Generation ready'
            }).eq('id', sessionId);

            // Trigger Real-time update (so UI knows to refresh)
            const execChannel = adminSupabase.channel(`execution_${sessionId}`);
            await execChannel.subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    await execChannel.send({
                        type: 'broadcast',
                        event: 'node_execution',
                        payload: { 
                            nodeId, 
                            status: 'success', 
                            output: normalizedResult,
                            outputMetadata: node.data.outputMetadata
                        },
                    });
                    await execChannel.unsubscribe();
                }
            });

            // Resume Workflow for child nodes
            // Note: We ignore the execution record here as it's part of a larger chain
            await executeWorkflowFromNode(
                workflow,
                `resume_${Date.now()}`,
                nodeId,
                {}, // Cached outputs already in the workflow object
                async (nid, nstatus, currentWorkflow) => {
                   // Broadcast follow-up status
                   await adminSupabase.channel(`execution_${sessionId}`).send({
                       type: 'broadcast',
                       event: 'node_execution',
                       payload: { nodeId: nid, status: nstatus }
                   });
                },
                undefined,
                undefined, // To keep it simple, we skip heavy persistence in webhook for now or use Vercel waitUntil
                'chain',
                session.user_id,
                sessionId
            );

        } else if (status === 'failed') {
            await adminSupabase.from('sessions').update({
                status_message: 'AI Generation failed'
            }).eq('id', sessionId);

            // Broadcast error
            const execChannel = adminSupabase.channel(`execution_${sessionId}`);
            await execChannel.subscribe(async (status) => {
                if (status === 'SUBSCRIBED') {
                    await execChannel.send({
                        type: 'broadcast',
                        event: 'node_execution',
                        payload: { nodeId, status: 'error' },
                    });
                    await execChannel.unsubscribe();
                }
            });
            
            await saveExecution(sessionId, 'failed', null, error || 'Replicate prediction failed');
        }

        return NextResponse.json({ success: true });

    } catch (err: any) {
        console.error('[Webhook/Replicate] Fatal error:', err);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
