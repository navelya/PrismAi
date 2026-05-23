import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';

/**
 * GET /api/billing/credit-breakdown — split the balance into monthly (plan-origin)
 * vs top-up (purchased). Reads the authoritative profiles.topup_balance column
 * (maintained by the credits RPCs); monthly is the remainder. The earlier ledger
 * derivation was removed because it breaks once free resets occur.
 */
export async function GET() {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;

    const { data: profile } = await supabase
        .from('profiles')
        .select('token_balance, topup_balance')
        .eq('id', user.id)
        .single();

    const balance = Number(profile?.token_balance ?? 0);
    const topupRaw = Number(profile?.topup_balance ?? 0);
    const safeBalance = Math.max(0, balance);
    const topup = Math.max(0, Math.min(safeBalance, topupRaw));
    const monthly = Math.max(0, safeBalance - topup);

    return NextResponse.json({ balance, monthly, topup });
}
