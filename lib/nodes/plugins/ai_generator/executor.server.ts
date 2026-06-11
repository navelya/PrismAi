import { NodeExecutor, NodeExecutionResult, ExecutionContext } from '../../types';
import { replicate, normalizeReplicateOutput } from '@/lib/ai/replicate-client';
import { isOutputEnvelope } from '@/lib/workflow/result-format';
import { createServiceClient } from '@/lib/supabase/service';
import { getProviderAdapter } from '@/lib/ai/providers/registry';
import { getAsyncAdapter } from '@/lib/ai/providers/async-registry';
import { resolvePrimaryProvider, applyInputOverrides } from '@/lib/workflow/resolve-provider';
import { buildCharacterFraming } from '@/lib/workflow/character-framing';

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
            .select('replicate_model_id, provider_model_id, is_active, display_name, inputs_schema, outputs_schema, providers(adapter_key)')
            .eq('id', model_id)
            .single();

        if (dbError || !model) throw new Error(`Model not found or inactive: ${dbError?.message || 'DB Error'}`);

        if (model.is_active === false) {
            throw new Error(`Model "${model.display_name || model_id}" is no longer available. Pick a different model.`);
        }

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

        // ── Character-reference framing (hidden) ─────────────────────────────
        // When character node(s) are wired in, the orchestrator/start-route
        // stash the count under the reserved `__characterRefCount` key in the
        // inputs bag (never a model field). Prepend framing so the model reads
        // each character sheet as ONE consistent person, not a group photo.
        // Constraints-first: framing goes BEFORE the user's request.
        const characterRefCount =
            input && typeof input === 'object' && typeof input.__characterRefCount === 'number'
                ? input.__characterRefCount
                : 0;
        if (characterRefCount >= 1) {
            // Prefer the conventional `prompt` field; fall back to the first
            // text-like control if a model renamed it.
            const promptKey =
                controlByKey.has('prompt') || handleByKey.has('prompt')
                    ? 'prompt'
                    : (controls.find((c: any) =>
                          ['text', 'textarea', 'string', 'prompt'].includes(
                              (c.type || '').toLowerCase()
                          )
                      )?.api_mapping_key as string | undefined);
            if (promptKey) {
                const framing = buildCharacterFraming(characterRefCount);
                const existing = replicateInputs[promptKey];
                const userPrompt = typeof existing === 'string' ? existing.trim() : '';
                replicateInputs[promptKey] = userPrompt
                    ? `${framing}\n\n${userPrompt}`
                    : framing;
            }
        }

        // ── Resolve the model's primary provider binding (Phase B) ───────────
        // One ai_models row can be bound to several providers; the primary
        // (priority 0, active) decides who runs it and with which slug. Failover
        // over the rest is Phase C.
        const primary = await resolvePrimaryProvider(model_id);
        const providerInputs = applyInputOverrides(replicateInputs, primary.inputOverrides);

        // Sync adapter (e.g. ElevenLabs): unchanged behavior — returns hosted bytes
        // in-request. Keyed off the resolved provider, not the legacy column.
        const syncAdapter = getProviderAdapter(primary.providerKey);
        if (syncAdapter) {
            return await syncAdapter.execute({
                model: { ...(model as any), provider_model_id: primary.providerModelId },
                inputs: providerInputs,
                iterationIndex: typeof context.predictionIndex === 'number' ? context.predictionIndex : 0,
                ctx: context,
            });
        }

        // New async providers (FAL, …) go through the generic submit+poll path.
        // Replicate is NOT handled here — it falls through to its existing path
        // below (webhook fast-path in prod, replicate.run in local dev), unchanged.
        if (primary.providerKey !== 'replicate') {
            const asyncAdapter = getAsyncAdapter(primary.providerKey);
            if (asyncAdapter.key !== primary.providerKey) {
                throw new Error(`No async adapter registered for provider '${primary.providerKey}'`);
            }
            const modelForAdapter = { ...(model as any), provider_model_id: primary.providerModelId };
            const isLocalEnv = (() => {
                const u = process.env.NEXT_PUBLIC_APP_URL
                    || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
                if (!u) return true; // nothing configured → true local dev
                return u.startsWith('http://localhost') || u.startsWith('http://127.0.0.1');
            })();
            const { providerJobId } = await asyncAdapter.submit(modelForAdapter, providerInputs, context);
            if (isLocalEnv) {
                // Local dev has no public webhook + no cron sweep — poll inline to
                // completion, mirroring replicate.run()'s synchronous local behavior.
                let poll = await asyncAdapter.poll(providerJobId);
                for (let i = 0; i < 150 && poll.status === 'pending'; i++) {
                    await new Promise((r) => setTimeout(r, 2000));
                    poll = await asyncAdapter.poll(providerJobId);
                }
                if (poll.status !== 'completed') {
                    throw new Error(poll.error || `${primary.providerKey} generation did not complete`);
                }
                return { success: true, status: 'success', data: poll.outputs };
            }
            // Prod: node goes 'running'; the Phase A sweep polls provider_job_id to
            // completion (and mirrors). Carry provider identity to the dispatcher.
            return {
                success: true,
                status: 'pending',
                data: { id: providerJobId },
                providerId: primary.providerKey,
                providerJobId,
            };
        }
        // ── Below: the unchanged Replicate path ──────────────────────────────
        // Prefer the resolved binding slug; fall back to the legacy column.
        const replicateSlug = primary.providerModelId || model.replicate_model_id;

        if (!replicateSlug) {
            throw new Error(`Model ${model_id} has no replicate_model_id and no provider adapter`);
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
        
        // Fan-out runs carry the stable prediction index so the webhook can address
        // its own node_predictions row by (execution_id, node_id, prediction_index)
        // regardless of callback/insert ordering. Single runs omit it (legacy path).
        const predIndexParam =
            typeof context.predictionIndex === 'number' ? `&predIndex=${context.predictionIndex}` : '';
        const webhookUrl = `${appUrl}/api/webhooks/replicate-v2?executionId=${context.executionId}&nodeId=${context.nodeId}${predIndexParam}`;

        console.log(`[AIGeneratorExecutor] Creating prediction for node ${context.nodeId}`, { 
            appUrl, 
            isLocal, 
            webhookUrl,
            executionId: context.executionId
        });

        // Robust model/version extraction
        // Handles: "owner/name", "owner/name:version", "name"
        const modelParts = replicateSlug.split(/[:\/]/);
        let modelOwner: string | undefined;
        let modelName: string;
        let modelVersion: string | undefined;

        if (modelParts.length === 3) {
            [modelOwner, modelName, modelVersion] = modelParts;
        } else if (modelParts.length === 2) {
            if (replicateSlug.includes(':')) {
                // assume name:version or owner/name (if no colon)
                [modelName, modelVersion] = modelParts;
            } else {
                [modelOwner, modelName] = modelParts;
            }
        } else {
            modelName = modelParts[0];
        }

        console.log(`[WorkflowExecutor] Starting AI model: ${replicateSlug}`, { isLocal, replicateInputs });

        if (isLocal) {
            // FALLBACK: Synchronous execution for localhost (no webhooks)
            const output = await replicate.run(
                replicateSlug as any,
                { input: providerInputs }
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
                ...(modelVersion ? { version: modelVersion } : { model: replicateSlug }),
                input: providerInputs,
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
