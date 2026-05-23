import { NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@/lib/api/auth';

/**
 * GET /api/billing/credit-breakdown — split the user's balance into
 * "monthly" (plan-origin) vs "top-up" (purchased) credits.
 *
 * The balance is a single fungible pool; provenance lives only on the
 * token_ledger grant rows. Since credits never expire, we attribute spend
 * monthly-first: purchased top-up is the LAST thing consumed, so
 *   topup_remaining   = min(balance, gross top-up ever granted)
 *   monthly_remaining = balance − topup_remaining
 * This needs only the balance and the sum of top-up grants — no per-debit
 * attribution, and no billing/schema changes.
 *
 * (Limitation: a pack refund/chargeback reduces the balance but not the gross
 * top-up sum, so topup_remaining could briefly read high — but it's capped by
 * the balance, so it can never exceed what the user actually holds.)
 */
const TOPUP_REASONS = ['paddle_pack_purchase', 'purchase'];

export async function GET() {
    const auth = await getAuthenticatedUser();
    if (auth.error) return auth.error;
    const { user, supabase } = auth;

    const [{ data: profile }, { data: topupRows }] = await Promise.all([
        supabase.from('profiles').select('token_balance').eq('id', user.id).single(),
        supabase
            .from('token_ledger')
            .select('amount')
            .eq('user_id', user.id)
            .in('reason', TOPUP_REASONS),
    ]);

    const balance = Number(profile?.token_balance ?? 0);
    const topupGranted = (topupRows ?? []).reduce(
        (sum: number, r: { amount: number | string }) => sum + Number(r.amount || 0),
        0,
    );

    const safeBalance = Math.max(0, balance);
    const topup = Math.max(0, Math.min(safeBalance, topupGranted));
    const monthly = Math.max(0, safeBalance - topup);

    return NextResponse.json({ balance, monthly, topup });
}
