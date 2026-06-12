import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';
import { getAsyncAdapter } from '@/lib/ai/providers/async-registry';

/**
 * Generic per-provider schema fetch for the admin model form. Dispatches to the
 * resolved async adapter's optional fetchSchema(). Providers without a schema API
 * (KIE, Kinovi) return 501 so the UI falls back to manual entry. Admin-only.
 *   GET /api/providers/<key>/schema?model=<slug>
 */
export async function GET(request: NextRequest, { params }: { params: { key: string } }) {
  const auth = await requireAdmin();
  if (auth.error) return auth.error;

  const slug = new URL(request.url).searchParams.get('model');
  if (!slug) return NextResponse.json({ error: 'Missing model slug (?model=)' }, { status: 400 });

  const adapter = getAsyncAdapter(params.key);
  if (!adapter || typeof adapter.fetchSchema !== 'function') {
    // The input schema is shared across a model's providers, so there's a real
    // workaround: fetch from a provider that does expose one, then set this
    // provider's slug. Say that instead of a dead-end "not supported".
    return NextResponse.json({
      error: `${params.key} has no schema API. The input schema is shared across providers — set a Replicate, FAL, or WaveSpeed provider as the default and fetch from it, then switch back. Or define the inputs manually.`,
    }, { status: 501 });
  }
  try {
    const result = await adapter.fetchSchema(slug);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Schema fetch failed' }, { status: 502 });
  }
}
