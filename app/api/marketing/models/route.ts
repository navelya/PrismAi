// app/api/marketing/models/route.ts
// Public, unauthenticated, read-only list of active AI models for the marketing
// site's "AI models" section. Service-role (RLS-bypassing) but exposes only
// non-sensitive display fields, and is cached in-process briefly to keep the
// public endpoint cheap. Never returns provider keys or schemas.
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export interface MarketingModel {
    display_name: string;
    kind: string; // category_id: image | video | audio | text | ...
    provider: string | null;
    provider_logo: string | null;
}

const TTL_MS = 5 * 60_000;
let cache: { data: MarketingModel[]; at: number } | null = null;

export async function GET() {
    const now = Date.now();
    if (cache && now - cache.at < TTL_MS) {
        return NextResponse.json({ models: cache.data });
    }

    try {
        const supabase = createServiceClient();
        const { data, error } = await supabase
            .from('ai_models')
            .select('display_name, category_id, providers(name, logo_url)')
            .eq('is_active', true)
            .eq('is_primary', true) // hide variants from the public list
            .order('display_name');

        if (error) throw error;

        const models: MarketingModel[] = (data ?? []).map((m: any) => ({
            display_name: m.display_name,
            kind: (m.category_id || 'other').toLowerCase(),
            provider: m.providers?.name ?? null,
            provider_logo: m.providers?.logo_url ?? null,
        }));

        cache = { data: models, at: now };
        return NextResponse.json({ models });
    } catch (e) {
        console.error('[marketing/models] failed:', e);
        // Soft-fail: the section just renders empty rather than 500-ing the page.
        return NextResponse.json({ models: [] });
    }
}
