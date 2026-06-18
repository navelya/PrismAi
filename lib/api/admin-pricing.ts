// lib/api/admin-pricing.ts

export interface AdminPlanRow {
    id: string;
    display_name: string;
    tagline: string | null;
    features: string[];
    accent: 'neutral' | 'highlight' | 'premium';
    monthly_floor: number;
    signup_bonus: number;
    price_cents: number | null;
    price_yearly_cents: number | null;
    is_active: boolean;
    sort_order: number;
    dodo_product_id_monthly: string | null;
    dodo_product_id_yearly: string | null;
    synced: boolean;
    created_at: string;
    updated_at: string;
}

export interface AdminPackRow {
    id: string;
    display_name: string;
    tagline: string | null;
    accent: 'neutral' | 'highlight' | 'premium';
    price_cents: number;
    credits: number;
    is_active: boolean;
    sort_order: number;
    dodo_product_id: string | null;
    synced: boolean;
    created_at: string;
    updated_at: string;
}

export interface PricingAuditRow {
    id: string;
    changed_by: string;
    entity_type: 'plan' | 'pack';
    entity_id: string;
    field: string;
    old_value: string | null;
    new_value: string | null;
    dodo_product_id_synced: string | null;
    created_at: string;
}

export interface SyncResult {
    id: string;
    type: 'plan' | 'pack';
    ok: boolean;
    error?: string;
    dodo_product_id_monthly?: string;
    dodo_product_id_yearly?: string | null;
    dodo_product_id?: string;
}

// ── Plan patch ────────────────────────────────────────────────────────────────
export interface PlanPatch {
    display_name?: string;
    tagline?: string | null;
    features?: string[];
    accent?: 'neutral' | 'highlight' | 'premium';
    price_cents?: number;
    price_yearly_cents?: number | null;
    monthly_floor?: number;
    signup_bonus?: number;
    is_active?: boolean;
    sort_order?: number;
}

// ── Pack patch ────────────────────────────────────────────────────────────────
export interface PackPatch {
    display_name?: string;
    tagline?: string | null;
    accent?: 'neutral' | 'highlight' | 'premium';
    price_cents?: number;
    credits?: number;
    is_active?: boolean;
    sort_order?: number;
}

// ── Plan create ───────────────────────────────────────────────────────────────
export interface PlanCreate {
    id: string;
    display_name: string;
    tagline?: string;
    features?: string[];
    accent?: 'neutral' | 'highlight' | 'premium';
    price_cents: number;
    price_yearly_cents?: number | null;
    monthly_floor?: number;
    signup_bonus?: number;
    sort_order?: number;
}

// ── Pack create ───────────────────────────────────────────────────────────────
export interface PackCreate {
    id: string;
    display_name: string;
    tagline?: string;
    accent?: 'neutral' | 'highlight' | 'premium';
    price_cents: number;
    credits: number;
    sort_order?: number;
}

export const pricingAdminApi = {
    get: async (): Promise<{ plans: AdminPlanRow[]; packs: AdminPackRow[]; audit: PricingAuditRow[] }> => {
        const res = await fetch('/api/admin/pricing');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load pricing');
        return data;
    },

    updatePlan: async (id: string, patch: PlanPatch) => {
        const res = await fetch(`/api/admin/pricing/plan/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update plan');
        return data as { ok: boolean; dodo_sync_error?: string };
    },

    deletePlan: async (id: string) => {
        const res = await fetch(`/api/admin/pricing/plan/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to delete plan');
        return data as { ok: boolean; soft_deleted: boolean; archived_dodo_products: string[] };
    },

    createPlan: async (body: PlanCreate) => {
        const res = await fetch('/api/admin/pricing/plan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create plan');
        return data as { ok: boolean; id: string; dodo_product_id_monthly?: string; dodo_product_id_yearly?: string; dodo_sync_error?: string };
    },

    updatePack: async (id: string, patch: PackPatch) => {
        const res = await fetch(`/api/admin/pricing/pack/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(patch),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to update pack');
        return data as { ok: boolean; dodo_sync_error?: string };
    },

    deletePack: async (id: string) => {
        const res = await fetch(`/api/admin/pricing/pack/${id}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to delete pack');
        return data as { ok: boolean; soft_deleted: boolean; archived_dodo_product: string | null };
    },

    createPack: async (body: PackCreate) => {
        const res = await fetch('/api/admin/pricing/pack', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create pack');
        return data as { ok: boolean; id: string; dodo_product_id?: string; dodo_sync_error?: string };
    },

    sync: async (body: { scope: 'all' | 'plan' | 'pack'; id?: string }) => {
        const res = await fetch('/api/admin/pricing/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        const data = await res.json();
        // 207 is partial success — still return data, don't throw
        if (!res.ok && res.status !== 207) throw new Error(data.error || 'Sync failed');
        return data as { ok: boolean; results: SyncResult[] };
    },
};
