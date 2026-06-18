/**
 * Runtime source of truth for plan / credit-pack pricing.
 *
 * Reads the `plans` and `credit_packs` tables (service-role), merges editorial
 * fields (name/tagline/features/accent) from plans-config.ts, and returns the
 * full PlanDisplay / CreditPack shapes the codebase uses.
 *
 * Dodo product IDs are included in the server-side PricingSnapshot but are
 * stripped from the public /api/pricing response so they never reach the client.
 *
 * Cached in-process for a short TTL to keep hot paths cheap. Admin writes
 * call bustPricingCache().
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
    dodo_product_id_monthly: string | null;
    dodo_product_id_yearly: string | null;
    is_active: boolean;
    sort_order: number;
}

interface PackRow {
    id: string;
    display_name: string;
    price_cents: number;
    credits: number | string;
    dodo_product_id: string | null;
    is_active: boolean;
    sort_order: number;
}

export interface PricingSnapshot {
    plans: PlanDisplay[];
    packs: CreditPack[];
}

const TTL_MS = 60_000;
let cache: { snapshot: PricingSnapshot; at: number } | null = null;
let inflight: Promise<PricingSnapshot> | null = null;

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
        dodoProductIdMonthly: row.dodo_product_id_monthly ?? undefined,
        dodoProductIdYearly: row.dodo_product_id_yearly ?? undefined,
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
        dodoProductId: row.dodo_product_id ?? undefined,
    };
}

async function loadSnapshot(): Promise<PricingSnapshot> {
    const supabase = createServiceClient();
    const [plansRes, packsRes] = await Promise.all([
        supabase.from('plans').select(
            'id, display_name, monthly_floor, signup_bonus, price_cents, price_yearly_cents, dodo_product_id_monthly, dodo_product_id_yearly, is_active, sort_order'
        ).order('sort_order'),
        supabase.from('credit_packs').select(
            'id, display_name, price_cents, credits, dodo_product_id, is_active, sort_order'
        ).order('sort_order'),
    ]);

    if (plansRes.error || packsRes.error) {
        console.error('[pricing-source] DB read failed, falling back to static config:',
            plansRes.error || packsRes.error);
        return { plans: PLANS, packs: CREDIT_PACKS };
    }

    return {
        plans: (plansRes.data as PlanRow[]).map(mapPlan),
        packs: (packsRes.data as PackRow[]).map(mapPack),
    };
}

export async function getPricing(): Promise<PricingSnapshot> {
    const now = Date.now();
    if (cache && now - cache.at < TTL_MS) return cache.snapshot;
    if (!inflight) {
        inflight = loadSnapshot().then((s) => {
            cache = { snapshot: s, at: Date.now() };
            inflight = null;
            return s;
        }).catch((e) => {
            inflight = null;
            throw e;
        });
    }
    return inflight;
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

/** Resolve a Dodo product id to a plan + cycle. */
export async function lookupPlanByProductId(productId: string): Promise<PlanPriceLookup | null> {
    const snap = await getPricing();
    for (const p of snap.plans) {
        if (p.dodoProductIdMonthly === productId) return { planId: p.id, cycle: 'monthly' };
        if (p.dodoProductIdYearly === productId) return { planId: p.id, cycle: 'yearly' };
    }
    return null;
}

/** Resolve a Dodo product id to a credit pack. */
export async function lookupPackByProductId(productId: string): Promise<PackPriceLookup | null> {
    const snap = await getPricing();
    const live = snap.packs.find(p => p.dodoProductId === productId);
    if (live) return { packId: live.id };
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
