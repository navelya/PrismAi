// app/api/marketing/templates/route.ts
// Public, unauthenticated, read-only list of published official templates for
// the marketing home's "Use cases" section. Mirrors the auth-gated
// /api/templates select but without auth and with a short in-process cache.
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

export const dynamic = 'force-dynamic';

export interface MarketingTemplate {
    id: string;
    name: string;
    description: string | null;
    thumbnail_url: string | null;
    category: string | null;
    tags: string[] | null;
}

const TTL_MS = 5 * 60_000;
let cache: { data: MarketingTemplate[]; at: number } | null = null;

export async function GET() {
    const now = Date.now();
    if (cache && now - cache.at < TTL_MS) {
        return NextResponse.json({ templates: cache.data });
    }

    try {
        const supabase = createServiceClient();
        const { data, error } = await supabase
            .from('workflow_templates')
            .select('id, name, description, thumbnail_url, category, tags')
            .eq('status', 'published')
            .eq('source', 'official')
            .order('usage_count', { ascending: false })
            .order('created_at', { ascending: false });

        if (error) throw error;

        const templates = (data ?? []) as MarketingTemplate[];
        cache = { data: templates, at: now };
        return NextResponse.json({ templates });
    } catch (e) {
        console.error('[marketing/templates] failed:', e);
        return NextResponse.json({ templates: [] });
    }
}
