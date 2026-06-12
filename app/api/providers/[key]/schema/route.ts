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
    return NextResponse.json({ error: `Provider '${params.key}' has no schema API; enter inputs manually.` }, { status: 501 });
  }
  try {
    const openapi_schema = await adapter.fetchSchema(slug);
    return NextResponse.json({ openapi_schema });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Schema fetch failed' }, { status: 502 });
  }
}
