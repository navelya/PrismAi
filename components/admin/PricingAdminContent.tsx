'use client';

import React, { useEffect, useState } from 'react';
import { ArrowLeft, Save, AlertTriangle } from 'lucide-react';
import { pricingAdminApi, type AdminPlanRow, type AdminPackRow, type PricingAuditRow } from '@/lib/api/admin-pricing';
import { ConfirmationModal } from '@/components/ui/ConfirmationModal';

type Tab = 'plans' | 'packs';

export function PricingAdminContent({ onMobileBack }: { onMobileBack: () => void }) {
    const [tab, setTab] = useState<Tab>('plans');
    const [plans, setPlans] = useState<AdminPlanRow[]>([]);
    const [packs, setPacks] = useState<AdminPackRow[]>([]);
    const [audit, setAudit] = useState<PricingAuditRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = async () => {
        setLoading(true);
        try {
            const data = await pricingAdminApi.get();
            setPlans(data.plans);
            setPacks(data.packs);
            setAudit(data.audit);
            setError(null);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { load(); }, []);

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center gap-3">
                <button onClick={onMobileBack} className="md:hidden p-2 rounded-lg hover:bg-white/5">
                    <ArrowLeft className="w-4 h-4" />
                </button>
                <h1 className="text-xl font-black font-display">Pricing</h1>
            </div>

            <div className="flex items-center bg-white/5 p-1 rounded-2xl border border-white/10 w-fit">
                {(['plans', 'packs'] as Tab[]).map((t) => (
                    <button
                        key={t}
                        onClick={() => setTab(t)}
                        className={`px-5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
                            tab === t ? 'bg-white/10 text-content-primary ring-1 ring-white/20' : 'text-content-tertiary hover:text-content-secondary'
                        }`}
                    >
                        {t === 'plans' ? 'Plans' : 'Credit Packs'}
                    </button>
                ))}
            </div>

            {error && <div className="text-red-400 text-sm">{error}</div>}
            {loading ? (
                <div className="text-content-tertiary text-sm">Loading…</div>
            ) : tab === 'plans' ? (
                <PlansEditor plans={plans} onSaved={load} />
            ) : (
                <PacksEditor packs={packs} onSaved={load} />
            )}

            <AuditList audit={audit} />
        </div>
    );
}

function PlansEditor({ plans, onSaved }: { plans: AdminPlanRow[]; onSaved: () => void }) {
    return (
        <div className="space-y-4">
            {plans.map((p) => <PlanRow key={p.id} plan={p} onSaved={onSaved} />)}
        </div>
    );
}

function PlanRow({ plan, onSaved }: { plan: AdminPlanRow; onSaved: () => void }) {
    const isFree = plan.id === 'free';
    const [monthly, setMonthly] = useState((plan.price_cents ?? 0) / 100);
    const [yearly, setYearly] = useState((plan.price_yearly_cents ?? 0) / 100);
    const [credits, setCredits] = useState(plan.monthly_floor);
    const [active, setActive] = useState(plan.is_active);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const moneyChanged = monthly !== (plan.price_cents ?? 0) / 100 || yearly !== (plan.price_yearly_cents ?? 0) / 100;
    const anyChanged = moneyChanged || credits !== plan.monthly_floor || active !== plan.is_active;

    const doSave = async () => {
        setSaving(true);
        setErr(null);
        try {
            const patch = isFree
                ? { monthly_floor: credits, is_active: active }
                : {
                    price_monthly_dollars: monthly,
                    price_yearly_dollars: yearly,
                    monthly_floor: credits,
                    is_active: active,
                };
            await pricingAdminApi.updatePlan(plan.id, patch);
            setConfirmOpen(false);
            onSaved();
        } catch (e: any) {
            setErr(e.message);
        } finally {
            setSaving(false);
        }
    };

    const onSaveClick = () => {
        if (moneyChanged) setConfirmOpen(true);
        else doSave();
    };

    return (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
            <div className="flex items-center justify-between">
                <span className="font-bold">{plan.display_name}</span>
                <label className="flex items-center gap-2 text-xs text-content-tertiary">
                    <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} disabled={isFree} />
                    Active
                </label>
            </div>
            {!isFree && (
                <div className="grid grid-cols-3 gap-3">
                    <Field label="Monthly $" value={monthly} onChange={setMonthly} />
                    <Field label="Yearly $" value={yearly} onChange={setYearly} />
                    <Field label="Monthly credits" value={credits} onChange={setCredits} step={1} />
                </div>
            )}
            {isFree && (
                <div className="grid grid-cols-3 gap-3">
                    <Field label="Monthly credits" value={credits} onChange={setCredits} step={1} />
                </div>
            )}
            {err && <div className="text-red-400 text-xs">{err}</div>}
            <button
                onClick={onSaveClick}
                disabled={!anyChanged || saving}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 text-xs font-bold disabled:opacity-40"
            >
                <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save'}
            </button>

            <ConfirmationModal
                isOpen={confirmOpen}
                onClose={() => setConfirmOpen(false)}
                onConfirm={doSave}
                title="Create a new Paddle price?"
                message={`This creates a new Paddle price for ${plan.display_name}. Existing subscribers keep their current price; new purchases use the new amount.`}
                confirmText="Create & apply"
            />
        </div>
    );
}

function PacksEditor({ packs, onSaved }: { packs: AdminPackRow[]; onSaved: () => void }) {
    return (
        <div className="space-y-4">
            {packs.map((p) => <PackRow key={p.id} pack={p} onSaved={onSaved} />)}
        </div>
    );
}

function PackRow({ pack, onSaved }: { pack: AdminPackRow; onSaved: () => void }) {
    const [price, setPrice] = useState(pack.price_cents / 100);
    const [credits, setCredits] = useState(pack.credits);
    const [active, setActive] = useState(pack.is_active);
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const moneyChanged = price !== pack.price_cents / 100;
    const anyChanged = moneyChanged || credits !== pack.credits || active !== pack.is_active;

    const doSave = async () => {
        setSaving(true);
        setErr(null);
        try {
            await pricingAdminApi.updatePack(pack.id, { price_dollars: price, credits, is_active: active });
            setConfirmOpen(false);
            onSaved();
        } catch (e: any) {
            setErr(e.message);
        } finally {
            setSaving(false);
        }
    };

    const onSaveClick = () => {
        if (moneyChanged) setConfirmOpen(true);
        else doSave();
    };

    return (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4 space-y-3">
            <div className="flex items-center justify-between">
                <span className="font-bold">{pack.display_name}</span>
                <label className="flex items-center gap-2 text-xs text-content-tertiary">
                    <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
                    Active
                </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
                <Field label="Price $" value={price} onChange={setPrice} />
                <Field label="Credits" value={credits} onChange={setCredits} step={1} />
            </div>
            {err && <div className="text-red-400 text-xs">{err}</div>}
            <button
                onClick={onSaveClick}
                disabled={!anyChanged || saving}
                className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 text-xs font-bold disabled:opacity-40"
            >
                <Save className="w-3.5 h-3.5" /> {saving ? 'Saving…' : 'Save'}
            </button>

            <ConfirmationModal
                isOpen={confirmOpen}
                onClose={() => setConfirmOpen(false)}
                onConfirm={doSave}
                title="Create a new Paddle price?"
                message={`This creates a new Paddle price for the ${pack.display_name} pack. Future purchases use the new amount.`}
                confirmText="Create & apply"
            />
        </div>
    );
}

function Field({ label, value, onChange, step = 0.01 }: { label: string; value: number; onChange: (n: number) => void; step?: number }) {
    return (
        <label className="block">
            <span className="block text-[10px] uppercase tracking-wider text-content-tertiary mb-1">{label}</span>
            <input
                type="number"
                step={step}
                min={0}
                value={value}
                onChange={(e) => onChange(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-black/30 border border-white/10 text-sm"
            />
        </label>
    );
}

function AuditList({ audit }: { audit: PricingAuditRow[] }) {
    if (!audit.length) return null;
    return (
        <details className="rounded-2xl border border-white/10 bg-white/5 p-4">
            <summary className="cursor-pointer text-xs font-bold uppercase tracking-wider text-content-tertiary flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5" /> Change history ({audit.length})
            </summary>
            <ul className="mt-3 space-y-1 text-xs text-content-secondary">
                {audit.map((a) => (
                    <li key={a.id}>
                        <span className="text-content-tertiary">{new Date(a.created_at).toLocaleString()}</span>{' '}
                        — {a.entity_type} <b>{a.entity_id}</b>.{a.field}: {a.old_value ?? '∅'} → {a.new_value ?? '∅'}
                        {a.paddle_price_id_created ? ` (new price ${a.paddle_price_id_created})` : ''}
                    </li>
                ))}
            </ul>
        </details>
    );
}
