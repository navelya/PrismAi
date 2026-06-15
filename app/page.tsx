import HomeClient from '@/components/marketing/HomeClient';
import { getPricing } from '@/lib/billing/pricing-source';

// The marketing home. Server component so pricing renders server-side (no flash,
// no public pricing API). On the app host `/` is rewritten to /chat by
// middleware, so this only runs on the marketing / neutral host.
export const dynamic = 'force-dynamic';

export default async function Home() {
    const { plans, packs } = await getPricing();
    const visiblePlans = plans.filter((p) => p.available);
    const visiblePacks = packs.filter((p) => p.available);
    return <HomeClient plans={visiblePlans} packs={visiblePacks} />;
}
