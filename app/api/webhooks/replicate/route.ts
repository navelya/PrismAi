import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { executeWorkflowFromNode, stripHeavyNodeData } from '@/lib/workflow-engine';
import { saveExecution } from '@/lib/db/workflows';
import { Workflow } from '@/lib/nodes/types';
import { normalizeReplicateOutput, REPLICATE_WEBHOOK_SIGNING_SECRET } from '@/lib/ai/replicate-client';
import { Webhook } from 'standardwebhooks';

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

        // --- Signature Verification ---
        // Replicate signs the payload with Standard Webhooks.
        // If a secret is provided in the environment, we MUST verify the signature.
        const bodyText = await request.text();
        
        if (REPLICATE_WEBHOOK_SIGNING_SECRET) {
            const wh = new Webhook(REPLICATE_WEBHOOK_SIGNING_SECRET);
            const headers = {
                'webhook-id': request.headers.get('webhook-id') || '',
                'webhook-timestamp': request.headers.get('webhook-timestamp') || '',
                'webhook-signature': request.headers.get('webhook-signature') || '',
            };

            try {
                wh.verify(bodyText, headers);
            } catch (err) {
                console.error('[Webhook/Replicate] Signature verification failed:', err);
                return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
            }
        } else {
            console.warn('[Webhook/Replicate] WARNING: REPLICATE_WEBHOOK_SIGNING_SECRET is not set. Verification skipped.');
        }

        const body = JSON.parse(bodyText);
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
            const normalizedResult = normalizeReplicateOutput(output);
            
            // Update node data in workflow
            node.data.output = normalizedResult;
            
            // Set preview residuals for UI
            if (Array.isArray(normalizedResult) && normalizedResult.length > 0 && normalizedResult[0].url) {
                node.data.outputMetadata = { ...node.data.outputMetadata, preview_urls: normalizedResult.slice(0, 4).map((o: any) => o.url) };
            } else if (normalizedResult && typeof normalizedResult === 'object' && normalizedResult.url) {
                node.data.outputMetadata = { ...node.data.outputMetadata, preview_urls: [normalizedResult.url] };
            }

            // Persistence: Update the session and trigger children.
            // We use stripHeavyNodeData to keep the DB record lean.
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
                undefined, 
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
