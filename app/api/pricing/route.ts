import { NextResponse } from 'next/server';
import { getPricing } from '@/lib/billing/pricing-source';

export const runtime = 'nodejs';

export async function GET() {
    const { plans, packs } = await getPricing();
    return NextResponse.json(
        { plans, packs },
        { headers: { 'Cache-Control': 'public, max-age=30, s-maxage=30' } },
    );
}
