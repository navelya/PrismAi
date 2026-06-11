import { AsyncProviderAdapter, ErrorClass, ProviderPollResult } from './types';

const FAL_QUEUE = 'https://queue.fal.run';
const FAL_REST = 'https://api.fal.ai/v1';

function falHeaders(): Record<string, string> {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error('FAL adapter: FAL_KEY env var is not set');
  return { Authorization: `Key ${key}`, 'Content-Type': 'application/json' };
}

/**
 * FAL (fal.ai) async adapter. Queue model: POST to queue.fal.run/{slug} returns a
 * request_id + status_url + response_url; poll status_url until COMPLETED then GET
 * response_url for the output. No webhook is wired in Phase B — completion is via
 * the Phase A poll-backstop (sweep) in prod / an inline poll in local dev. Output
 * media URLs (v3.fal.media) are ephemeral and mirrored by the completion pipeline.
 */
export const falAsyncAdapter: AsyncProviderAdapter = {
  key: 'fal',
  mode: 'async',

  async submit(model, inputs, _ctx, _opts) {
    const slug = (model as any).provider_model_id as string;
    if (!slug) throw new Error('FAL adapter: model has no provider_model_id (slug)');
    const res = await fetch(`${FAL_QUEUE}/${slug}`, {
      method: 'POST',
      headers: falHeaders(),
      body: JSON.stringify(inputs ?? {}),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const cls = falAsyncAdapter.classifyError('submit', res.status, body);
      const msg = (body && (body.detail || body.error)) || `FAL submit failed (${res.status})`;
      const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
      (err as any).errorClass = cls;
      throw err;
    }
    const requestId = body.request_id;
    if (!requestId) throw new Error('FAL submit: no request_id in response');
    return { providerJobId: `${slug}::${requestId}`, status: 'pending' };
  },

  async poll(providerJobId): Promise<ProviderPollResult> {
    const sep = providerJobId.indexOf('::');
    const slug = providerJobId.slice(0, sep);
    const requestId = providerJobId.slice(sep + 2);
    const base = `${FAL_QUEUE}/${slug}/requests/${requestId}`;
    const statusRes = await fetch(`${base}/status`, { headers: falHeaders() });
    const statusBody = await statusRes.json().catch(() => ({}));
    if (!statusRes.ok) {
      return { status: statusRes.status >= 500 || statusRes.status === 429 ? 'pending' : 'failed',
               error: (statusBody && (statusBody.detail || statusBody.error)) || `FAL status ${statusRes.status}` };
    }
    const s = statusBody.status;
    if (s === 'FAILED' || s === 'ERROR' || s === 'CANCELED' || s === 'CANCELLED') {
      return { status: 'failed', error: (statusBody && (statusBody.error || statusBody.detail)) || `FAL job ${s}` };
    }
    if (s !== 'COMPLETED') return { status: 'pending' };
    const respRes = await fetch(`${base}`, { headers: falHeaders() });
    const out = await respRes.json().catch(() => ({}));
    if (!respRes.ok) return { status: 'failed', error: (out && (out.detail || out.error)) || 'FAL response fetch failed' };
    return { status: 'completed', outputs: extractFalUrls(out), error: null };
  },

  classifyError(_op, httpStatus, body): ErrorClass {
    const detail = (body as any)?.detail;
    const text = JSON.stringify(detail ?? body ?? '').toLowerCase();
    if (text.includes('content_policy') || text.includes('nsfw') || text.includes('safety')) return 'moderation';
    if (httpStatus === 429 || (httpStatus !== null && httpStatus >= 500) || httpStatus === 503 || httpStatus === 504) return 'transient';
    if (httpStatus === 422 || httpStatus === 400) return 'validation';
    return 'validation';
  },

  async fetchSchema(modelSlug) {
    const res = await fetch(`${FAL_REST}/models?endpoint_id=${encodeURIComponent(modelSlug)}&expand=openapi-3.0`, {
      headers: falHeaders(),
    });
    if (!res.ok) throw new Error(`FAL fetchSchema failed (${res.status})`);
    const body = await res.json();
    const entry = Array.isArray(body?.models) ? body.models[0] : (body?.[0] ?? body);
    const openapi = entry?.openapi ?? entry?.openapi_schema;
    if (!openapi) throw new Error('FAL fetchSchema: no openapi spec in response');
    return openapi;
  },
};

/**
 * FAL output is model-specific JSON. Pull every hosted media URL out of the common
 * shapes ({images:[{url}]}, {image:{url}}, {video:{url}}, {audio:{url}}, {url}).
 * Returns an array of {url} — the completion pipeline normalizes + mirrors.
 */
function extractFalUrls(out: any): { url: string }[] {
  const urls: { url: string }[] = [];
  const pushUrl = (u: any) => { if (typeof u === 'string') urls.push({ url: u }); else if (u && typeof u.url === 'string') urls.push({ url: u.url }); };
  if (!out || typeof out !== 'object') return urls;
  for (const key of ['images', 'image', 'video', 'audio', 'files', 'output']) {
    const v = out[key];
    if (Array.isArray(v)) v.forEach(pushUrl);
    else if (v) pushUrl(v);
  }
  if (urls.length === 0 && typeof out.url === 'string') pushUrl(out.url);
  return urls;
}
