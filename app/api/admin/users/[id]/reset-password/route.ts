import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const id = params.id;
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    try {
        const service = createServiceClient();
        const { data: userRes, error: userErr } = await service.auth.admin.getUserById(id);
        if (userErr) throw userErr;
        const email = userRes?.user?.email;
        if (!email) return NextResponse.json({ error: 'User has no email on file' }, { status: 400 });

        const { error } = await service.auth.admin.generateLink({ type: 'recovery', email });
        if (error) throw error;

        return NextResponse.json({ sent: true });
    } catch (err: any) {
        console.error('[Admin Users API] reset-password error:', err);
        return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
    }
}
