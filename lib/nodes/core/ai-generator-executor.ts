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

        console.log(`[WorkflowExecutor] Running dynamic AI model: ${model.replicate_model_id}`, replicateInputs);

        // 3. Execute
        const rawOutput = await replicate.run(model.replicate_model_id as any, {
            input: replicateInputs,
        });

        // 4. Normalize Output
        // Support multiple handles or single output
        const outputHandles = model.outputs_schema?.handles || [];
        const isSingleHandle = outputHandles.length <= 1;
        
        const normalizeItem = (item: any) => {
            let urlStr = item;
            if (item && typeof item === 'object' && typeof item.url === 'function') {
                urlStr = item.url().toString();
            }
            return typeof urlStr === 'string' ? { url: urlStr } : urlStr;
        };

        let result;
        if (isSingleHandle) {
            const h = outputHandles[0];
            const isArray = h?.is_array ?? true; // Default to array for backward compat
            
            if (Array.isArray(rawOutput)) {
                const sanitized = rawOutput.map(normalizeItem);
                result = isArray ? sanitized : sanitized[0];
            } else {
                const sanitized = normalizeItem(rawOutput);
                result = isArray ? [sanitized] : sanitized;
            }
        } else {
            // Multi-handle output: mapping keys in rawOutput to handles
            const multiOutput: Record<string, any> = {};
            outputHandles.forEach((h: any) => {
                const rawVal = (rawOutput as any)[h.api_mapping_key] || rawOutput;
                const isArray = h.is_array ?? true;
                
                if (Array.isArray(rawVal)) {
                    const sanitized = rawVal.map(normalizeItem);
                    multiOutput[h.api_mapping_key] = isArray ? sanitized : sanitized[0];
                } else {
                    const sanitized = normalizeItem(rawVal);
                    multiOutput[h.api_mapping_key] = isArray ? [sanitized] : sanitized;
                }
            });
            result = multiOutput;
        }

        return {
            success: true,
            data: result
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
