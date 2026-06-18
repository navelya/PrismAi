/**
 * UI-side display configuration for the plans modal and pricing surfaces.
 *
 * Content fields (name/tagline/features/accent) are editorial and stay in code
 * as offline fallback defaults. Pricing and availability come from the DB via
 * getPricing() in pricing-source.ts.
 *
 * Dodo product IDs are optional on the type — they are filled in at runtime
 * from the DB (dodo_product_id_monthly/yearly / dodo_product_id columns) and
 * must never be hardcoded here.
 */
export type PlanId = 'free' | 'starter' | 'pro' | 'studio';

export interface PlanDisplay {
    id: PlanId;
    name: string;
    tagline: string;
    priceMonthly: number;
    priceYearly?: number;
    monthlyCredits: number;
    signupBonus?: number;
    features: string[];
    /** Visual treatment — Pro is the highlighted tier. */
    accent?: 'neutral' | 'highlight' | 'premium';
    /** True for tiers that are active and available to subscribe. */
    available: boolean;
    /** Dodo Payments product ID for the monthly subscription (filled from DB at runtime). */
    dodoProductIdMonthly?: string;
    /** Dodo Payments product ID for the annual subscription (filled from DB at runtime). */
    dodoProductIdYearly?: string;
}

export const PLANS: PlanDisplay[] = [
    {
        id: 'free',
        name: 'Free',
        tagline: 'For trying things out',
        priceMonthly: 0,
        monthlyCredits: 100,
        signupBonus: 200,
        features: [
            '100 credits refilled monthly',
            '200 bonus credits on signup',
            'Access to all standard AI models',
            'Unlimited sessions',
            'Community templates',
            'Email support',
            'Team members',
        ],
        accent: 'neutral',
        available: true,
    },
    {
        id: 'starter',
        name: 'Starter',
        tagline: 'For regular creators',
        priceMonthly: 10,
        priceYearly: 96,
        monthlyCredits: 1500,
        features: [
            '1,500 credits refilled monthly',
            'Unsaved credits roll over',
            'Unlimited sessions',
            'Access to premium AI models',
            'Email support',
            'Team members',
        ],
        accent: 'neutral',
        available: true,
    },
    {
        id: 'pro',
        name: 'Pro',
        tagline: 'For power users',
        priceMonthly: 30,
        priceYearly: 288,
        monthlyCredits: 5000,
        features: [
            '5,000 credits refilled monthly',
            'Unsaved credits roll over',
            'Unlimited sessions',
            'Priority email support',
            'Team members',
        ],
        accent: 'highlight',
        available: true,
    },
    {
        id: 'studio',
        name: 'Studio',
        tagline: 'For agencies & teams',
        priceMonthly: 79,
        priceYearly: 758,
        monthlyCredits: 15000,
        features: [
            '15,000 credits refilled monthly',
            'Unsaved credits roll over',
            'Unlimited sessions',
            'Priority email support',
            'Team members',
        ],
        accent: 'premium',
        available: true,
    },
];

export function getPlanDisplay(id: string | null | undefined): PlanDisplay | null {
    if (!id) return null;
    return PLANS.find(p => p.id === id) ?? null;
}

// =============================================================================
// ONE-TIME CREDIT PACKS
// =============================================================================
// Top-ups for any plan. Per-credit price intentionally higher than subscription
// credits so that recurring plans remain the better deal at scale.

export type CreditPackId = 'spark' | 'boost' | 'mega';

export interface CreditPack {
    id: CreditPackId;
    name: string;
    tagline: string;
    price: number;
    credits: number;
    accent?: 'neutral' | 'highlight' | 'premium';
    available: boolean;
    /** Dodo Payments product ID for this one-time pack (filled from DB at runtime). */
    dodoProductId?: string;
}

export const CREDIT_PACKS: CreditPack[] = [
    {
        id: 'spark',
        name: 'Spark',
        tagline: 'A quick top-up',
        price: 5,
        credits: 400,
        accent: 'neutral',
        available: true,
    },
    {
        id: 'boost',
        name: 'Boost',
        tagline: 'Most popular',
        price: 15,
        credits: 1300,
        accent: 'highlight',
        available: true,
    },
    {
        id: 'mega',
        name: 'Mega',
        tagline: 'Best value per credit',
        price: 40,
        credits: 4000,
        accent: 'premium',
        available: true,
    },
];

export function getCreditPack(id: string | null | undefined): CreditPack | null {
    if (!id) return null;
    return CREDIT_PACKS.find(p => p.id === id) ?? null;
}

// =============================================================================
// STATIC STRUCTURE ACCESSORS (non-pricing fields kept in code)
// =============================================================================
// getPricing() merges DB pricing onto these. name/tagline/features/accent are
// editorial and stay in code; price/credits/availability/dodo ids come from DB.

export type PlanStatic = Pick<PlanDisplay, 'name' | 'tagline' | 'features' | 'accent'>;
export type PackStatic = Pick<CreditPack, 'name' | 'tagline' | 'accent'>;

export function getPlanStatic(id: string): PlanStatic | null {
    const p = PLANS.find(x => x.id === id);
    if (!p) return null;
    return { name: p.name, tagline: p.tagline, features: p.features, accent: p.accent };
}

export function getPackStatic(id: string): PackStatic | null {
    const p = CREDIT_PACKS.find(x => x.id === id);
    if (!p) return null;
    return { name: p.name, tagline: p.tagline, accent: p.accent };
}
