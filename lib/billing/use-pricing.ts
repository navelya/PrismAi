'use client';

import { useEffect, useState } from 'react';
import { PLANS, CREDIT_PACKS, type PlanDisplay, type CreditPack } from './plans-config';

interface PricingState {
    plans: PlanDisplay[];
    packs: CreditPack[];
    loading: boolean;
}

// Module-level cache so multiple components share one fetch.
let shared: { plans: PlanDisplay[]; packs: CreditPack[] } | null = null;

export function usePricing(): PricingState {
    const [state, setState] = useState<PricingState>(
        shared
            ? { ...shared, loading: false }
            : { plans: PLANS, packs: CREDIT_PACKS, loading: true },
    );

    useEffect(() => {
        if (shared) return;
        let alive = true;
        fetch('/api/pricing')
            .then((r) => r.json())
            .then((data) => {
                if (!alive) return;
                shared = { plans: data.plans, packs: data.packs };
                setState({ ...shared, loading: false });
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
