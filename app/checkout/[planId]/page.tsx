'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, Lock } from 'lucide-react';
import { Logo } from '@/components/ui/Logo';
import { createClient } from '@/lib/supabase/client';
import { usePricing, getPlanFrom } from '@/lib/billing/use-pricing';
import { marketingUrl } from '@/lib/domains';

type Cycle = 'monthly' | 'yearly';

export default function CheckoutPage() {
    const params = useParams();
    const searchParams = useSearchParams();
    const router = useRouter();

    const planId = (params?.planId as string) || '';
    const initialCycle: Cycle = searchParams?.get('cycle') === 'yearly' ? 'yearly' : 'monthly';

    const { plans, loading: pricingLoading } = usePricing();
    const [cycle, setCycle] = useState<Cycle>(initialCycle);
    const [user, setUser] = useState<{ id: string; email: string } | null>(null);
    const [authChecked, setAuthChecked] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const plan = getPlanFrom(plans, planId);

    // Auth gate — redirect to login if not signed in.
    useEffect(() => {
        (async () => {
            const supabase = createClient();
            const { data: { user: u } } = await supabase.auth.getUser();
            if (!u || !u.email) {
                const next = `/checkout/${planId}?cycle=${cycle}`;
                router.push(`/login?redirect=${encodeURIComponent(next)}`);
                return;
            }
            setUser({ id: u.id, email: u.email });
            setAuthChecked(true);
        })();
        // intentionally only on mount — cycle changes shouldn't re-check auth
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleCycleChange = useCallback((next: Cycle) => {
        if (next === cycle) return;
        setCycle(next);
        const url = new URL(window.location.href);
        url.searchParams.set('cycle', next);
        window.history.replaceState({}, '', url.toString());
    }, [cycle]);

    const handleSubscribe = useCallback(async () => {
        if (submitting || !plan) return;
        setSubmitting(true);
        setError(null);
        try {
            const res = await fetch('/api/billing/checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ planId: plan.id, cycle }),
            });
            const json = await res.json();
            if (!res.ok) {
                setError(json?.message || json?.error || 'Failed to start checkout. Please try again.');
                return;
            }
            if (!json.url) {
                setError('No checkout URL received. Please try again.');
                return;
            }
            window.location.href = json.url;
        } catch (e: any) {
            setError(e?.message || 'Network error. Please try again.');
        } finally {
            setSubmitting(false);
        }
    }, [submitting, plan, cycle]);

    if (pricingLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#020617] text-slate-500">
                <Loader2 className="w-5 h-5 animate-spin" />
            </div>
        );
    }

    if (!plan || plan.id === 'free') {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#020617] text-slate-300 px-6">
                <div className="text-center max-w-md">
                    <p className="text-lg font-semibold text-slate-100 mb-2">Plan not available</p>
                    <p className="text-sm text-slate-400 mb-6">This plan can&rsquo;t be purchased here. Pick one from your account settings.</p>
                    <Link href="/settings?tab=plan-billing" className="text-sky-400 hover:underline text-sm font-medium">
                        Go to Plan &amp; Billing
                    </Link>
                </div>
            </div>
        );
    }

    if (!authChecked) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-[#020617] text-slate-500">
                <Loader2 className="w-5 h-5 animate-spin" />
            </div>
        );
    }

    const monthlyPrice = plan.priceMonthly;
    const yearlyPrice = plan.priceYearly;
    const yearlyAsMonthly = yearlyPrice ? Math.round((yearlyPrice / 12) * 100) / 100 : null;
    const savingsPct = yearlyPrice && monthlyPrice
        ? Math.round((1 - yearlyPrice / (monthlyPrice * 12)) * 100)
        : 0;

    const totalToday = cycle === 'yearly' && yearlyPrice ? yearlyPrice : monthlyPrice;
    const headlinePrice = cycle === 'yearly' && yearlyAsMonthly ? yearlyAsMonthly : monthlyPrice;

    const renews = new Date();
    if (cycle === 'yearly') renews.setFullYear(renews.getFullYear() + 1);
    else renews.setMonth(renews.getMonth() + 1);
    const renewsText = renews.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

    return (
        <div className="min-h-screen w-full bg-[#020617] text-slate-100 antialiased">
            <div className="grid grid-cols-1 lg:grid-cols-2 min-h-screen">

                {/* ─── LEFT — order summary ─────────────────────────────── */}
                <div className="px-6 py-10 lg:px-16 lg:py-16 lg:border-r border-slate-900 flex flex-col">
                    <div className="flex items-center justify-between mb-12 max-w-md mx-auto lg:ml-auto lg:mr-0 w-full">
                        <Link
                            href="/settings?tab=plan-billing"
                            className="flex items-center gap-2 text-slate-500 hover:text-slate-200 transition-colors text-sm font-medium"
                        >
                            <ArrowLeft className="w-4 h-4" />
                            Back
                        </Link>
                        <Logo variant="wordmark" className="h-5 w-auto text-slate-100" />
                    </div>

                    <div className="flex-1 max-w-md mx-auto lg:ml-auto lg:mr-0 w-full">
                        <p className="text-sm text-slate-500 mb-2">Subscribe to</p>
                        <h1 className="text-3xl lg:text-4xl font-semibold font-display text-slate-50 tracking-tight mb-6">
                            Prisfol {plan.name}
                        </h1>

                        <div className="flex items-baseline gap-2 mb-2">
                            <span className="text-5xl font-bold font-display text-sky-400 tabular-nums">
                                ${headlinePrice}
                            </span>
                            <span className="text-slate-400 text-sm">/ month</span>
                        </div>
                        {cycle === 'yearly' && yearlyPrice && (
                            <p className="text-xs text-slate-500 mb-6">${yearlyPrice} billed annually</p>
                        )}
                        {cycle === 'monthly' && (
                            <div className="mb-6" />
                        )}

                        {yearlyPrice && (
                            <div className="inline-flex p-1 bg-slate-900 border border-slate-800 rounded-full mb-10">
                                <button
                                    onClick={() => handleCycleChange('monthly')}
                                    className={`px-4 py-1.5 text-xs font-semibold rounded-full transition-colors ${
                                        cycle === 'monthly'
                                            ? 'bg-slate-800 text-slate-100'
                                            : 'text-slate-500 hover:text-slate-200'
                                    }`}
                                >
                                    Monthly
                                </button>
                                <button
                                    onClick={() => handleCycleChange('yearly')}
                                    className={`px-4 py-1.5 text-xs font-semibold rounded-full transition-colors flex items-center gap-2 ${
                                        cycle === 'yearly'
                                            ? 'bg-slate-800 text-slate-100'
                                            : 'text-slate-500 hover:text-slate-200'
                                    }`}
                                >
                                    Yearly
                                    {savingsPct > 0 && (
                                        <span className="text-[10px] font-bold text-sky-400">−{savingsPct}%</span>
                                    )}
                                </button>
                            </div>
                        )}

                        <div className="border-t border-slate-900 pt-6 space-y-3">
                            <Row
                                label={`Prisfol ${plan.name}${cycle === 'yearly' ? ' (annual)' : ''}`}
                                value={`$${totalToday}.00`}
                            />
                            <Row label="Subtotal" value={`$${totalToday}.00`} />
                            <Row label="VAT" value="Calculated at checkout" muted />
                        </div>

                        <div className="border-t border-slate-900 mt-6 pt-5 flex justify-between items-baseline">
                            <span className="text-slate-100 font-semibold text-sm">Total today</span>
                            <span className="text-3xl font-bold font-display text-sky-400 tabular-nums">
                                ${totalToday}.00
                            </span>
                        </div>

                        <p className="text-xs text-slate-500 mt-6 leading-relaxed">
                            {cycle === 'yearly' ? 'Renews annually' : 'Renews monthly'} on {renewsText}.
                            Cancel any time from your account settings.
                        </p>

                        <p className="text-[11px] text-slate-600 mt-12 leading-relaxed">
                            By subscribing you agree to our{' '}
                            <Link href={marketingUrl('/legal/terms')} className="text-slate-400 hover:text-slate-200 underline-offset-2 hover:underline">Terms</Link>,{' '}
                            <Link href={marketingUrl('/legal/privacy')} className="text-slate-400 hover:text-slate-200 underline-offset-2 hover:underline">Privacy Policy</Link>{' '}
                            and{' '}
                            <Link href={marketingUrl('/legal/refund')} className="text-slate-400 hover:text-slate-200 underline-offset-2 hover:underline">Refund Policy</Link>.
                            Dodo Payments is the merchant of record for this purchase.
                        </p>
                    </div>
                </div>

                {/* ─── RIGHT — checkout confirm ─────────────────────────── */}
                <div className="px-6 py-10 lg:px-16 lg:py-16 flex flex-col">
                    <div className="flex-1 max-w-md mx-auto lg:mx-0 w-full">
                        <div className="flex items-center gap-2 mb-8 text-xs text-slate-500">
                            <Lock className="w-3 h-3" />
                            <span>Secured by Dodo Payments. Sales tax / VAT calculated at checkout.</span>
                        </div>

                        {error && (
                            <div className="mb-6 p-4 rounded-lg bg-red-950/40 border border-red-900/60 text-red-300 text-sm">
                                {error}
                            </div>
                        )}

                        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 mb-6">
                            <p className="text-sm text-slate-400 mb-1">Signed in as</p>
                            <p className="text-sm font-medium text-slate-100 truncate">{user?.email}</p>
                        </div>

                        <button
                            onClick={handleSubscribe}
                            disabled={submitting}
                            className="w-full py-3 px-6 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2"
                        >
                            {submitting ? (
                                <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Redirecting to checkout…
                                </>
                            ) : (
                                `Subscribe — $${totalToday}.00`
                            )}
                        </button>

                        <p className="text-[11px] text-slate-600 mt-4 text-center leading-relaxed">
                            You will be redirected to Dodo Payments to complete your purchase securely.
                        </p>
                    </div>
                </div>

            </div>
        </div>
    );
}

function Row({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
    return (
        <div className="flex justify-between text-sm">
            <span className={muted ? 'text-slate-500' : 'text-slate-300'}>{label}</span>
            <span className={muted ? 'text-slate-500' : 'text-slate-200 tabular-nums'}>{value}</span>
        </div>
    );
}
