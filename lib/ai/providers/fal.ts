import crypto from 'crypto';
import { AsyncProviderAdapter, ErrorClass, ProviderAdapterModel, ProviderPollResult } from './types';

const FAL_QUEUE = 'https://queue.fal.run';
const FAL_REST = 'https://api.fal.ai/v1';
const FAL_JWKS_URL = 'https://rest.fal.ai/.well-known/jwks.json';

/**
 * FAL names its image inputs `image_urls` (multi) or `image_url` (single), but the
 * app's canonical input-handle key is `image_input` — what every other provider's
 * models use, and what the engine special-cases for the shared multi-image slot.
 * We rename FAL → canonical when importing a schema, and canonical → FAL when
 * submitting a request, so a model fetched from FAL behaves like every other model
 * while still sending FAL the field name it expects. Other keys pass through as-is.
 */
const FAL_INPUT_ALIASES: Record<string, string> = {
  image_urls: 'image_input',
  image_url: 'image_input',
};

/**
 * Reverse the alias for an outgoing request: canonical `image_input` → the FAL key.
 * The singular/plural choice is driven by the model's `image_input` handle being an
 * array (→ `image_urls`) or not (→ `image_url`); when the schema is unavailable we
 * fall back to the runtime value shape. No-op when there's no `image_input` input,
 * and we never overwrite a FAL key that's already present.
 */
function mapInputsForFal(model: ProviderAdapterModel, inputs: Record<string, any>): Record<string, any> {
  if (!inputs || !('image_input' in inputs)) return inputs;
  const handles = model?.inputs_schema?.handles;
  const handle = Array.isArray(handles)
    ? handles.find((h: any) => h?.api_mapping_key === 'image_input')
    : undefined;
  const isArray = handle ? Boolean(handle.is_array) : Array.isArray(inputs.image_input);
  const falKey = isArray ? 'image_urls' : 'image_url';
  if (falKey in inputs) return inputs; // legacy schema already uses the FAL key — leave it.
  const { image_input, ...rest } = inputs;
  return { ...rest, [falKey]: image_input };
}

function falHeaders(): Record<string, string> {
  const key = process.env.FAL_KEY;
  if (!key) throw new Error('FAL adapter: FAL_KEY env var is not set');
  return { Authorization: `Key ${key}`, 'Content-Type': 'application/json' };
}

/** AbortSignal.timeout fires a TimeoutError (undici may surface AbortError). */
function isAbortError(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
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

  async submit(model, inputs, _ctx, opts) {
    const slug = (model as any).provider_model_id as string;
    if (!slug) throw new Error('FAL adapter: model has no provider_model_id (slug)');
    // Attach our webhook so FAL POSTs the result to the server on completion
    // (server-side, like Replicate); the poll sweep remains the backstop.
    const url = opts?.webhookUrl
      ? `${FAL_QUEUE}/${slug}?fal_webhook=${encodeURIComponent(opts.webhookUrl)}`
      : `${FAL_QUEUE}/${slug}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: falHeaders(),
        body: JSON.stringify(mapInputsForFal(model, inputs ?? {})),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      // A timed-out submit is transient — the dispatcher's error handling can
      // retry it; don't classify it as a validation failure.
      if (isAbortError(err)) (err as any).errorClass = 'transient';
      throw err;
    }
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
    // Persist FAL's OWN response_url, not a slug-reconstructed one. For a
    // multi-segment model (e.g. fal-ai/flux/dev) the status/response endpoints
    // live at the APP base (.../fal-ai/flux/requests/{id}), NOT the full slug —
    // rebuilding from the slug hits a route that 405s. The status URL is always
    // `${response_url}/status`, so storing response_url is sufficient.
    const responseUrl: string | undefined =
      body.response_url || (body.status_url ? String(body.status_url).replace(/\/status$/, '') : undefined);
    if (!responseUrl) {
      // Legacy fallback: no URL returned → reconstruct (works for single-segment slugs).
      return { providerJobId: `${slug}::${requestId}`, status: 'pending' };
    }
    return { providerJobId: responseUrl, status: 'pending' };
  },

  async poll(providerJobId): Promise<ProviderPollResult> {
    // providerJobId is FAL's response_url (current) or the legacy
    // `${slug}::${requestId}` form (jobs submitted before the URL fix).
    let base: string;
    if (providerJobId.startsWith('http')) {
      base = providerJobId;
    } else {
      const sep = providerJobId.indexOf('::');
      const slug = providerJobId.slice(0, sep);
      const requestId = providerJobId.slice(sep + 2);
      base = `${FAL_QUEUE}/${slug}/requests/${requestId}`;
    }
    let statusRes: Response;
    try {
      statusRes = await fetch(`${base}/status`, { headers: falHeaders(), signal: AbortSignal.timeout(15_000) });
    } catch (err) {
      // Timed-out poll is transient — report pending; the sweep retries.
      if (isAbortError(err)) return { status: 'pending' };
      throw err;
    }
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
    let respRes: Response;
    try {
      respRes = await fetch(`${base}`, { headers: falHeaders(), signal: AbortSignal.timeout(15_000) });
    } catch (err) {
      if (isAbortError(err)) return { status: 'pending' };
      throw err;
    }
    const out = await respRes.json().catch(() => ({}));
    if (!respRes.ok) {
      // The job genuinely COMPLETED — a transient error fetching its result must
      // not terminal-fail (and refund) it; report pending so the sweep retries.
      return { status: respRes.status >= 500 || respRes.status === 429 ? 'pending' : 'failed',
               error: (out && (out.detail || out.error)) || `FAL response fetch failed (${respRes.status})` };
    }
    const outputs = extractFalUrls(out);
    if (outputs.length === 0) {
      // An empty success would persist as a blank result and still charge the
      // user — treat unrecognized output shapes as a failure (refundable).
      return { status: 'failed', error: 'FAL returned no recognizable media outputs: ' + JSON.stringify(out).slice(0, 500) };
    }
    return { status: 'completed', outputs, error: null };
  },

  classifyError(_op, httpStatus, body): ErrorClass {
    const detail = (body as any)?.detail;
    const text = JSON.stringify(detail ?? body ?? '').toLowerCase();
    if (text.includes('content_policy') || text.includes('nsfw') || text.includes('safety')) return 'moderation';
    if (httpStatus === 429 || (httpStatus !== null && httpStatus >= 500) || httpStatus === 503 || httpStatus === 504) return 'transient';
    if (httpStatus === 422 || httpStatus === 400) return 'validation';
    return 'validation';
  },

  async verifyWebhook(headers, rawBody) {
    return verifyFalWebhook(headers, rawBody);
  },

  async fetchSchema(modelSlug) {
    const res = await fetch(`${FAL_REST}/models?endpoint_id=${encodeURIComponent(modelSlug)}&expand=openapi-3.0`, {
      headers: falHeaders(),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`FAL fetchSchema failed (${res.status})`);
    const body = await res.json();
    const models = Array.isArray(body?.models) ? body.models : [];
    const entry = models.find((m: any) => m.endpoint_id === modelSlug) || models[0] || body;
    const doc = entry?.openapi ?? entry?.openapi_schema ?? entry;
    if (!doc?.components?.schemas && !doc?.paths) throw new Error('FAL fetchSchema: no openapi doc in response');
    return {
      openapi_schema: normalizeFalOpenApi(doc),
      display_name: entry?.metadata?.display_name || undefined,
      description: entry?.metadata?.description || undefined,
    };
  },
};

/**
 * FAL's OpenAPI names the input/output schemas per-endpoint (e.g. FluxSchnellInput,
 * not "Input"), expresses nullable/union props via `anyOf`, and marks file inputs
 * only by name/description (no `format: uri`). Rewrite it into the Replicate-style
 * doc the shared parseReplicateSchema() expects: components.schemas.Input/Output
 * with props flattened and file inputs tagged `format: uri`. Other component
 * schemas (Image, ImageSize, …) are kept so their $refs still resolve.
 */
function normalizeFalOpenApi(doc: any): any {
  const schemas: Record<string, any> = { ...(doc?.components?.schemas || {}) };

  // Locate the Input schema: the primary POST path's requestBody $ref (the path
  // without `{request_id}`), else the lone *Input component.
  let inputName: string | undefined;
  for (const [p, ops] of Object.entries<any>(doc?.paths || {})) {
    if (p.includes('{request_id}')) continue;
    const ref = ops?.post?.requestBody?.content?.['application/json']?.schema?.$ref;
    if (ref) { inputName = ref.split('/').pop(); break; }
  }
  if (!inputName || !schemas[inputName]) {
    inputName = Object.keys(schemas).find((k) => k.endsWith('Input'));
  }
  const rawInput = inputName ? schemas[inputName] : undefined;
  if (!rawInput?.properties) throw new Error('FAL schema: could not locate the Input schema');

  const normProps: Record<string, any> = {};
  const required: string[] = [...(rawInput.required || [])];
  for (const [key, rawProp] of Object.entries<any>(rawInput.properties)) {
    // Rename FAL's image_urls/image_url to the canonical image_input. Pass the
    // ORIGINAL key to normalizeFalProp so its file-input detection (which matches
    // on names like *image*url*) still tags the prop as a uri input. Don't clobber
    // a real existing canonical prop on the rare model that has both.
    const aliased = FAL_INPUT_ALIASES[key];
    const targetKey = aliased && !rawInput.properties[aliased] ? aliased : key;
    normProps[targetKey] = normalizeFalProp(key, rawProp);
    if (targetKey !== key) {
      const i = required.indexOf(key);
      if (i >= 0) required[i] = targetKey;
    }
  }
  schemas.Input = { type: 'object', required, properties: normProps };

  const outputName = Object.keys(schemas).find((k) => k.endsWith('Output'));
  if (outputName) schemas.Output = schemas[outputName];

  return { components: { schemas } };
}

function normalizeFalProp(key: string, prop: any): any {
  let p = { ...prop };
  // Flatten anyOf: drop the null branch, lift an enum/typed branch up.
  if (Array.isArray(p.anyOf)) {
    const nonNull = p.anyOf.filter((v: any) => v?.type !== 'null');
    const enumBranch = nonNull.find((v: any) => Array.isArray(v.enum));
    const typed = nonNull.find((v: any) => v.type) || nonNull[0] || {};
    p = { ...typed, ...p };
    delete p.anyOf;
    if (enumBranch) { p.enum = enumBranch.enum; p.type = 'string'; }
    else if (!p.type && nonNull.some((v: any) => v.$ref)) { p.type = 'string'; }
  }
  // File inputs: FAL gives them only a name/description, no format. Tag them so
  // the shared parser routes them to input handles with the right media type.
  const looksFile =
    /(^|_)(image|images|img|video|audio|mask|file|url)s?$/i.test(key) ||
    /_url$/i.test(key) ||
    /\burl of (the|an|a|your)\b/i.test(String(p.description || ''));
  if (looksFile && p.type === 'string' && !p.enum) p.format = 'uri';
  return p;
}

// ── FAL webhook verification (ED25519 over request_id\nuser_id\ntimestamp\nsha256(body)) ──
let falJwksCache: { keys: any[]; fetchedAt: number } | null = null;

async function getFalJwks(): Promise<any[]> {
  // Cache the JWKS for an hour (docs allow up to 24h); keys rotate rarely.
  if (falJwksCache && Date.now() - falJwksCache.fetchedAt < 3600_000) return falJwksCache.keys;
  const res = await fetch(FAL_JWKS_URL, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`FAL JWKS fetch failed (${res.status})`);
  const body = await res.json();
  const keys = Array.isArray(body?.keys) ? body.keys : [];
  falJwksCache = { keys, fetchedAt: Date.now() };
  return keys;
}

/**
 * Verify a FAL webhook. The signed message is the four parts joined by '\n':
 * request_id, user_id, timestamp, and the lowercase hex SHA-256 of the RAW body.
 * The signature (hex) must validate as ED25519 against ANY current JWKS key
 * (headers carry no kid). Timestamp must be within ±5 min. Any failure → false.
 */
async function verifyFalWebhook(headers: Record<string, string>, rawBody: string): Promise<boolean> {
  try {
    const requestId = headers['x-fal-webhook-request-id'];
    const userId = headers['x-fal-webhook-user-id'];
    const timestamp = headers['x-fal-webhook-timestamp'];
    const signatureHex = headers['x-fal-webhook-signature'];
    if (!requestId || !userId || !timestamp || !signatureHex) return false;

    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 300) return false;

    const bodyHash = crypto.createHash('sha256').update(rawBody, 'utf8').digest('hex');
    const message = Buffer.from(`${requestId}\n${userId}\n${timestamp}\n${bodyHash}`, 'utf8');
    const signature = Buffer.from(signatureHex, 'hex');

    const keys = await getFalJwks();
    for (const k of keys) {
      try {
        const pub = crypto.createPublicKey({
          key: { kty: 'OKP', crv: 'Ed25519', x: String(k.x).replace(/=+$/, '') },
          format: 'jwk',
        });
        if (crypto.verify(null, message, pub, signature)) return true;
      } catch { /* try next key */ }
    }
    return false;
  } catch {
    return false;
  }
}

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
