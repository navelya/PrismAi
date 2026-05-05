/**
 * UI-side display configuration for the plans modal.
 *
 * Free reflects what's actually seeded in the `plans` table. Starter and Pro
 * are display-only until Stripe lands — their CTAs are disabled. When you
 * add real Stripe-backed rows, the values here become the source of UI copy
 * and the IDs map to plans.id in the DB.
 */
export type PlanId = 'free' | 'starter' | 'pro';

export interface PlanDisplay {
    id: PlanId;
    name: string;
    tagline: string;
    priceMonthly: number;
    monthlyCredits: number;
    signupBonus?: number;
    features: string[];
    /** Visual treatment — Starter is the highlighted tier. */
    accent?: 'neutral' | 'highlight' | 'premium';
    /** True for tiers that aren't shippable yet (no Stripe). */
    available: boolean;
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
            'Save up to 5 workflows',
            'Community templates',
        ],
        accent: 'neutral',
        available: true,
    },
    {
        id: 'starter',
        name: 'Starter',
        tagline: 'For regular creators',
        priceMonthly: 10,
        monthlyCredits: 1500,
        features: [
            '1,500 credits refilled monthly',
            'Unsaved credits roll over',
            'Unlimited saved workflows',
            'Priority generation queue',
            'Access to premium AI models',
            'Email support',
        ],
        accent: 'highlight',
        available: false,
    },
    {
        id: 'pro',
        name: 'Pro',
        tagline: 'For power users & teams',
        priceMonthly: 30,
        monthlyCredits: 5000,
        features: [
            '5,000 credits refilled monthly',
            'Everything in Starter',
            'Fastest generation queue',
            'A/B test workflows',
            'Dedicated support channel',
            'Early access to new models',
        ],
        accent: 'premium',
        available: false,
    },
];

export function getPlanDisplay(id: string | null | undefined): PlanDisplay | null {
    if (!id) return null;
    return PLANS.find(p => p.id === id) ?? null;
}
