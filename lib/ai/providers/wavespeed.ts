import { AsyncProviderAdapter, ErrorClass, ProviderPollResult } from './types';

const WAVESPEED_BASE = 'https://api.wavespeed.ai/api/v3';

function wsHeaders(): Record<string, string> {
  const key = process.env.WAVESPEED_API_KEY;
  if (!key) throw new Error('WaveSpeed adapter: WAVESPEED_API_KEY env var is not set');
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

function isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
}

/**
 * WaveSpeed (wavespeed.ai) async adapter. Submit POSTs the model slug as the URL
 * path (api/v3/{slug}); the response carries data.id + data.urls.get. Poll GETs
 * the result endpoint until status 'completed'. Output URLs (CloudFront) are
 * ephemeral and mirrored by the completion pipeline (adapters never mirror). No
 * webhook wired here — completion is the Phase A poll sweep (prod) / inline poll
 * (local dev). The job id is just data.id (the poll path is constructible from
 * it), so no slug round-trip is needed.
 */
export const wavespeedAsyncAdapter: AsyncProviderAdapter = {
  key: 'wavespeed',
  mode: 'async',

  async submit(model, inputs, _ctx, _opts) {
    const slug = (model as any).provider_model_id as string;
    if (!slug) throw new Error('WaveSpeed adapter: model has no provider_model_id (slug)');
    let res: Response;
    try {
      res = await fetch(`${WAVESPEED_BASE}/${slug}`, {
        method: 'POST',
        headers: wsHeaders(),
        body: JSON.stringify(inputs ?? {}),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      if (isAbortError(e)) { const err = new Error('WaveSpeed submit timed out'); (err as any).errorClass = 'transient'; throw err; }
      throw e;
    }
    const body = await res.json().catch(() => ({} as any));
    // WaveSpeed returns an envelope { code, message, data }; code 200/0 = ok.
    const okCode = body?.code === undefined || body.code === 200 || body.code === 0;
    if (!res.ok || !okCode) {
      const cls = wavespeedAsyncAdapter.classifyError('submit', res.status, body);
      const msg = (body && (body.message || body.error)) || `WaveSpeed submit failed (${res.status})`;
      const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
      (err as any).errorClass = cls;
      throw err;
    }
    const id = body?.data?.id;
    if (!id) throw new Error('WaveSpeed submit: no data.id in response');
    return { providerJobId: id, status: 'pending' };
  },

  async poll(providerJobId): Promise<ProviderPollResult> {
    let res: Response;
    try {
      res = await fetch(`${WAVESPEED_BASE}/predictions/${encodeURIComponent(providerJobId)}/result`, {
        headers: wsHeaders(),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      if (isAbortError(e)) return { status: 'pending' };
      throw e;
    }
    const body = await res.json().catch(() => ({} as any));
    if (!res.ok) {
      return {
        status: res.status >= 500 || res.status === 429 ? 'pending' : 'failed',
        error: (body && (body.message || body.error)) || `WaveSpeed poll ${res.status}`,
      };
    }
    const data = body?.data ?? {};
    const s = data.status;
    if (s === 'failed') {
      return { status: 'failed', error: data.error || body.message || 'WaveSpeed generation failed' };
    }
    if (s !== 'completed') return { status: 'pending' }; // created | processing
    const urls = extractWaveSpeedUrls(data.outputs);
    if (urls.length === 0) {
      return { status: 'failed', error: 'WaveSpeed returned no outputs: ' + JSON.stringify(data).slice(0, 500) };
    }
    return { status: 'completed', outputs: urls, error: null };
  },

  classifyError(_op, httpStatus, body): ErrorClass {
    const code = (body as any)?.code;
    if (code === 1200) return 'moderation';                       // content moderation
    if (code === 1400 || code === 1401 || code === 1402) return 'validation';
    if (httpStatus === 429 || (httpStatus !== null && httpStatus >= 500)) return 'transient';
    if (typeof code === 'number' && code >= 5000) return 'transient'; // app-level server codes
    return 'validation';
  },
};

/** WaveSpeed `data.outputs` is an array of URL strings; handle {url} objects defensively. */
function extractWaveSpeedUrls(outputs: any): { url: string }[] {
  const urls: { url: string }[] = [];
  if (!Array.isArray(outputs)) return urls;
  for (const o of outputs) {
    if (typeof o === 'string') urls.push({ url: o });
    else if (o && typeof o.url === 'string') urls.push({ url: o.url });
  }
  return urls;
}
