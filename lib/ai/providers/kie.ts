import { AsyncProviderAdapter, ErrorClass, ProviderPollResult } from './types';

const KIE_BASE = 'https://api.kie.ai/api/v1';

function kieHeaders(): Record<string, string> {
  const key = process.env.KIE_API_KEY;
  if (!key) throw new Error('KIE adapter: KIE_API_KEY env var is not set');
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

function isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
}

/**
 * KIE (kie.ai) async adapter — targets the UNIFIED "Market" API only
 * (jobs/createTask + jobs/recordInfo). KIE also exposes legacy per-family
 * endpoints (Veo/Runway/Suno/MJ) with divergent request/response shapes; those
 * are intentionally NOT supported — bind only Market-listed model slugs
 * (e.g. 'kling-2.6/text-to-video', 'nano-banana-pro'). Result URLs expire (~24h
 * for Market models) and are mirrored by the completion pipeline.
 */
export const kieAsyncAdapter: AsyncProviderAdapter = {
  key: 'kie',
  mode: 'async',

  async submit(model, inputs, _ctx, opts) {
    const slug = (model as any).provider_model_id as string;
    if (!slug) throw new Error('KIE adapter: model has no provider_model_id (slug)');
    // callBackUrl makes KIE POST to our server on completion (server-side); the
    // poll sweep remains the backstop. KIE's callback is a wake-up — the webhook
    // route re-polls for the authoritative result.
    const payload: Record<string, any> = { model: slug, input: inputs ?? {} };
    if (opts?.webhookUrl) payload.callBackUrl = opts.webhookUrl;
    let res: Response;
    try {
      res = await fetch(`${KIE_BASE}/jobs/createTask`, {
        method: 'POST',
        headers: kieHeaders(),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      if (isAbortError(e)) { const err = new Error('KIE submit timed out'); (err as any).errorClass = 'transient'; throw err; }
      throw e;
    }
    const body = await res.json().catch(() => ({} as any));
    if (!res.ok || (body && body.code !== undefined && body.code !== 200)) {
      const cls = kieAsyncAdapter.classifyError('submit', res.status, body);
      const msg = (body && (body.msg || body.message)) || `KIE submit failed (${res.status})`;
      const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
      (err as any).errorClass = cls;
      throw err;
    }
    const taskId = body?.data?.taskId;
    if (!taskId) throw new Error('KIE submit: no data.taskId in response');
    return { providerJobId: taskId, status: 'pending' };
  },

  async poll(providerJobId): Promise<ProviderPollResult> {
    let res: Response;
    try {
      res = await fetch(`${KIE_BASE}/jobs/recordInfo?taskId=${encodeURIComponent(providerJobId)}`, {
        headers: kieHeaders(),
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
        error: (body && (body.msg || body.message)) || `KIE poll ${res.status}`,
      };
    }
    const data = body?.data ?? {};
    const state = data.state;
    if (state === 'fail') {
      return { status: 'failed', error: data.failMsg || data.failCode || 'KIE generation failed' };
    }
    if (state !== 'success') return { status: 'pending' }; // waiting | queuing | generating
    const urls = extractKieUrls(data.resultJson);
    if (urls.length === 0) {
      return { status: 'failed', error: 'KIE returned no resultUrls: ' + JSON.stringify(data).slice(0, 500) };
    }
    return { status: 'completed', outputs: urls, error: null };
  },

  classifyError(_op, httpStatus, body): ErrorClass {
    const code = (body as any)?.code ?? httpStatus;
    const msg = JSON.stringify((body as any)?.msg ?? (body as any)?.message ?? '').toLowerCase();
    if (code === 400 && /flag|policy|inappropriate|violat|sensitive|prohibit|reject|nsfw|content/.test(msg)) return 'moderation';
    if (code === 408 || code === 429 || code === 455 || code === 500) return 'transient';
    if (httpStatus === 429 || (httpStatus !== null && httpStatus >= 500)) return 'transient';
    return 'validation';
  },
};

/** KIE Market `data.resultJson` is a JSON STRING; parse it and read `.resultUrls`. */
function extractKieUrls(resultJson: any): { url: string }[] {
  const urls: { url: string }[] = [];
  if (!resultJson) return urls;
  let parsed: any = resultJson;
  if (typeof resultJson === 'string') {
    try { parsed = JSON.parse(resultJson); } catch { return urls; }
  }
  const list = parsed?.resultUrls;
  if (Array.isArray(list)) {
    for (const u of list) {
      if (typeof u === 'string') urls.push({ url: u });
      else if (u && typeof u.url === 'string') urls.push({ url: u.url });
    }
  }
  return urls;
}
