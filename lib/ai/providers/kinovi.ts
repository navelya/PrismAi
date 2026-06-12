import { AsyncProviderAdapter, ErrorClass, ProviderPollResult } from './types';

const KINOVI_BASE = 'https://kinovi.ai/api/v1';

function kinoviHeaders(): Record<string, string> {
  const key = process.env.KINOVI_API_KEY;
  if (!key) throw new Error('Kinovi adapter: KINOVI_API_KEY env var is not set');
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}

function isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
}

/**
 * Kinovi (kinovi.ai) async adapter. Submit POSTs jobs/createTask with the model
 * slug + a NESTED `inputs` object; poll jobs/recordInfo until status 'success'.
 * Kinovi's only completion signal we trust is the authenticated poll (its
 * optional callback is unsigned + not retried), which is exactly the poll-as-
 * truth model — so no webhook is wired. Result URLs (static.kinovi.ai) are
 * mirrored by the completion pipeline.
 */
export const kinoviAsyncAdapter: AsyncProviderAdapter = {
  key: 'kinovi',
  mode: 'async',

  async submit(model, inputs, _ctx, _opts) {
    const slug = (model as any).provider_model_id as string;
    if (!slug) throw new Error('Kinovi adapter: model has no provider_model_id (slug)');
    let res: Response;
    try {
      res = await fetch(`${KINOVI_BASE}/jobs/createTask`, {
        method: 'POST',
        headers: kinoviHeaders(),
        body: JSON.stringify({ model: slug, inputs: inputs ?? {} }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e) {
      if (isAbortError(e)) { const err = new Error('Kinovi submit timed out'); (err as any).errorClass = 'transient'; throw err; }
      throw e;
    }
    const body = await res.json().catch(() => ({} as any));
    if (!res.ok) {
      const cls = kinoviAsyncAdapter.classifyError('submit', res.status, body);
      const msg = (body && (body.error?.message || body.message)) || `Kinovi submit failed (${res.status})`;
      const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
      (err as any).errorClass = cls;
      throw err;
    }
    const taskId = body?.taskId ?? body?.data?.taskId;
    if (!taskId) throw new Error('Kinovi submit: no taskId in response');
    return { providerJobId: taskId, status: 'pending' };
  },

  async poll(providerJobId): Promise<ProviderPollResult> {
    let res: Response;
    try {
      res = await fetch(`${KINOVI_BASE}/jobs/recordInfo?taskId=${encodeURIComponent(providerJobId)}`, {
        headers: kinoviHeaders(),
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
        error: (body && (body.error?.message || body.message)) || `Kinovi poll ${res.status}`,
      };
    }
    const data = body?.data ?? body ?? {};
    const s = data.status;
    if (s === 'fail') {
      return { status: 'failed', error: data.error?.message || data.error?.code || 'Kinovi generation failed' };
    }
    if (s !== 'success') return { status: 'pending' }; // waiting | generating
    const urls = extractKinoviUrls(data.output);
    if (urls.length === 0) {
      return { status: 'failed', error: 'Kinovi returned no output: ' + JSON.stringify(data).slice(0, 500) };
    }
    return { status: 'completed', outputs: urls, error: null };
  },

  classifyError(_op, httpStatus, body): ErrorClass {
    const code = String((body as any)?.error?.code ?? '');
    const msg = JSON.stringify((body as any)?.error?.message ?? (body as any)?.message ?? '').toLowerCase();
    if (code === '2038' || /violat|did not pass review|face detected|platform rules/.test(msg)) return 'moderation';
    if (httpStatus === 429 || (httpStatus !== null && httpStatus >= 500) || /try again/.test(msg)) return 'transient';
    return 'validation';
  },
};

/** Kinovi `data.output` is an array of `{ url, width, height, ... }`; pull the URLs. */
function extractKinoviUrls(output: any): { url: string }[] {
  const urls: { url: string }[] = [];
  if (!Array.isArray(output)) return urls;
  for (const o of output) {
    if (o && typeof o.url === 'string') urls.push({ url: o.url });
    else if (typeof o === 'string') urls.push({ url: o });
  }
  return urls;
}
