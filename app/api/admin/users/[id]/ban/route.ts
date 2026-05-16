import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

const DURATION_MAP: Record<string, string> = {
    none: 'none',
    '24h': '24h',
    '7d': '168h',
    '30d': '720h',
    permanent: '876000h',
};

export async function POST(req: Request, { params }: { params: { id: string } }) {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const id = params.id;
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    if (id === auth.user.id) {
        return NextResponse.json({ error: 'You cannot ban yourself.' }, { status: 400 });
    }

    let body: any;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

    const duration = String(body?.duration ?? '');
    const mapped = DURATION_MAP[duration];
    if (!mapped) {
        return NextResponse.json({ error: `Invalid duration. Allowed: ${Object.keys(DURATION_MAP).join(', ')}` }, { status: 400 });
    }

    try {
        const service = createServiceClient();
        const { data, error } = await service.auth.admin.updateUserById(id, { ban_duration: mapped } as any);
        if (error) throw error;
        return NextResponse.json({
            banned_until: (data?.user as any)?.banned_until ?? null,
            duration,
        });
    } catch (err: any) {
        console.error('[Admin Users API] ban error:', err);
        return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
    }
}
