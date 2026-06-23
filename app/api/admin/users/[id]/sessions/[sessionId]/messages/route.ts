import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

// Recursively collect image-looking URLs from an arbitrary metadata value.
// execution_result shapes vary (string URLs, { url }, arrays, nested), so we
// sweep generically rather than assume one shape.
function collectImageUrls(value: unknown, out: Set<string>): void {
    if (!value) return;
    if (typeof value === 'string') {
        if (/^https?:\/\//i.test(value) && /\.(png|jpe?g|webp|gif|avif)(\?|#|$)/i.test(value)) {
            out.add(value);
        }
        return;
    }
    if (Array.isArray(value)) {
        for (const item of value) collectImageUrls(item, out);
        return;
    }
    if (typeof value === 'object') {
        for (const v of Object.values(value as Record<string, unknown>)) collectImageUrls(v, out);
    }
}

export async function GET(
    _req: NextRequest,
    { params }: { params: { id: string; sessionId: string } },
) {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const { id, sessionId } = params;
    if (!id || !sessionId) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    try {
        const service = createServiceClient();

        // Ownership guard: the session must belong to this user.
        const { data: session, error: sErr } = await service
            .from('sessions')
            .select('id, user_id')
            .eq('id', sessionId)
            .maybeSingle();
        if (sErr) throw sErr;
        if (!session || session.user_id !== id) {
            return NextResponse.json({ error: 'Session not found' }, { status: 404 });
        }

        const { data, error } = await service
            .from('messages')
            .select('id, role, content, images, created_at, metadata')
            .eq('session_id', sessionId)
            .order('created_at', { ascending: true });
        if (error) throw error;

        const rows = (data ?? []).map((m: any) => {
            const urls = new Set<string>();
            if (Array.isArray(m.images)) for (const u of m.images) if (typeof u === 'string') urls.add(u);
            collectImageUrls(m.metadata?.execution_result, urls);
            return {
                id: m.id as string,
                role: m.role as 'user' | 'assistant',
                content: (m.content ?? null) as string | null,
                images: Array.from(urls),
                created_at: m.created_at as string,
            };
        });

        return NextResponse.json({ rows });
    } catch (err: any) {
        console.error('[Admin Users API] session messages error:', err);
        return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
    }
}
