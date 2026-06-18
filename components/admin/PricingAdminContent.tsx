'use client';

import React, { useEffect, useState, useCallback } from 'react';
import {
    ArrowLeft, Save, AlertTriangle, Plus, Trash2, RefreshCw,
    CheckCircle2, AlertCircle, Loader2, X,
} from 'lucide-react';
import {
    pricingAdminApi,
    type AdminPlanRow,
    type AdminPackRow,
    type PricingAuditRow,
    type PlanPatch,
    type PackPatch,
    type SyncResult,
} from '@/lib/api/admin-pricing';
import { Modal } from '@/components/ui/Modal';
import { ConfirmationModal } from '@/components/ui/ConfirmationModal';
import { Input } from '@/components/ui/Input';
import { NumberInput } from '@/components/ui/NumberInput';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const SLUG_RE = /^[a-z0-9-]+$/;

const ACCENT_OPTIONS = [
    { id: 'neutral', display_name: 'Neutral' },
    { id: 'highlight', display_name: 'Highlight' },
    { id: 'premium', display_name: 'Premium' },
];

/** Convert cents integer to display dollar float (e.g. 999 → 9.99). */
const centsToDollars = (cents: number | null | undefined): number =>
    cents == null ? 0 : cents / 100;

/** Convert dollar float to integer cents (e.g. 9.99 → 999). */
const dollarsToCents = (dollars: number): number => Math.round(dollars * 100);

// ─────────────────────────────────────────────────────────────────────────────
// Synced badge
// ─────────────────────────────────────────────────────────────────────────────

function SyncedBadge({
    synced,
    monthlyId,
    yearlyId,
    packId,
}: {
    synced: boolean;
    monthlyId?: string | null;
    yearlyId?: string | null;
    packId?: string | null;
}) {
    if (synced) {
        return (
            <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-1.5 text-emerald-400">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    <span className="text-[10px] font-bold uppercase tracking-wider">Synced</span>
                </div>
                {monthlyId && (
                    <span className="text-[9px] text-content-tertiary font-mono leading-tight truncate max-w-[14rem]">{monthlyId}</span>
                )}
                {yearlyId && (
                    <span className="text-[9px] text-content-tertiary font-mono leading-tight truncate max-w-[14rem]">{yearlyId}</span>
                )}
                {packId && (
                    <span className="text-[9px] text-content-tertiary font-mono leading-tight truncate max-w-[14rem]">{packId}</span>
                )}
            </div>
        );
    }
    return (
        <div className="flex items-center gap-1.5 text-amber-400">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span className="text-[10px] font-bold uppercase tracking-wider">Needs sync</span>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Features list editor
// ─────────────────────────────────────────────────────────────────────────────

function FeaturesEditor({
    features,
    onChange,
}: {
    features: string[];
    onChange: (f: string[]) => void;
}) {
    return (
        <div className="space-y-2">
            <span className="text-[10px] font-bold text-content-tertiary uppercase tracking-[0.1em] pl-1 opacity-80">
                Features
            </span>
            <div className="space-y-1.5">
                {features.map((f, i) => (
                    <div key={i} className="flex items-center gap-2">
                        <Input
                            variant="minimal"
                            value={f}
                            onChange={(e) => {
                                const next = [...features];
                                next[i] = e.target.value;
                                onChange(next);
                            }}
                            placeholder={`Feature ${i + 1}`}
                        />
                        <button
                            type="button"
                            onClick={() => onChange(features.filter((_, j) => j !== i))}
                            className="p-1.5 text-content-tertiary hover:text-red-400 transition-colors rounded-lg hover:bg-red-400/10 shrink-0"
                            aria-label="Remove feature"
                        >
                            <X className="w-3.5 h-3.5" />
                        </button>
                    </div>
                ))}
                <button
                    type="button"
                    onClick={() => onChange([...features, ''])}
                    className="flex items-center gap-1.5 text-[10px] font-bold text-content-tertiary uppercase tracking-wider hover:text-content-primary transition-colors px-1 py-1"
                >
                    <Plus className="w-3 h-3" /> Add feature
                </button>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Plan card
// ─────────────────────────────────────────────────────────────────────────────

function PlanRow({ plan, onSaved }: { plan: AdminPlanRow; onSaved: () => void }) {
    const isFree = plan.id === 'free';

    const [name, setName] = useState(plan.display_name);
    const [tagline, setTagline] = useState(plan.tagline ?? '');
    const [features, setFeatures] = useState<string[]>(plan.features ?? []);
    const [accent, setAccent] = useState<string>(plan.accent ?? 'neutral');
    const [monthly, setMonthly] = useState(centsToDollars(plan.price_cents));
    const [yearly, setYearly] = useState(centsToDollars(plan.price_yearly_cents));
    const [credits, setCredits] = useState(plan.monthly_floor);
    const [bonus, setBonus] = useState(plan.signup_bonus);
    const [active, setActive] = useState(plan.is_active);
    const [sortOrder, setSortOrder] = useState(plan.sort_order);

    const [saving, setSaving] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [syncMsg, setSyncMsg] = useState<string | null>(null);

    const anyChanged =
        name !== plan.display_name ||
        tagline !== (plan.tagline ?? '') ||
        JSON.stringify(features) !== JSON.stringify(plan.features ?? []) ||
        accent !== (plan.accent ?? 'neutral') ||
        (!isFree && monthly !== centsToDollars(plan.price_cents)) ||
        (!isFree && yearly !== centsToDollars(plan.price_yearly_cents)) ||
        credits !== plan.monthly_floor ||
        bonus !== plan.signup_bonus ||
        active !== plan.is_active ||
        sortOrder !== plan.sort_order;

    const doSave = async () => {
        setSaving(true);
        setErr(null);
        setSyncMsg(null);
        try {
            const patch: PlanPatch = {
                display_name: name.trim(),
                tagline: tagline.trim() || null,
                features,
                accent: accent as PlanPatch['accent'],
                monthly_floor: credits,
                signup_bonus: bonus,
                is_active: active,
                sort_order: sortOrder,
            };
            if (!isFree) {
                patch.price_cents = dollarsToCents(monthly);
                patch.price_yearly_cents = yearly > 0 ? dollarsToCents(yearly) : null;
            }
            const result = await pricingAdminApi.updatePlan(plan.id, patch);
            if (result.dodo_sync_error) {
                setSyncMsg(`Saved. Dodo sync failed: ${result.dodo_sync_error}`);
            }
            onSaved();
        } catch (e: unknown) {
            setErr(e instanceof Error ? e.message : 'Save failed');
        } finally {
            setSaving(false);
        }
    };

    const doDelete = async () => {
        setErr(null);
        try {
            await pricingAdminApi.deletePlan(plan.id);
            onSaved();
        } catch (e: unknown) {
            setErr(e instanceof Error ? e.message : 'Delete failed');
        }
    };

    const doSync = async () => {
        setSyncing(true);
        setErr(null);
        setSyncMsg(null);
        try {
            const result = await pricingAdminApi.sync({ scope: 'plan', id: plan.id });
            const r = result.results[0];
            if (r?.ok) {
                setSyncMsg('Synced to Dodo successfully.');
            } else {
                setSyncMsg(`Sync failed: ${r?.error ?? 'Unknown error'}`);
            }
            onSaved();
        } catch (e: unknown) {
            setErr(e instanceof Error ? e.message : 'Sync failed');
        } finally {
            setSyncing(false);
        }
    };

    return (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="font-bold text-sm">{plan.display_name}</span>
                    <span className="text-[10px] text-content-tertiary font-mono">{plan.id}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                    <SyncedBadge
                        synced={plan.synced}
                        monthlyId={plan.dodo_product_id_monthly}
                        yearlyId={plan.dodo_product_id_yearly}
                    />
                    <Switch label="Active" checked={active} onCheckedChange={setActive} size="sm" />
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
                <Input label="Name" variant="minimal" value={name} onChange={(e) => setName(e.target.value)} />
                <Input
                    label="Tagline"
                    variant="minimal"
                    value={tagline}
                    onChange={(e) => setTagline(e.target.value)}
                    placeholder="Short descriptor…"
                />
            </div>

            {!isFree && (
                <div className="grid grid-cols-2 gap-3">
                    <NumberInput
                        label="Monthly $"
                        value={monthly}
                        step={0.01}
                        min={0}
                        variant="minimal"
                        onChange={(e) => setMonthly(Number(e.target.value))}
                    />
                    <NumberInput
                        label="Yearly $"
                        value={yearly}
                        step={0.01}
                        min={0}
                        variant="minimal"
                        onChange={(e) => setYearly(Number(e.target.value))}
                    />
                </div>
            )}

            <div className="grid grid-cols-3 gap-3">
                <NumberInput
                    label="Monthly credits"
                    value={credits}
                    step={1}
                    min={0}
                    variant="minimal"
                    onChange={(e) => setCredits(Number(e.target.value))}
                />
                <NumberInput
                    label="Signup bonus"
                    value={bonus}
                    step={1}
                    min={0}
                    variant="minimal"
                    onChange={(e) => setBonus(Number(e.target.value))}
                />
                <NumberInput
                    label="Sort order"
                    value={sortOrder}
                    step={1}
                    variant="minimal"
                    onChange={(e) => setSortOrder(Number(e.target.value))}
                />
            </div>

            <Select
                label="Accent"
                variant="minimal"
                options={ACCENT_OPTIONS}
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
            />

            <FeaturesEditor features={features} onChange={setFeatures} />

            {err && <div className="text-red-400 text-xs">{err}</div>}
            {syncMsg && (
                <div className={`text-xs ${syncMsg.startsWith('Synced') ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {syncMsg}
                </div>
            )}

            <div className="flex items-center gap-2 flex-wrap">
                <button
                    onClick={doSave}
                    disabled={!anyChanged || saving}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 text-xs font-bold disabled:opacity-40 hover:bg-white/15 transition-colors"
                >
                    {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                    {saving ? 'Saving…' : 'Save'}
                </button>

                {!isFree && (
                    <>
                        <button
                            onClick={doSync}
                            disabled={syncing}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-xs font-bold disabled:opacity-40 hover:bg-white/10 transition-colors text-content-secondary"
                        >
                            {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                            {syncing ? 'Syncing…' : 'Sync to Dodo'}
                        </button>

                        <button
                            onClick={() => setConfirmDeleteOpen(true)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-500/10 border border-red-500/20 text-xs font-bold text-red-400 hover:bg-red-500/20 transition-colors ml-auto"
                        >
                            <Trash2 className="w-3 h-3" /> Delete
                        </button>
                    </>
                )}
            </div>

            <ConfirmationModal
                isOpen={confirmDeleteOpen}
                onClose={() => setConfirmDeleteOpen(false)}
                onConfirm={doDelete}
                title={`Delete plan "${plan.display_name}"?`}
                message="This will soft-delete the plan and archive its Dodo products. Existing subscribers keep their plan; the plan is hidden from new purchases."
                confirmText="Delete plan"
                variant="danger"
            />
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Add plan modal
// ─────────────────────────────────────────────────────────────────────────────

function AddPlanModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
    const [id, setId] = useState('');
    const [name, setName] = useState('');
    const [tagline, setTagline] = useState('');
    const [features, setFeatures] = useState<string[]>([]);
    const [accent, setAccent] = useState('neutral');
    const [monthly, setMonthly] = useState(0);
    const [yearly, setYearly] = useState(0);
    const [credits, setCredits] = useState(0);
    const [bonus, setBonus] = useState(0);
    const [sortOrder, setSortOrder] = useState(0);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const reset = () => {
        setId(''); setName(''); setTagline(''); setFeatures([]);
        setAccent('neutral'); setMonthly(0); setYearly(0);
        setCredits(0); setBonus(0); setSortOrder(0);
        setSaving(false); setErr(null);
    };

    const handleClose = () => { reset(); onClose(); };

    const slugErr = id && !SLUG_RE.test(id) ? 'Must be lowercase letters, numbers, or hyphens' : null;

    const doCreate = async () => {
        if (!id.trim() || !SLUG_RE.test(id)) { setErr('Valid slug required'); return; }
        if (!name.trim()) { setErr('Name required'); return; }
        setSaving(true);
        setErr(null);
        try {
            await pricingAdminApi.createPlan({
                id: id.trim(),
                display_name: name.trim(),
                tagline: tagline.trim() || undefined,
                features,
                accent: accent as 'neutral' | 'highlight' | 'premium',
                price_cents: dollarsToCents(monthly),
                price_yearly_cents: yearly > 0 ? dollarsToCents(yearly) : null,
                monthly_floor: credits,
                signup_bonus: bonus,
                sort_order: sortOrder,
            });
            onSaved();
            handleClose();
        } catch (e: unknown) {
            setErr(e instanceof Error ? e.message : 'Create failed');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal open={open} onOpenChange={(o) => !o && handleClose()} size="lg">
            <Modal.Header>
                <Modal.Title>Add plan</Modal.Title>
                <Modal.Description>Create a new pricing plan. A Dodo product will be provisioned automatically.</Modal.Description>
            </Modal.Header>
            <Modal.Body className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                    <Input
                        label="ID (slug)"
                        required
                        value={id}
                        onChange={(e) => setId(e.target.value.toLowerCase())}
                        placeholder="e.g. pro-plus"
                        error={slugErr ?? undefined}
                    />
                    <Input
                        label="Display name"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. Pro Plus"
                    />
                </div>
                <Input
                    label="Tagline"
                    value={tagline}
                    onChange={(e) => setTagline(e.target.value)}
                    placeholder="Short descriptor…"
                />
                <div className="grid grid-cols-2 gap-3">
                    <NumberInput
                        label="Monthly price $"
                        value={monthly}
                        step={0.01}
                        min={0}
                        onChange={(e) => setMonthly(Number(e.target.value))}
                    />
                    <NumberInput
                        label="Yearly price $ (optional)"
                        value={yearly}
                        step={0.01}
                        min={0}
                        onChange={(e) => setYearly(Number(e.target.value))}
                    />
                </div>
                <div className="grid grid-cols-3 gap-3">
                    <NumberInput
                        label="Monthly credits"
                        value={credits}
                        step={1}
                        min={0}
                        onChange={(e) => setCredits(Number(e.target.value))}
                    />
                    <NumberInput
                        label="Signup bonus"
                        value={bonus}
                        step={1}
                        min={0}
                        onChange={(e) => setBonus(Number(e.target.value))}
                    />
                    <NumberInput
                        label="Sort order"
                        value={sortOrder}
                        step={1}
                        onChange={(e) => setSortOrder(Number(e.target.value))}
                    />
                </div>
                <Select
                    label="Accent"
                    options={ACCENT_OPTIONS}
                    value={accent}
                    onChange={(e) => setAccent(e.target.value)}
                />
                <FeaturesEditor features={features} onChange={setFeatures} />
                {err && <div className="text-red-400 text-xs">{err}</div>}
            </Modal.Body>
            <Modal.Footer>
                <button
                    onClick={handleClose}
                    className="px-4 py-2 text-sm font-medium text-content-secondary hover:text-content-primary hover:bg-surface-tertiary rounded-lg transition-colors"
                >
                    Cancel
                </button>
                <button
                    onClick={doCreate}
                    disabled={saving || !!slugErr || !id || !name}
                    className="flex items-center gap-2 px-5 py-2.5 text-xs font-black uppercase tracking-widest text-white bg-accent-primary rounded-lg shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition-all disabled:opacity-40 disabled:pointer-events-none"
                >
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    {saving ? 'Creating…' : 'Create plan'}
                </button>
            </Modal.Footer>
        </Modal>
    );
}

function PlansEditor({ plans, onSaved }: { plans: AdminPlanRow[]; onSaved: () => void }) {
    const [addOpen, setAddOpen] = useState(false);
    return (
        <div className="space-y-4">
            <div className="flex justify-end">
                <button
                    onClick={() => setAddOpen(true)}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-accent-primary/10 border border-accent-primary/20 text-xs font-bold text-accent-primary hover:bg-accent-primary/20 transition-colors"
                >
                    <Plus className="w-3.5 h-3.5" /> Add plan
                </button>
            </div>
            {plans.map((p) => <PlanRow key={p.id} plan={p} onSaved={onSaved} />)}
            <AddPlanModal open={addOpen} onClose={() => setAddOpen(false)} onSaved={onSaved} />
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Pack card
// ─────────────────────────────────────────────────────────────────────────────

function PackRow({ pack, onSaved }: { pack: AdminPackRow; onSaved: () => void }) {
    const [name, setName] = useState(pack.display_name);
    const [tagline, setTagline] = useState(pack.tagline ?? '');
    const [accent, setAccent] = useState<string>(pack.accent ?? 'neutral');
    const [price, setPrice] = useState(centsToDollars(pack.price_cents));
    const [credits, setCredits] = useState(pack.credits);
    const [active, setActive] = useState(pack.is_active);
    const [sortOrder, setSortOrder] = useState(pack.sort_order);

    const [saving, setSaving] = useState(false);
    const [syncing, setSyncing] = useState(false);
    const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [syncMsg, setSyncMsg] = useState<string | null>(null);

    const anyChanged =
        name !== pack.display_name ||
        tagline !== (pack.tagline ?? '') ||
        accent !== (pack.accent ?? 'neutral') ||
        price !== centsToDollars(pack.price_cents) ||
        credits !== pack.credits ||
        active !== pack.is_active ||
        sortOrder !== pack.sort_order;

    const doSave = async () => {
        setSaving(true);
        setErr(null);
        setSyncMsg(null);
        try {
            const patch: PackPatch = {
                display_name: name.trim(),
                tagline: tagline.trim() || null,
                accent: accent as PackPatch['accent'],
                price_cents: dollarsToCents(price),
                credits,
                is_active: active,
                sort_order: sortOrder,
            };
            const result = await pricingAdminApi.updatePack(pack.id, patch);
            if (result.dodo_sync_error) {
                setSyncMsg(`Saved. Dodo sync failed: ${result.dodo_sync_error}`);
            }
            onSaved();
        } catch (e: unknown) {
            setErr(e instanceof Error ? e.message : 'Save failed');
        } finally {
            setSaving(false);
        }
    };

    const doDelete = async () => {
        setErr(null);
        try {
            await pricingAdminApi.deletePack(pack.id);
            onSaved();
        } catch (e: unknown) {
            setErr(e instanceof Error ? e.message : 'Delete failed');
        }
    };

    const doSync = async () => {
        setSyncing(true);
        setErr(null);
        setSyncMsg(null);
        try {
            const result = await pricingAdminApi.sync({ scope: 'pack', id: pack.id });
            const r = result.results[0];
            if (r?.ok) {
                setSyncMsg('Synced to Dodo successfully.');
            } else {
                setSyncMsg(`Sync failed: ${r?.error ?? 'Unknown error'}`);
            }
            onSaved();
        } catch (e: unknown) {
            setErr(e instanceof Error ? e.message : 'Sync failed');
        } finally {
            setSyncing(false);
        }
    };

    return (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
                <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="font-bold text-sm">{pack.display_name}</span>
                    <span className="text-[10px] text-content-tertiary font-mono">{pack.id}</span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                    <SyncedBadge synced={pack.synced} packId={pack.dodo_product_id} />
                    <Switch label="Active" checked={active} onCheckedChange={setActive} size="sm" />
                </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
                <Input label="Name" variant="minimal" value={name} onChange={(e) => setName(e.target.value)} />
                <Input
                    label="Tagline"
                    variant="minimal"
                    value={tagline}
                    onChange={(e) => setTagline(e.target.value)}
                    placeholder="Short descriptor…"
                />
            </div>

            <div className="grid grid-cols-3 gap-3">
                <NumberInput
                    label="Price $"
                    value={price}
                    step={0.01}
                    min={0}
                    variant="minimal"
                    onChange={(e) => setPrice(Number(e.target.value))}
                />
                <NumberInput
                    label="Credits"
                    value={credits}
                    step={1}
                    min={0}
                    variant="minimal"
                    onChange={(e) => setCredits(Number(e.target.value))}
                />
                <NumberInput
                    label="Sort order"
                    value={sortOrder}
                    step={1}
                    variant="minimal"
                    onChange={(e) => setSortOrder(Number(e.target.value))}
                />
            </div>

            <Select
                label="Accent"
                variant="minimal"
                options={ACCENT_OPTIONS}
                value={accent}
                onChange={(e) => setAccent(e.target.value)}
            />

            {err && <div className="text-red-400 text-xs">{err}</div>}
            {syncMsg && (
                <div className={`text-xs ${syncMsg.startsWith('Synced') ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {syncMsg}
                </div>
            )}

            <div className="flex items-center gap-2 flex-wrap">
                <button
                    onClick={doSave}
                    disabled={!anyChanged || saving}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 text-xs font-bold disabled:opacity-40 hover:bg-white/15 transition-colors"
                >
                    {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                    {saving ? 'Saving…' : 'Save'}
                </button>

                <button
                    onClick={doSync}
                    disabled={syncing}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-xs font-bold disabled:opacity-40 hover:bg-white/10 transition-colors text-content-secondary"
                >
                    {syncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
                    {syncing ? 'Syncing…' : 'Sync to Dodo'}
                </button>

                <button
                    onClick={() => setConfirmDeleteOpen(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-500/10 border border-red-500/20 text-xs font-bold text-red-400 hover:bg-red-500/20 transition-colors ml-auto"
                >
                    <Trash2 className="w-3 h-3" /> Delete
                </button>
            </div>

            <ConfirmationModal
                isOpen={confirmDeleteOpen}
                onClose={() => setConfirmDeleteOpen(false)}
                onConfirm={doDelete}
                title={`Delete pack "${pack.display_name}"?`}
                message="This will soft-delete the credit pack and archive its Dodo product. It will be hidden from new purchases."
                confirmText="Delete pack"
                variant="danger"
            />
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Add pack modal
// ─────────────────────────────────────────────────────────────────────────────

function AddPackModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
    const [id, setId] = useState('');
    const [name, setName] = useState('');
    const [tagline, setTagline] = useState('');
    const [accent, setAccent] = useState('neutral');
    const [price, setPrice] = useState(0);
    const [credits, setCredits] = useState(0);
    const [sortOrder, setSortOrder] = useState(0);
    const [saving, setSaving] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    const reset = () => {
        setId(''); setName(''); setTagline(''); setAccent('neutral');
        setPrice(0); setCredits(0); setSortOrder(0);
        setSaving(false); setErr(null);
    };

    const handleClose = () => { reset(); onClose(); };

    const slugErr = id && !SLUG_RE.test(id) ? 'Must be lowercase letters, numbers, or hyphens' : null;

    const doCreate = async () => {
        if (!id.trim() || !SLUG_RE.test(id)) { setErr('Valid slug required'); return; }
        if (!name.trim()) { setErr('Name required'); return; }
        if (credits <= 0) { setErr('Credits must be > 0'); return; }
        setSaving(true);
        setErr(null);
        try {
            await pricingAdminApi.createPack({
                id: id.trim(),
                display_name: name.trim(),
                tagline: tagline.trim() || undefined,
                accent: accent as 'neutral' | 'highlight' | 'premium',
                price_cents: dollarsToCents(price),
                credits,
                sort_order: sortOrder,
            });
            onSaved();
            handleClose();
        } catch (e: unknown) {
            setErr(e instanceof Error ? e.message : 'Create failed');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal open={open} onOpenChange={(o) => !o && handleClose()} size="md">
            <Modal.Header>
                <Modal.Title>Add credit pack</Modal.Title>
                <Modal.Description>Create a new credit pack. A Dodo product will be provisioned automatically.</Modal.Description>
            </Modal.Header>
            <Modal.Body className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                    <Input
                        label="ID (slug)"
                        required
                        value={id}
                        onChange={(e) => setId(e.target.value.toLowerCase())}
                        placeholder="e.g. spark-500"
                        error={slugErr ?? undefined}
                    />
                    <Input
                        label="Display name"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. Spark 500"
                    />
                </div>
                <Input
                    label="Tagline"
                    value={tagline}
                    onChange={(e) => setTagline(e.target.value)}
                    placeholder="Short descriptor…"
                />
                <div className="grid grid-cols-2 gap-3">
                    <NumberInput
                        label="Price $"
                        value={price}
                        step={0.01}
                        min={0}
                        onChange={(e) => setPrice(Number(e.target.value))}
                    />
                    <NumberInput
                        label="Credits"
                        required
                        value={credits}
                        step={1}
                        min={1}
                        onChange={(e) => setCredits(Number(e.target.value))}
                    />
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <Select
                        label="Accent"
                        options={ACCENT_OPTIONS}
                        value={accent}
                        onChange={(e) => setAccent(e.target.value)}
                    />
                    <NumberInput
                        label="Sort order"
                        value={sortOrder}
                        step={1}
                        onChange={(e) => setSortOrder(Number(e.target.value))}
                    />
                </div>
                {err && <div className="text-red-400 text-xs">{err}</div>}
            </Modal.Body>
            <Modal.Footer>
                <button
                    onClick={handleClose}
                    className="px-4 py-2 text-sm font-medium text-content-secondary hover:text-content-primary hover:bg-surface-tertiary rounded-lg transition-colors"
                >
                    Cancel
                </button>
                <button
                    onClick={doCreate}
                    disabled={saving || !!slugErr || !id || !name || credits <= 0}
                    className="flex items-center gap-2 px-5 py-2.5 text-xs font-black uppercase tracking-widest text-white bg-accent-primary rounded-lg shadow-lg hover:shadow-xl hover:scale-105 active:scale-95 transition-all disabled:opacity-40 disabled:pointer-events-none"
                >
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    {saving ? 'Creating…' : 'Create pack'}
                </button>
            </Modal.Footer>
        </Modal>
    );
}

function PacksEditor({ packs, onSaved }: { packs: AdminPackRow[]; onSaved: () => void }) {
    const [addOpen, setAddOpen] = useState(false);
    return (
        <div className="space-y-4">
            <div className="flex justify-end">
                <button
                    onClick={() => setAddOpen(true)}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-accent-primary/10 border border-accent-primary/20 text-xs font-bold text-accent-primary hover:bg-accent-primary/20 transition-colors"
                >
                    <Plus className="w-3.5 h-3.5" /> Add pack
                </button>
            </div>
            {packs.map((p) => <PackRow key={p.id} pack={p} onSaved={onSaved} />)}
            <AddPackModal open={addOpen} onClose={() => setAddOpen(false)} onSaved={onSaved} />
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit list
// ─────────────────────────────────────────────────────────────────────────────

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
                        {a.dodo_product_id_synced ? (
                            <span className="text-emerald-400"> (Dodo {a.dodo_product_id_synced})</span>
                        ) : null}
                    </li>
                ))}
            </ul>
        </details>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Sync-all result summary banner
// ─────────────────────────────────────────────────────────────────────────────

function SyncAllSummary({
    results,
    onClose,
}: {
    results: SyncResult[];
    onClose: () => void;
}) {
    const ok = results.filter((r) => r.ok);
    const failed = results.filter((r) => !r.ok);
    return (
        <div className="rounded-2xl border border-white/10 bg-surface-primary p-4 space-y-2 text-xs">
            <div className="flex items-center justify-between">
                <span className="font-bold text-sm">Sync all — complete</span>
                <button
                    onClick={onClose}
                    className="p-1 text-content-tertiary hover:text-content-primary rounded-lg transition-colors"
                    aria-label="Dismiss"
                >
                    <X className="w-4 h-4" />
                </button>
            </div>
            {ok.length > 0 && (
                <div className="text-emerald-400">
                    Synced ({ok.length}): {ok.map((r) => `${r.type}/${r.id}`).join(', ')}
                </div>
            )}
            {failed.length > 0 && (
                <div className="text-red-400 space-y-0.5">
                    <div>Failed ({failed.length}):</div>
                    {failed.map((r) => (
                        <div key={`${r.type}/${r.id}`} className="pl-2 font-mono">
                            {r.type}/{r.id}: {r.error}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root component
// ─────────────────────────────────────────────────────────────────────────────

type Tab = 'plans' | 'packs';

export function PricingAdminContent({ onMobileBack }: { onMobileBack: () => void }) {
    const [tab, setTab] = useState<Tab>('plans');
    const [plans, setPlans] = useState<AdminPlanRow[]>([]);
    const [packs, setPacks] = useState<AdminPackRow[]>([]);
    const [audit, setAudit] = useState<PricingAuditRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [syncingAll, setSyncingAll] = useState(false);
    const [syncAllResults, setSyncAllResults] = useState<SyncResult[] | null>(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const data = await pricingAdminApi.get();
            setPlans(data.plans);
            setPacks(data.packs);
            setAudit(data.audit);
            setError(null);
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Load failed');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const doSyncAll = async () => {
        setSyncingAll(true);
        setSyncAllResults(null);
        setError(null);
        try {
            const result = await pricingAdminApi.sync({ scope: 'all' });
            setSyncAllResults(result.results);
            load();
        } catch (e: unknown) {
            setError(e instanceof Error ? e.message : 'Sync all failed');
        } finally {
            setSyncingAll(false);
        }
    };

    return (
        <div className="p-6 space-y-6">
            {/* Page header */}
            <div className="flex items-center gap-3">
                <button onClick={onMobileBack} className="md:hidden p-2 rounded-lg hover:bg-white/5">
                    <ArrowLeft className="w-4 h-4" />
                </button>
                <h1 className="text-xl font-black font-display flex-1">Pricing</h1>
                <button
                    onClick={doSyncAll}
                    disabled={syncingAll || loading}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/5 border border-white/10 text-xs font-bold text-content-secondary hover:bg-white/10 transition-colors disabled:opacity-40"
                >
                    {syncingAll
                        ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        : <RefreshCw className="w-3.5 h-3.5" />}
                    {syncingAll ? 'Syncing all…' : 'Sync all to Dodo'}
                </button>
            </div>

            {/* Tab switcher */}
            <div className="flex items-center bg-white/5 p-1 rounded-2xl border border-white/10 w-fit">
                {(['plans', 'packs'] as Tab[]).map((t) => (
                    <button
                        key={t}
                        onClick={() => setTab(t)}
                        className={`px-5 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
                            tab === t
                                ? 'bg-white/10 text-content-primary ring-1 ring-white/20'
                                : 'text-content-tertiary hover:text-content-secondary'
                        }`}
                    >
                        {t === 'plans' ? 'Plans' : 'Credit Packs'}
                    </button>
                ))}
            </div>

            {/* Global error */}
            {error && <div className="text-red-400 text-sm">{error}</div>}

            {/* Sync-all summary */}
            {syncAllResults && (
                <SyncAllSummary results={syncAllResults} onClose={() => setSyncAllResults(null)} />
            )}

            {/* Main content */}
            {loading ? (
                <div className="flex items-center gap-2 text-content-tertiary text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                </div>
            ) : tab === 'plans' ? (
                <PlansEditor plans={plans} onSaved={load} />
            ) : (
                <PacksEditor packs={packs} onSaved={load} />
            )}

            <AuditList audit={audit} />
        </div>
    );
}
