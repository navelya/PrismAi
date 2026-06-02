// lib/api/admin-pricing.ts
export interface AdminPlanRow {
    id: string;
    display_name: string;
    monthly_floor: number;
    signup_bonus: number;
    price_cents: number | null;
    price_yearly_cents: number | null;
    paddle_price_id_monthly: string | null;
    paddle_price_id_yearly: string | null;
    is_active: boolean;
    sort_order: number;
}

export interface AdminPackRow {
    id: string;
    display_name: string;
    price_cents: number;
    credits: number;
    paddle_price_id: string | null;
    is_active: boolean;
    sort_order: number;
}

export interface PricingAuditRow {
    id: string;
    changed_by: string;
    entity_type: 'plan' | 'pack';
    entity_id: string;
    field: string;
    old_value: string | null;
    new_value: string | null;
    paddle_price_id_created: string | null;
    created_at: string;
}

export const pricingAdminApi = {
    get: async (): Promise<{ plans: AdminPlanRow[]; packs: AdminPackRow[]; audit: PricingAuditRow[] }> => {
        const res = await fetch('/api/admin/pricing');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load pricing');
        return data;
    },

    updatePlan: async (id: string, patch: {
        price_monthly_dollars?: number;
        price_yearly_dollars?: number;
        monthly_floor?: number;
        is_active?: boolean;
    }) => {
        const res = await fetch(`/api/admin/pricing/plan/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update plan');
        return data;
    },

    updatePack: async (id: string, patch: {
        price_dollars?: number;
        credits?: number;
        is_active?: boolean;
    }) => {
        const res = await fetch(`/api/admin/pricing/pack/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update pack');
        return data;
    },
};
