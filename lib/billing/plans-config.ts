/**
 * UI-side display configuration for the plans modal and pricing surfaces.
 *
 * Free reflects what's actually seeded in the `plans` table. Paid tiers and
 * one-time credit packs are display-only until Paddle is wired up — their
 * CTAs are disabled. When you create the corresponding Paddle Prices,
 * paste each price ID into the matching `paddlePriceId` field; the UI will
 * then be ready and the checkout helper can map plan ID → Paddle price.
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
    /** True for tiers that aren't shippable yet (no Paddle price wired). */
    available: boolean;
    /** Paddle Price ID for the monthly subscription (set after Paddle approval). */
    paddlePriceIdMonthly?: string;
    /** Paddle Price ID for the annual subscription. */
    paddlePriceIdYearly?: string;
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
        paddlePriceIdMonthly: 'pri_01kqyt5610btfnb67xrtkb7qvz',
        paddlePriceIdYearly: 'pri_01kqyt6mzx7qh85wet1bnf297c',
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
        paddlePriceIdMonthly: 'pri_01kqytdt35r7jz9y2kgqgj0tcq',
        paddlePriceIdYearly: 'pri_01kqytf0qpxjqjs8myxwtp8ms5',
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
        paddlePriceIdMonthly: 'pri_01kqytgjx3bw3bg5xnkerfbayh',
        paddlePriceIdYearly: 'pri_01kqyth9sh1jredw1g3ekqr6kf',
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
    paddlePriceId?: string;
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
        paddlePriceId: 'pri_01kqytm9mh25em74b5qqyhm27z',
    },
    {
        id: 'boost',
        name: 'Boost',
        tagline: 'Most popular',
        price: 15,
        credits: 1300,
        accent: 'highlight',
        available: true,
        paddlePriceId: 'pri_01kqytnd6qbyrn3fd5my0vwps9',
    },
    {
        id: 'mega',
        name: 'Mega',
        tagline: 'Best value per credit',
        price: 40,
        credits: 4000,
        accent: 'premium',
        available: true,
        paddlePriceId: 'pri_01kqytpgfvenk10v1385483q5j',
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
// editorial and stay in code; price/credits/availability/paddle ids come from DB.

export function getPlanStatic(id: string): Pick<PlanDisplay, 'name' | 'tagline' | 'features' | 'accent'> | null {
    const p = PLANS.find(x => x.id === id);
    if (!p) return null;
    return { name: p.name, tagline: p.tagline, features: p.features, accent: p.accent };
}

export function getPackStatic(id: string): Pick<CreditPack, 'name' | 'tagline' | 'accent'> | null {
    const p = CREDIT_PACKS.find(x => x.id === id);
    if (!p) return null;
    return { name: p.name, tagline: p.tagline, accent: p.accent };
}
