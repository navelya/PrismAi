import Replicate from 'replicate';
import { createClient } from '@supabase/supabase-js';
import { NodeExecutor, NodeExecutionResult, ExecutionContext } from '../types';

const replicate = new Replicate({
    auth: process.env.REPLICATE_API_TOKEN!,
});

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
            .select('replicate_model_id, inputs_schema')
            .eq('id', model_id)
            .single();

        if (dbError || !model) throw new Error(`Model not found or inactive: ${dbError?.message || 'DB Error'}`);

        // 2. Prepare inputs
        const replicateInputs: Record<string, any> = {};

        // A) Map from control values (manual UI settings)
        const controls = model.inputs_schema?.controls || [];
        controls.forEach((ctrl: any) => {
            const val = control_values?.[ctrl.api_mapping_key] ?? ctrl.default_value;
            if (val !== undefined && val !== '') {
                replicateInputs[ctrl.api_mapping_key] = val;
            }
        });

        // B) Map from Handles (connected nodes)
        // Note: 'input' passed by the engine is a Record<handleId, value> for multi-input nodes like compositor,
        // or the direct value for single-input nodes. AI Generator is multi-input (dynamic handles).
        const handles = model.inputs_schema?.handles || [];
        if (input && typeof input === 'object') {
            handles.forEach((h: any) => {
                const incomingVal = input[h.api_mapping_key];
                if (incomingVal !== undefined && incomingVal !== null) {
                    // Normalize image objects/arrays to URLs if needed
                    const value = Array.isArray(incomingVal) ? incomingVal[0] : incomingVal;
                    replicateInputs[h.api_mapping_key] = typeof value === 'object' ? value?.url : value;
                }
            });
        }

        if (!process.env.REPLICATE_API_TOKEN) throw new Error('Replicate API token missing');

        console.log(`[WorkflowExecutor] Running dynamic AI model: ${model.replicate_model_id}`, replicateInputs);

        // 3. Execute
        const rawOutput = await replicate.run(model.replicate_model_id as any, {
            input: replicateInputs,
        });

        // 4. Normalize Replicate FileOutput objects to standard PrismaAi object structure
        // The persistence engine expects `{ url: "..." }` or `[{ url: "..." }]`
        let sanitizedOutput;
        if (Array.isArray(rawOutput)) {
            sanitizedOutput = rawOutput.map((item: any) => {
                let urlStr = item;
                if (item && typeof item === 'object' && typeof item.url === 'function') {
                    urlStr = item.url().toString();
                }
                // Wrap in object if it's just a string, so persistence engine can find `.url`
                return typeof urlStr === 'string' ? { url: urlStr } : urlStr;
            });
        } else {
            let urlStr = rawOutput;
            if (rawOutput && typeof rawOutput === 'object' && typeof (rawOutput as any).url === 'function') {
                urlStr = (rawOutput as any).url().toString();
            }
            sanitizedOutput = typeof urlStr === 'string' ? [{ url: urlStr }] : [urlStr];
        }

        return {
            success: true,
            data: sanitizedOutput
        };
    } catch (err: any) {
        console.error('[AIGeneratorExecutor] Error:', err);
        return {
            success: false,
            data: null,
            error: err.message || 'AI Generation failed'
        };
    }
};
