import { createClient } from '@supabase/supabase-js';
import { NodeExecutor, NodeExecutionResult, ExecutionContext } from '../types';
import { replicate, normalizeReplicateOutput } from '@/lib/ai/replicate-client';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

// Create a service-role client for DB lookups
const adminSupabase = createClient(supabaseUrl, supabaseServiceKey);

/**
 * AI Generator Executor
 * Dynamically runs Replicate models based on database configuration.
 */
export const aiGeneratorExecutor: NodeExecutor = async (config: any, input: any, context: ExecutionContext): Promise<NodeExecutionResult> => {
    try {
        const { model_id, control_values } = config || {};

        if (!model_id) throw new Error('No model selected');

        // 1. Fetch model configuration from DB
        const { data: model, error: dbError } = await adminSupabase
            .from('ai_models')
            .select('replicate_model_id, inputs_schema, outputs_schema')
            .eq('id', model_id)
            .single();

        if (dbError || !model) throw new Error(`Model not found or inactive: ${dbError?.message || 'DB Error'}`);

        // 2. Prepare inputs
        // ... (existing input mapping remains same)
        const replicateInputs: Record<string, any> = {};
        const controls = model.inputs_schema?.controls || [];
        controls.forEach((ctrl: any) => {
            const val = control_values?.[ctrl.api_mapping_key] ?? ctrl.default_value;
            if (val !== undefined && val !== '') {
                replicateInputs[ctrl.api_mapping_key] = val;
            }
        });

        const inputHandles = model.inputs_schema?.handles || [];
        if (input && typeof input === 'object') {
            inputHandles.forEach((h: any) => {
                const incomingVal = input[h.api_mapping_key];
                if (incomingVal === undefined || incomingVal === null) return;

                const isArrayTarget = h.is_array === true;
                
                // 1. Ensure we have an array of raw values to process
                const rawItems = Array.isArray(incomingVal) ? incomingVal : [incomingVal];
                
                // 2. Extract values (strings/urls) from each item
                const processed = rawItems.flatMap(item => {
                    if (item === null || item === undefined) return [];
                    
                    // If it's an array (e.g. from an output that returns array), flatten it
                    const subItems = Array.isArray(item) ? item : [item];
                    return subItems.map(sub => {
                        if (typeof sub === 'object' && sub !== null) {
                            // Recursively look for url or text if nested
                            return sub.url || sub.text || (sub.data && sub.data.url) || sub;
                        }
                        return sub;
                    });
                }).filter(val => val !== undefined && val !== '');

                // 3. Map to final Replicate input format
                if (isArrayTarget) {
                    replicateInputs[h.api_mapping_key] = processed;
                } else {
                    replicateInputs[h.api_mapping_key] = processed[0];
                }
            });
        }

        if (!process.env.REPLICATE_API_TOKEN) throw new Error('Replicate API token missing');

        // CRITICAL: Validate execution context to prevent malformed webhook URLs
        if (!context.sessionId) {
            throw new Error('[AIGeneratorExecutor] Missing sessionId in execution context - cannot create webhook URL');
        }
        if (!context.nodeId) {
            throw new Error('[AIGeneratorExecutor] Missing nodeId in execution context - cannot create webhook URL');
        }

        // ✅ PHASE 2 FIX: Proper Vercel URL detection with protocol
        // ISSUE: VERCEL_URL doesn't include protocol, causing webhook failures
        // SOLUTION: Always ensure https:// prefix for Vercel deployments
        const getAppUrl = () => {
            // Priority 1: Explicit APP_URL (should include protocol)
            if (process.env.NEXT_PUBLIC_APP_URL) {
                const url = process.env.NEXT_PUBLIC_APP_URL;
                return url.startsWith('http') ? url : `https://${url}`;
            }
            // Priority 2: Vercel deployment (VERCEL_URL never has protocol)
            if (process.env.VERCEL_URL) {
                return `https://${process.env.VERCEL_URL}`;
            }
            // Priority 3: Local development
            return 'http://localhost:3000';
        };

        const appUrl = getAppUrl();
        const isLocal = appUrl.startsWith('http://localhost') || appUrl.startsWith('http://127.0.0.1');
        const webhookUrl = `${appUrl}/api/webhooks/replicate?sessionId=${context.sessionId}&nodeId=${context.nodeId}`;

        console.log(`[AIGeneratorExecutor] Creating prediction for node ${context.nodeId} in session ${context.sessionId}`, { 
            appUrl, 
            isLocal, 
            webhookUrl 
        });

        // Robust model/version extraction
        // Handles: "owner/name", "owner/name:version", "name"
        const modelParts = model.replicate_model_id.split(/[:\/]/);
        let modelOwner: string | undefined;
        let modelName: string;
        let modelVersion: string | undefined;

        if (modelParts.length === 3) {
            [modelOwner, modelName, modelVersion] = modelParts;
        } else if (modelParts.length === 2) {
            if (model.replicate_model_id.includes(':')) {
                // assume name:version or owner/name (if no colon)
                [modelName, modelVersion] = modelParts;
            } else {
                [modelOwner, modelName] = modelParts;
            }
        } else {
            modelName = modelParts[0];
        }

        console.log(`[WorkflowExecutor] Starting AI model: ${model.replicate_model_id}`, { isLocal, replicateInputs });

        if (isLocal) {
            // FALLBACK: Synchronous execution for localhost (no webhooks)
            const output = await replicate.run(
                model.replicate_model_id as any,
                { input: replicateInputs }
            );

            const normalizedResult = normalizeReplicateOutput(output);

            return {
                success: true,
                data: normalizedResult,
                status: 'success'
            };
        } else {
            // PRODUCTION: Asynchronous execution with Webhooks
            const prediction = await replicate.predictions.create({
                // Replicate SDK prefers version if available, otherwise model
                ...(modelVersion ? { version: modelVersion } : { model: model.replicate_model_id }),
                input: replicateInputs,
                webhook: webhookUrl,
                webhook_events_filter: ['completed'],
            });

            console.log(`[WorkflowExecutor] Created prediction: ${prediction.id}`);

            return {
                success: true,
                data: { id: prediction.id, status: prediction.status },
                status: 'pending'
            };
        }
    } catch (err: any) {
        console.error('[AIGeneratorExecutor] Error:', err);
        return {
            success: false,
            status: 'error',
            data: null,
            error: err.message || 'AI Generation failed'
        };
    }
};
