/**
 * Maps Paddle Price IDs back to our internal plan/pack identifiers.
 *
 * Source of truth is plans-config.ts — we walk PLANS and CREDIT_PACKS at
 * module load and build reverse lookups. Adding a new plan/pack only requires
 * updating plans-config; this file picks it up automatically.
 */
import { PLANS, CREDIT_PACKS, type PlanId, type CreditPackId } from './plans-config';

interface PlanLookup {
    planId: PlanId;
    cycle: 'monthly' | 'yearly';
    monthlyCredits: number;
}

interface PackLookup {
    packId: CreditPackId;
    credits: number;
}

const PLAN_BY_PRICE: Record<string, PlanLookup> = {};
const PACK_BY_PRICE: Record<string, PackLookup> = {};

for (const plan of PLANS) {
    if (plan.paddlePriceIdMonthly) {
        PLAN_BY_PRICE[plan.paddlePriceIdMonthly] = { planId: plan.id, cycle: 'monthly', monthlyCredits: plan.monthlyCredits };
    }
    if (plan.paddlePriceIdYearly) {
        PLAN_BY_PRICE[plan.paddlePriceIdYearly] = { planId: plan.id, cycle: 'yearly', monthlyCredits: plan.monthlyCredits };
    }
}

for (const pack of CREDIT_PACKS) {
    if (pack.paddlePriceId) {
        PACK_BY_PRICE[pack.paddlePriceId] = { packId: pack.id, credits: pack.credits };
    }
}

export function lookupPlanByPriceId(priceId: string): PlanLookup | null {
    return PLAN_BY_PRICE[priceId] ?? null;
}

export function lookupPackByPriceId(priceId: string): PackLookup | null {
    return PACK_BY_PRICE[priceId] ?? null;
}
