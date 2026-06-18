/**
 * POST /api/billing/save-payment-info
 *
 * Sets profiles.save_payment_info for the authenticated user.
 * Body: { enabled: boolean }
 * Response: { ok: true, enabled: boolean }
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

interface SavePaymentInfoBody {
    enabled?: boolean;
}

export async function POST(request: Request) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
        }

        const body = (await request.json().catch(() => ({}))) as SavePaymentInfoBody;
        if (typeof body.enabled !== 'boolean') {
            return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 });
        }

        const service = createServiceClient();
        const { error } = await service
            .from('profiles')
            .update({ save_payment_info: body.enabled } as any)
            .eq('id', user.id);

        if (error) {
            console.error('[save-payment-info] update error:', error);
            return NextResponse.json({ error: error.message || 'Failed to update preference' }, { status: 500 });
        }

        return NextResponse.json({ ok: true, enabled: body.enabled });
    } catch (err: any) {
        console.error('[save-payment-info] Error:', err);
        return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
    }
}
