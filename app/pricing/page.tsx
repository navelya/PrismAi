import { Check } from 'lucide-react';
import { Section, P, Strong } from '@/components/legal/LegalProse';
import { PLANS, CREDIT_PACKS, type PlanDisplay, type CreditPack } from '@/lib/billing/plans-config';

export const metadata = {
    title: 'Pricing — Prisfol',
    description: 'Simple credit-based plans and one-time credit packs for the Prisfol platform.',
};

const accentRing: Record<NonNullable<PlanDisplay['accent']>, string> = {
    neutral: 'border-slate-200',
    highlight: 'border-accent-primary ring-1 ring-accent-primary',
    premium: 'border-slate-900',
};

function PlanCard({ plan }: { plan: PlanDisplay }) {
    const accent = plan.accent ?? 'neutral';
    return (
        <div className={`relative flex flex-col rounded-2xl border bg-white p-6 ${accentRing[accent]}`}>
            {accent === 'highlight' && (
                <span className="absolute -top-2.5 left-6 rounded-full bg-accent-primary px-2.5 py-1 text-[7px] font-black uppercase tracking-[0.3em] text-slate-900">
                    Most popular
                </span>
            )}
            <h3 className="text-lg font-black uppercase font-display tracking-tight text-slate-900">{plan.name}</h3>
            <p className="mt-1 text-[12px] text-slate-500">{plan.tagline}</p>

            <div className="mt-5 flex items-baseline gap-1">
                <span className="text-3xl font-black font-display text-slate-900">${plan.priceMonthly}</span>
                <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-slate-400">/ mo</span>
            </div>
            {plan.priceYearly != null && plan.priceYearly > 0 && (
                <p className="mt-1 text-[11px] text-slate-400">
                    or <Strong>${plan.priceYearly}</Strong> billed yearly
                </p>
            )}

            <p className="mt-4 text-[12px] font-bold uppercase tracking-[0.15em] text-accent-primary">
                {plan.monthlyCredits.toLocaleString()} credits / month
            </p>

            <ul className="mt-5 space-y-2.5 border-t border-slate-100 pt-5">
                {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5 text-[13px] leading-snug text-slate-600">
                        <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-primary" />
                        <span>{feature}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

function PackCard({ pack }: { pack: CreditPack }) {
    const perCredit = (pack.price / pack.credits).toFixed(3);
    return (
        <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6">
            <h3 className="text-base font-black uppercase font-display tracking-tight text-slate-900">{pack.name}</h3>
            <p className="mt-1 text-[12px] text-slate-500">{pack.tagline}</p>
            <div className="mt-5 flex items-baseline gap-1">
                <span className="text-2xl font-black font-display text-slate-900">${pack.price}</span>
            </div>
            <p className="mt-2 text-[12px] font-bold uppercase tracking-[0.15em] text-accent-primary">
                {pack.credits.toLocaleString()} credits
            </p>
            <p className="mt-1 text-[11px] text-slate-400">≈ ${perCredit} per credit</p>
        </div>
    );
}

export default function PricingPage() {
    return (
        <article>
            <header className="mb-16 space-y-4">
                <span className="text-[7px] font-black uppercase tracking-[0.5em] text-accent-primary opacity-70">Plans</span>
                <h1 className="text-3xl md:text-5xl font-black leading-tight uppercase font-display text-slate-900">
                    Pricing
                </h1>
                <p className="max-w-xl text-[14px] leading-relaxed text-slate-500">
                    Every plan runs on credits — you spend them when you generate. Start free, and upgrade or top up
                    whenever you need more. No hidden fees; taxes are handled at checkout.
                </p>
            </header>

            <section className="mb-20">
                <h2 className="mb-6 text-base md:text-lg font-black uppercase font-display tracking-tight text-slate-900">
                    Monthly plans
                </h2>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
                    {PLANS.map((plan) => (
                        <PlanCard key={plan.id} plan={plan} />
                    ))}
                </div>
                <p className="mt-4 text-[11px] text-slate-400">
                    Annual billing saves you roughly two months versus paying monthly.
                </p>
            </section>

            <section className="mb-20">
                <h2 className="mb-2 text-base md:text-lg font-black uppercase font-display tracking-tight text-slate-900">
                    One-time credit packs
                </h2>
                <p className="mb-6 max-w-xl text-[13px] leading-relaxed text-slate-500">
                    Need a burst of credits without changing your plan? Top-up packs work on any tier, including Free.
                </p>
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
                    {CREDIT_PACKS.map((pack) => (
                        <PackCard key={pack.id} pack={pack} />
                    ))}
                </div>
            </section>

            <Section title="Frequently asked questions">
                <P>
                    <Strong>What is a credit?</Strong> Credits are how you pay for generative work. Each action —
                    generating an image, running a model, processing an asset — consumes a number of credits that
                    depends on the model and settings used. Lighter actions cost less; premium models cost more.
                </P>
                <P>
                    <Strong>Do unused credits roll over?</Strong> On paid plans, credits you don&apos;t use roll over
                    to the next month while your subscription is active. Free-plan credits refill monthly and do not
                    accumulate. Specific expiration and rollover rules are shown at the point of purchase.
                </P>
                <P>
                    <Strong>Can I change plans or buy more later?</Strong> Yes. You can upgrade, downgrade or cancel at
                    any time from inside the app, and one-time credit packs can be added to any plan whenever you run low.
                </P>
                <P>
                    <Strong>What about taxes?</Strong> Prices shown exclude tax. Any applicable sales tax, VAT or GST is
                    calculated and added at checkout by our payment provider, Paddle, based on your billing location.
                </P>
                <P>
                    For the full commercial terms, see our{' '}
                    <a href="/legal/terms" className="text-accent-primary hover:underline">Terms of Service</a> and{' '}
                    <a href="/legal/refund" className="text-accent-primary hover:underline">Refund &amp; Cancellation Policy</a>.
                </P>
            </Section>
        </article>
    );
}
