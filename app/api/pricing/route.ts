import { NextResponse } from 'next/server';
import { getPricing } from '@/lib/billing/pricing-source';
import type { PlanDisplay, CreditPack } from '@/lib/billing/plans-config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public-safe plan shape — dodoProductId* fields are server-only (checkout is
// server-side) and must never be forwarded to the client.
export type PublicPlanDisplay = Omit<PlanDisplay, 'dodoProductIdMonthly' | 'dodoProductIdYearly'>;
export type PublicCreditPack = Omit<CreditPack, 'dodoProductId'>;

export interface PublicPricingResponse {
    plans: PublicPlanDisplay[];
    packs: PublicCreditPack[];
}

function stripPlan({ dodoProductIdMonthly: _m, dodoProductIdYearly: _y, ...rest }: PlanDisplay): PublicPlanDisplay {
    return rest;
}

function stripPack({ dodoProductId: _d, ...rest }: CreditPack): PublicCreditPack {
    return rest;
}

export async function GET() {
    const { plans, packs } = await getPricing();
    const body: PublicPricingResponse = {
        plans: plans.map(stripPlan),
        packs: packs.map(stripPack),
    };
    return NextResponse.json(body, {
        headers: { 'Cache-Control': 'public, max-age=10, s-maxage=10, stale-while-revalidate=30' },
    });
}
