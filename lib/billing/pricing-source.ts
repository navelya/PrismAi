/**
 * Runtime source of truth for plan / credit-pack pricing.
 *
 * Reads the `plans` and `credit_packs` tables (service-role) and merges the
 * editorial fields (name/tagline/features/accent) from plans-config.ts, then
 * returns the SAME shapes the codebase already uses (PlanDisplay / CreditPack)
 * so call sites barely change.
 *
 * Cached in-process for a short TTL to keep the webhook hot path cheap. Admin
 * writes call bustPricingCache().
 */
import { createServiceClient } from '@/lib/supabase/service';
import {
    PLANS,
    CREDIT_PACKS,
    getPlanStatic,
    getPackStatic,
    type PlanDisplay,
    type CreditPack,
    type PlanId,
    type CreditPackId,
} from './plans-config';

interface PlanRow {
    id: string;
    display_name: string;
    monthly_floor: number | string;
    signup_bonus: number | string;
    price_cents: number | null;
    price_yearly_cents: number | null;
    paddle_price_id_monthly: string | null;
    paddle_price_id_yearly: string | null;
    paddle_product_id: string | null;
    is_active: boolean;
    sort_order: number;
}

interface PackRow {
    id: string;
    display_name: string;
    price_cents: number;
    credits: number | string;
    paddle_price_id: string | null;
    paddle_product_id: string | null;
    is_active: boolean;
    sort_order: number;
}

interface HistoryRow {
    paddle_price_id: string;
    entity_type: 'plan' | 'pack';
    entity_id: string;
    cycle: 'monthly' | 'yearly' | null;
}

export interface PricingSnapshot {
    plans: PlanDisplay[];
    packs: CreditPack[];
    history: HistoryRow[];
}

const TTL_MS = 60_000;
let cache: { snapshot: PricingSnapshot; at: number } | null = null;

function mapPlan(row: PlanRow): PlanDisplay {
    const stat = getPlanStatic(row.id);
    return {
        id: row.id as PlanId,
        name: stat?.name ?? row.display_name,
        tagline: stat?.tagline ?? '',
        priceMonthly: Number(row.price_cents ?? 0) / 100,
        priceYearly: row.price_yearly_cents != null ? Number(row.price_yearly_cents) / 100 : undefined,
        monthlyCredits: Number(row.monthly_floor),
        signupBonus: Number(row.signup_bonus),
        features: stat?.features ?? [],
        accent: stat?.accent ?? 'neutral',
        available: row.is_active,
        paddlePriceIdMonthly: row.paddle_price_id_monthly ?? undefined,
        paddlePriceIdYearly: row.paddle_price_id_yearly ?? undefined,
    };
}

function mapPack(row: PackRow): CreditPack {
    const stat = getPackStatic(row.id);
    return {
        id: row.id as CreditPackId,
        name: stat?.name ?? row.display_name,
        tagline: stat?.tagline ?? '',
        price: Number(row.price_cents) / 100,
        credits: Number(row.credits),
        accent: stat?.accent ?? 'neutral',
        available: row.is_active,
        paddlePriceId: row.paddle_price_id ?? undefined,
    };
}

async function loadSnapshot(): Promise<PricingSnapshot> {
    const supabase = createServiceClient();
    const [plansRes, packsRes, histRes] = await Promise.all([
        supabase.from('plans').select('*').order('sort_order'),
        supabase.from('credit_packs').select('*').order('sort_order'),
        supabase.from('pricing_price_history').select('paddle_price_id, entity_type, entity_id, cycle'),
    ]);

    if (plansRes.error || packsRes.error || histRes.error) {
        // Fall back to static config so reads never hard-fail.
        return { plans: PLANS, packs: CREDIT_PACKS, history: [] };
    }

    return {
        plans: (plansRes.data as PlanRow[]).map(mapPlan),
        packs: (packsRes.data as PackRow[]).map(mapPack),
        history: histRes.data as HistoryRow[],
    };
}

export async function getPricing(): Promise<PricingSnapshot> {
    const now = Date.now();
    if (cache && now - cache.at < TTL_MS) return cache.snapshot;
    const snapshot = await loadSnapshot();
    cache = { snapshot, at: now };
    return snapshot;
}

export function bustPricingCache(): void {
    cache = null;
}

export interface PlanPriceLookup {
    planId: PlanId;
    cycle: 'monthly' | 'yearly';
}

export interface PackPriceLookup {
    packId: CreditPackId;
}

/** Resolve a Paddle price id to a plan + cycle (live or archived). */
export async function lookupPlanByPriceId(priceId: string): Promise<PlanPriceLookup | null> {
    const snap = await getPricing();
    for (const p of snap.plans) {
        if (p.paddlePriceIdMonthly === priceId) return { planId: p.id, cycle: 'monthly' };
        if (p.paddlePriceIdYearly === priceId) return { planId: p.id, cycle: 'yearly' };
    }
    const h = snap.history.find(x => x.paddle_price_id === priceId && x.entity_type === 'plan');
    if (h) return { planId: h.entity_id as PlanId, cycle: (h.cycle ?? 'monthly') as 'monthly' | 'yearly' };
    return null;
}

/** Resolve a Paddle price id to a credit pack (live or archived). */
export async function lookupPackByPriceId(priceId: string): Promise<PackPriceLookup | null> {
    const snap = await getPricing();
    const live = snap.packs.find(p => p.paddlePriceId === priceId);
    if (live) return { packId: live.id };
    const h = snap.history.find(x => x.paddle_price_id === priceId && x.entity_type === 'pack');
    if (h) return { packId: h.entity_id as CreditPackId };
    return null;
}

/** Current granted monthly credits for a plan (always the live value). */
export async function monthlyCreditsForPlan(planId: string): Promise<number> {
    const snap = await getPricing();
    return snap.plans.find(p => p.id === planId)?.monthlyCredits ?? 0;
}

/** Current credits for a pack (live value). */
export async function creditsForPack(packId: string): Promise<number> {
    const snap = await getPricing();
    return snap.packs.find(p => p.id === packId)?.credits ?? 0;
}
