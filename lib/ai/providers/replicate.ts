import { replicate, normalizeReplicateOutput } from '@/lib/ai/replicate-client';
import { AsyncProviderAdapter, ErrorClass, ProviderPollResult } from './types';

/**
 * Replicate as a first-class async adapter. `submit` creates a prediction with a
 * webhook (prod) — Phase A keeps the existing local-sync `replicate.run()` path in
 * the executor untouched, so `submit` here is used by the failover/sweep paths and
 * always uses predictions.create. `poll` reads the authoritative prediction status,
 * which is what makes the cron backstop work without trusting the webhook body.
 */
export const replicateAsyncAdapter: AsyncProviderAdapter = {
  key: 'replicate',
  mode: 'async',

  async submit(model, inputs, ctx, opts) {
    const modelRef = ((model as any).provider_model_id || (model as any).replicate_model_id) as string;
    if (!modelRef) throw new Error('replicate adapter: model has no replicate_model_id');
    const version = modelRef.includes(':') ? modelRef.split(':').pop() : undefined;
    const prediction = await replicate.predictions.create({
      ...(version ? { version } : { model: modelRef }),
      input: inputs,
      ...(opts?.webhookUrl
        ? { webhook: opts.webhookUrl, webhook_events_filter: ['completed'] }
        : {}),
    } as any);
    return { providerJobId: prediction.id, status: 'pending' };
  },

  async poll(providerJobId): Promise<ProviderPollResult> {
    const p = await replicate.predictions.get(providerJobId);
    if (p.status === 'succeeded') {
      return { status: 'completed', outputs: normalizeReplicateOutput(p.output), error: null };
    }
    if (p.status === 'failed' || p.status === 'canceled') {
      return { status: 'failed', error: (p.error as any) || `Prediction ${p.status}` };
    }
    // 'starting' | 'processing'
    return { status: 'pending' };
  },

  classifyError(_op, httpStatus, body): ErrorClass {
    const msg = typeof body === 'string'
      ? body
      : ((body as any)?.detail || (body as any)?.error || '').toString().toLowerCase();
    // Content moderation (terminal, no failover).
    if (msg.includes('nsfw') || msg.includes('flagged') || msg.includes('content policy') ||
        msg.includes('safety') || msg.includes('sensitive')) {
      return 'moderation';
    }
    // Transient/capacity/outage (failover/retry). A 429/5xx on submit is capacity;
    // on poll it is back-off (the caller decides — see sweep/failover logic).
    if (httpStatus === 429 || (httpStatus !== null && httpStatus >= 500)) return 'transient';
    // Default for 4xx submit errors is bad input.
    return 'validation';
  },
};
