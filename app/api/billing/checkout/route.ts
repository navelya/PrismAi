/**
 * POST /api/billing/checkout
 *
 * Creates a Dodo Payments hosted checkout session for a subscription plan and
 * returns the redirect URL. The caller (checkout page) then does
 * `window.location.href = url` to hand off to Dodo's hosted page.
 *
 * Body: { planId: string; cycle: 'monthly' | 'yearly' }
 * Response: { url: string }
 */
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { getDodo } from '@/lib/billing/dodo-server';
import { getPricing } from '@/lib/billing/pricing-source';

export const dynamic = 'force-dynamic';

interface CheckoutBody {
    planId?: string;
    cycle?: string;
}

export async function POST(request: Request) {
    try {
        // ── Auth ──────────────────────────────────────────────────────────────
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
        }

        // ── Dispute gate ──────────────────────────────────────────────────────
        // Refuse checkout while a chargeback is unresolved (mirrors change-plan).
        {
            const service = createServiceClient();
            const { data: profile } = await service
                .from('profiles')
                .select('payment_disputed_at')
                .eq('id', user.id)
                .maybeSingle();

            if (profile?.payment_disputed_at) {
                return NextResponse.json(
                    {
                        error: 'account_disputed',
                        message: 'Your account has a pending payment dispute. Contact support.',
                    },
                    { status: 403 },
                );
            }
        }

        // ── Body validation ───────────────────────────────────────────────────
        const body = (await request.json().catch(() => ({}))) as CheckoutBody;
        const planId = body.planId;
        const cycle = body.cycle;

        if (!planId || typeof planId !== 'string') {
            return NextResponse.json({ error: 'planId is required' }, { status: 400 });
        }
        if (cycle !== 'monthly' && cycle !== 'yearly') {
            return NextResponse.json({ error: 'cycle must be "monthly" or "yearly"' }, { status: 400 });
        }

        // ── Resolve Dodo product id ───────────────────────────────────────────
        const pricing = await getPricing();
        const plan = pricing.plans.find((p) => p.id === planId);
        if (!plan || plan.id === 'free') {
            return NextResponse.json({ error: `Plan "${planId}" not found` }, { status: 400 });
        }

        const productId =
            cycle === 'yearly' ? plan.dodoProductIdYearly : plan.dodoProductIdMonthly;

        if (!productId) {
            return NextResponse.json(
                {
                    error: `Plan "${planId}" has no Dodo product configured for ${cycle} billing. Contact support.`,
                },
                { status: 400 },
            );
        }

        // ── Load existing subscription for dodo_customer_id ───────────────────
        const service = createServiceClient();
        const { data: sub } = await service
            .from('subscriptions')
            .select('dodo_customer_id')
            .eq('user_id', user.id)
            .maybeSingle();

        const existingCustomerId = sub?.dodo_customer_id as string | null | undefined;

        // ── Build customer object ─────────────────────────────────────────────
        // AttachExistingCustomer takes only { customer_id }.
        // NewCustomer takes { email, name? }.
        const customer = existingCustomerId
            ? { customer_id: existingCustomerId }
            : { email: user.email ?? '', name: user.email ?? '' };

        // ── Create checkout session ───────────────────────────────────────────
        const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? '';
        const session = await getDodo().checkoutSessions.create({
            product_cart: [{ product_id: productId, quantity: 1 }],
            customer,
            metadata: {
                user_id: user.id,
                kind: 'subscription',
                plan_id: planId,
                cycle,
            },
            return_url: `${appUrl}/billing/success`,
            subscription_data: {},
        });

        if (!session.checkout_url) {
            return NextResponse.json(
                { error: 'Dodo Payments did not return a checkout URL. Please try again.' },
                { status: 502 },
            );
        }

        return NextResponse.json({ url: session.checkout_url });
    } catch (err: any) {
        console.error('[Billing/Checkout] Error:', err);
        return NextResponse.json({ error: err?.message || 'Server error' }, { status: 500 });
    }
}
