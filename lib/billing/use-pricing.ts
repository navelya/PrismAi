'use client';

import { useEffect, useState } from 'react';
import { PLANS, CREDIT_PACKS, type PlanDisplay, type CreditPack } from './plans-config';

interface PricingState {
    plans: PlanDisplay[];
    packs: CreditPack[];
    loading: boolean;
}

// Module-level cache so multiple components share one fetch. Given a short TTL
// so long-lived tabs pick up admin price changes (incl. rotated Paddle price ids)
// rather than serving a stale snapshot for the whole session.
const SHARED_TTL_MS = 120_000;
let shared: { plans: PlanDisplay[]; packs: CreditPack[] } | null = null;
let sharedAt = 0;

function sharedFresh(): boolean {
    return shared !== null && Date.now() - sharedAt < SHARED_TTL_MS;
}

export function usePricing(): PricingState {
    const [state, setState] = useState<PricingState>(
        sharedFresh() && shared
            ? { plans: shared.plans, packs: shared.packs, loading: false }
            : { plans: PLANS, packs: CREDIT_PACKS, loading: true },
    );

    useEffect(() => {
        if (sharedFresh() && shared) {
            setState({ plans: shared.plans, packs: shared.packs, loading: false });
            return;
        }
        let alive = true;
        fetch('/api/pricing')
            .then((r) => r.json())
            .then((data) => {
                if (!alive) return;
                // Defensive: a malformed/partial response must not poison the
                // cache and crash every consumer's .map(). Fall back to static.
                const plans = Array.isArray(data?.plans) ? data.plans : PLANS;
                const packs = Array.isArray(data?.packs) ? data.packs : CREDIT_PACKS;
                shared = { plans, packs };
                sharedAt = Date.now();
                setState({ plans, packs, loading: false });
            })
            .catch(() => {
                if (alive) setState((s) => ({ ...s, loading: false }));
            });
        return () => {
            alive = false;
        };
    }, []);

    return state;
}

export function getPlanFrom(plans: PlanDisplay[], id: string | null | undefined): PlanDisplay | null {
    if (!id) return null;
    return plans.find((p) => p.id === id) ?? null;
}

export function getPackFrom(packs: CreditPack[], id: string | null | undefined): CreditPack | null {
    if (!id) return null;
    return packs.find((p) => p.id === id) ?? null;
}
