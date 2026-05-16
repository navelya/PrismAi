import { NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { requireAdmin } from '@/lib/api/auth';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

const MAX_ABS_AMOUNT = 1_000_000;

export async function POST(req: Request, { params }: { params: { id: string } }) {
    const auth = await requireAdmin();
    if (auth.error) return auth.error;

    const id = params.id;
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    let body: any;
    try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }

    const amountRaw = body?.amount;
    const amount = typeof amountRaw === 'number' ? amountRaw : Number(amountRaw);
    if (!Number.isFinite(amount) || amount === 0) {
        return NextResponse.json({ error: 'amount must be a non-zero number' }, { status: 400 });
    }
    if (Math.abs(amount) > MAX_ABS_AMOUNT) {
        return NextResponse.json({ error: `amount must be within ±${MAX_ABS_AMOUNT}` }, { status: 400 });
    }

    const noteInput = typeof body?.note === 'string' ? body.note.trim() : '';
    const note = noteInput || (amount > 0 ? 'Prisfol Gift' : 'Adjustment');

    try {
        const service = createServiceClient();
        const idempotencyKey = `admin:${randomUUID()}`;
        const { data, error } = await service.rpc('admin_adjust_tokens', {
            p_target_user_id: id,
            p_amount: amount,
            p_admin_user_id: auth.user.id,
            p_note: note,
            p_idempotency_key: idempotencyKey,
        });
        if (error) {
            if (/INSUFFICIENT_TOKENS/i.test(error.message)) {
                return NextResponse.json({ error: 'Insufficient balance — cannot deduct more than the user has.' }, { status: 400 });
            }
            throw error;
        }
        return NextResponse.json({ new_balance: Number(data ?? 0), note });
    } catch (err: any) {
        console.error('[Admin Users API] adjust-tokens error:', err);
        return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
    }
}
