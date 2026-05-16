import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api/auth';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export async function POST(_req: Request, { params }: { params: { id: string } }) {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const id = params.id;
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    if (id === auth.user.id) {
        return NextResponse.json({ error: 'You cannot change your own admin role.' }, { status: 400 });
    }

    try {
        const service = createServiceClient();

        const { data: existing, error: fetchErr } = await service
            .from('profiles')
            .select('is_admin')
            .eq('id', id)
            .maybeSingle();
        if (fetchErr) throw fetchErr;
        if (!existing) return NextResponse.json({ error: 'User profile not found' }, { status: 404 });

        const next = !existing.is_admin;
        const { error: updateErr } = await service
            .from('profiles')
            .update({ is_admin: next })
            .eq('id', id);
        if (updateErr) throw updateErr;

        return NextResponse.json({ is_admin: next });
    } catch (err: any) {
        console.error('[Admin Users API] toggle-admin error:', err);
        return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
    }
}
