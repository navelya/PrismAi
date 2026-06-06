import { NodeExecutor, NodeExecutionResult, ExecutionContext } from '../../types';
import { replicate, normalizeReplicateOutput } from '@/lib/ai/replicate-client';
import { isOutputEnvelope } from '@/lib/workflow/result-format';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * AI Generator Executor
 * Dynamically runs Replicate models based on database configuration.
 */
export const aiGeneratorExecutor: NodeExecutor = async (config: any, input: any, context: ExecutionContext): Promise<NodeExecutionResult> => {
    try {
        const { model_id, control_values } = config || {};

        if (!model_id) throw new Error('No model selected');

        const adminSupabase = createServiceClient();

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
        const controlByKey = new Map<string, any>(controls.map((ctrl: any) => [ctrl.api_mapping_key, ctrl]));
        const inputHandles = model.inputs_schema?.handles || [];
        const handleByKey = new Map<string, any>(inputHandles.map((h: any) => [h.api_mapping_key, h]));

        const maybeParseJson = (value: any) => {
            if (typeof value !== 'string') return value;
            const trimmed = value.trim();
            if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return value;
            try {
                return JSON.parse(trimmed);
            } catch {
                return value;
            }
        };

        const flattenInputValues = (value: any): any[] => {
            const parsed = maybeParseJson(value);
            if (parsed === null || parsed === undefined) return [];

            if (isOutputEnvelope(parsed)) {
                return flattenInputValues(parsed.data);
            }

            if (Array.isArray(parsed)) {
                return parsed.flatMap((item) => flattenInputValues(item));
            }

            if (typeof parsed === 'object') {
                if (typeof parsed.url === 'string') return [parsed.url];
                if (typeof parsed.text === 'string') return [parsed.text];
                if (Array.isArray((parsed as any).data)) return flattenInputValues((parsed as any).data);
                return [parsed];
            }

            return [parsed];
        };

        const normalizeArrayInput = (value: any): any[] => {
            return flattenInputValues(value)
                .filter(val => val !== undefined && val !== null && val !== '');
        };

        const shouldBeArray = (key: string, value: any) => {
            const control = controlByKey.get(key);
            const handle = handleByKey.get(key);
            if (handle?.is_array === true) return true;
            if ((control?.type || '').toLowerCase() === 'array') return true;
            if (Array.isArray(value)) return true;

            // Controls are always scalar widgets (slider, number_input, select, etc.) —
            // never apply the suffix heuristic to a registered control, even if the key
            // happens to end in "_images" / "_files" / "_urls" (e.g. `max_images`).
            if (control) return false;

            const normalizedKey = key.toLowerCase();
            return (
                normalizedKey === 'images' ||
                normalizedKey.endsWith('_images') ||
                normalizedKey.endsWith('_files') ||
                normalizedKey.endsWith('_urls')
            );
        };

        controls.forEach((ctrl: any) => {
            const val = control_values?.[ctrl.api_mapping_key] ?? ctrl.default_value;
            // null is treated the same as undefined/'' — an auto/random seed resolves to
            // null and must be omitted so the model randomizes. Sending null is never intended.
            if (val !== undefined && val !== '' && val !== null) {
                replicateInputs[ctrl.api_mapping_key] = val;
            }
        });

        inputHandles.forEach((h: any) => {
            // Handle invisible mandatory inputs first - these are always sent as empty data
            // if no value is provided, to satisfy API constraints.
            if (h.is_mandatory && h.is_visible === false) {
                replicateInputs[h.api_mapping_key] = h.is_array ? [] : "";
            }

            if (input && typeof input === 'object') {
                let incomingVal = input[h.api_mapping_key];
                if (incomingVal !== undefined && incomingVal !== null) {
                    const isArrayTarget = h.is_array === true;
                    const processed = flattenInputValues(incomingVal).filter(val => val !== undefined && val !== '');

                    if (isArrayTarget) {
                        replicateInputs[h.api_mapping_key] = processed;
                    } else {
                        replicateInputs[h.api_mapping_key] = processed[0];
                    }
                }
            }
        });

        // Final normalization pass for array-like fields.
        // This protects execution even when older stored schemas marked fields like
        // "images" as scalar instead of array.
        Object.entries(replicateInputs).forEach(([key, rawValue]) => {
            if (shouldBeArray(key, rawValue)) {
                replicateInputs[key] = normalizeArrayInput(rawValue);
                return;
            }
            replicateInputs[key] = maybeParseJson(rawValue);
        });

        // Enforce array contracts from schema after normalization.
        inputHandles.forEach((h: any) => {
            if (!h?.api_mapping_key || h.is_array !== true) return;
            const key = h.api_mapping_key;
            replicateInputs[key] = normalizeArrayInput(replicateInputs[key]);
        });

        // Fail early with a clear validation error when required handles are missing.
        const missingRequired = inputHandles
            .filter((h: any) => h?.is_mandatory && h.is_visible !== false)
            .filter((h: any) => {
                const value = replicateInputs[h.api_mapping_key];
                if (h.is_array) return !Array.isArray(value) || value.length === 0;
                if (typeof value === 'string') return value.trim().length === 0;
                return value === undefined || value === null;
            })
            .map((h: any) => h.api_mapping_key);

        if (missingRequired.length > 0) {
            throw new Error(`Missing required input(s): ${missingRequired.join(', ')}`);
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
        
        // V2 webhook URL - requires executionId
        if (!context.executionId) {
            throw new Error('Missing executionId - cannot create webhook URL. Ensure execution is started via /api/executions/start');
        }
        
        const webhookUrl = `${appUrl}/api/webhooks/replicate-v2?executionId=${context.executionId}&nodeId=${context.nodeId}`;

        console.log(`[AIGeneratorExecutor] Creating prediction for node ${context.nodeId}`, { 
            appUrl, 
            isLocal, 
            webhookUrl,
            executionId: context.executionId
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
