'use client';

import React from 'react';
import { CurrentPlanCard } from '@/components/billing/PlanBillingView';

/** "Plan & pricing" tab — just the current-plan summary card (no invoices). */
export function PlanPricingTab() {
    return <CurrentPlanCard />;
}
