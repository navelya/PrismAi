'use client';

import React, { useCallback, useEffect, useState } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import {
    X,
    Mail,
    Calendar,
    Clock,
    Coins,
    Shield,
    Ban,
    UserCheck,
    KeyRound,
    Crown,
    Loader2,
    AlertCircle,
    Image as ImageIcon,
    FileText,
    History,
    ExternalLink,
    Copy,
    Check,
    UserX,
    Film,
    Music,
    Box,
} from 'lucide-react';
import { ConfirmationModal } from '@/components/ui/ConfirmationModal';
import { AdjustTokensModal } from './AdjustTokensModal';
import {
    adminUsersApi,
    type AdminUserDetail,
    type AdminUserListRow,
    type AdminLedgerRow,
    type AdminSessionRow,
    type AdminAssetRow,
    type BanDuration,
} from '@/lib/api/admin-users';

interface Props {
    userId: string | null;
    initialUser?: AdminUserListRow | null;
    currentAdminId: string;
    onClose: () => void;
    onMutated: () => void;
}

function rowToDetail(row: AdminUserListRow): AdminUserDetail {
    return {
        ...row,
        email_confirmed_at: null,
        phone: null,
        subscription: row.plan_id
            ? {
                plan_id: row.plan_id,
                status: row.subscription_status,
                next_topup_at: null,
                current_period_end: null,
                cancel_at_period_end: null,
            }
            : null,
    };
}

type TabId = 'overview' | 'tokens' | 'assets' | 'sessions';

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: 'Overview', icon: <UserCheck className="w-3.5 h-3.5" /> },
    { id: 'tokens', label: 'Tokens', icon: <History className="w-3.5 h-3.5" /> },
    { id: 'assets', label: 'Assets', icon: <ImageIcon className="w-3.5 h-3.5" /> },
    { id: 'sessions', label: 'Sessions', icon: <FileText className="w-3.5 h-3.5" /> },
];

const BAN_OPTIONS: { value: BanDuration; label: string }[] = [
    { value: '24h', label: '24 hours' },
    { value: '7d', label: '7 days' },
    { value: '30d', label: '30 days' },
    { value: 'permanent', label: 'Permanent' },
];

function isBanned(banned_until: string | null): boolean {
    if (!banned_until) return false;
    const t = Date.parse(banned_until);
    if (Number.isNaN(t)) return false;
    return t > Date.now();
}

function formatDateTime(iso: string | null): string {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

const ASSET_TYPE_ICON: Record<AdminAssetRow['result_type'], React.ComponentType<{ className?: string }>> = {
    image: ImageIcon,
    video: Film,
    audio: Music,
    '3d': Box,
};

function humanizeReason(row: AdminLedgerRow): string {
    if (row.reason === 'admin_adjustment') {
        const note = typeof row.metadata?.note === 'string' ? row.metadata.note.trim() : '';
        if (note) return note;
        return row.amount > 0 ? 'Prisfol Gift' : 'Adjustment';
    }
    const labels: Record<string, string> = {
        signup_bonus: 'Signup bonus',
        monthly_topup: 'Monthly refill',
        execution_debit: 'Workflow run',
        execution_refund: 'Refund',
        purchase: 'Credit purchase',
        subscription_grant: 'Subscription grant',
        stripe_refund: 'Stripe refund',
        stripe_chargeback: 'Chargeback',
        paddle_pack_purchase: 'Credit pack',
        paddle_subscription_grant: 'Subscription credits',
        paddle_refund: 'Refund',
        paddle_chargeback: 'Chargeback',
    };
    return labels[row.reason] ?? row.reason;
}

export function UserDetailDrawer({ userId, initialUser, currentAdminId, onClose, onMutated }: Props) {
    const [tab, setTab] = useState<TabId>('overview');
    const [user, setUser] = useState<AdminUserDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [ledger, setLedger] = useState<AdminLedgerRow[]>([]);
    const [ledgerLoading, setLedgerLoading] = useState(false);
    const [assets, setAssets] = useState<AdminAssetRow[]>([]);
    const [assetsLoading, setAssetsLoading] = useState(false);
    const [sessions, setSessions] = useState<AdminSessionRow[]>([]);
    const [sessionsLoading, setSessionsLoading] = useState(false);

    const [showAdjust, setShowAdjust] = useState(false);
    const [confirmBan, setConfirmBan] = useState<BanDuration | null>(null);
    const [confirmUnban, setConfirmUnban] = useState(false);
    const [confirmToggleAdmin, setConfirmToggleAdmin] = useState(false);
    const [confirmReset, setConfirmReset] = useState(false);
    const [actionBusy, setActionBusy] = useState(false);
    const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [copiedId, setCopiedId] = useState(false);

    const open = !!userId;

    const fetchDetail = useCallback(async () => {
        if (!userId) return;
        setDetailLoading(true);
        setError(null);
        try {
            const { user } = await adminUsersApi.detail(userId);
            setUser(user);
        } catch (err: any) {
            setError(err.message || 'Failed to load user');
        } finally {
            setDetailLoading(false);
        }
    }, [userId]);

    useEffect(() => {
        if (open) {
            setTab('overview');
            setActionMessage(null);
            setUser(initialUser ? rowToDetail(initialUser) : null);
            fetchDetail();
        } else {
            setUser(null);
            setLedger([]);
            setAssets([]);
            setSessions([]);
        }
    }, [open, fetchDetail, initialUser]);

    // Prefetch all tabs in parallel when the drawer opens. Subsequent tab
    // switches are instant — data stays in state for the lifetime of this
    // drawer-open. Closing the drawer resets everything (see the open effect).
    useEffect(() => {
        if (!userId) return;
        let cancelled = false;

        setLedgerLoading(true);
        setAssetsLoading(true);
        setSessionsLoading(true);

        adminUsersApi.ledger(userId, 0, 50)
            .then(res => { if (!cancelled) setLedger(res.rows); })
            .catch(err => { if (!cancelled) setActionMessage({ type: 'error', text: err.message || 'Failed to load ledger' }); })
            .finally(() => { if (!cancelled) setLedgerLoading(false); });

        adminUsersApi.assets(userId, 0, 36)
            .then(res => { if (!cancelled) setAssets(res.rows); })
            .catch(err => { if (!cancelled) setActionMessage({ type: 'error', text: err.message || 'Failed to load assets' }); })
            .finally(() => { if (!cancelled) setAssetsLoading(false); });

        adminUsersApi.sessions(userId, 0, 50)
            .then(res => { if (!cancelled) setSessions(res.rows); })
            .catch(err => { if (!cancelled) setActionMessage({ type: 'error', text: err.message || 'Failed to load sessions' }); })
            .finally(() => { if (!cancelled) setSessionsLoading(false); });

        return () => { cancelled = true; };
    }, [userId]);

    const banned = user ? isBanned(user.banned_until) : false;
    const isSelf = user?.id === currentAdminId;

    const doBan = async (duration: BanDuration) => {
        if (!userId) return;
        setActionBusy(true);
        setActionMessage(null);
        try {
            await adminUsersApi.ban(userId, duration);
            setActionMessage({ type: 'success', text: duration === 'none' ? 'User unbanned.' : `User banned (${duration}).` });
            await fetchDetail();
            onMutated();
        } catch (err: any) {
            setActionMessage({ type: 'error', text: err.message || 'Failed to update ban status' });
        } finally {
            setActionBusy(false);
        }
    };

    const doToggleAdmin = async () => {
        if (!userId) return;
        setActionBusy(true);
        setActionMessage(null);
        try {
            const res = await adminUsersApi.toggleAdmin(userId);
            setActionMessage({ type: 'success', text: res.is_admin ? 'User granted admin role.' : 'User admin role removed.' });
            await fetchDetail();
            onMutated();
        } catch (err: any) {
            setActionMessage({ type: 'error', text: err.message || 'Failed to toggle admin' });
        } finally {
            setActionBusy(false);
        }
    };

    const doResetPassword = async () => {
        if (!userId) return;
        setActionBusy(true);
        setActionMessage(null);
        try {
            await adminUsersApi.resetPassword(userId);
            setActionMessage({ type: 'success', text: 'Password reset email queued.' });
        } catch (err: any) {
            setActionMessage({ type: 'error', text: err.message || 'Failed to send reset' });
        } finally {
            setActionBusy(false);
        }
    };

    const handleCopyId = async () => {
        if (!user) return;
        try {
            await navigator.clipboard.writeText(user.id);
            setCopiedId(true);
            setTimeout(() => setCopiedId(false), 1500);
        } catch { /* ignore */ }
    };

    return (
        <>
            <RadixDialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
                <RadixDialog.Portal>
                    <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
                    <RadixDialog.Content
                        className="fixed right-0 top-0 bottom-0 z-50 w-full sm:w-[640px] max-w-full bg-bg-primary/95 backdrop-blur-2xl border-l border-white/10 shadow-2xl flex flex-col data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right"
                    >
                        <RadixDialog.Title className="sr-only">User detail</RadixDialog.Title>
                        <RadixDialog.Description className="sr-only">Manage tokens, ban status, and view this user's content.</RadixDialog.Description>

                        <header className="flex items-start justify-between gap-4 px-6 py-5 border-b border-white/5">
                            {!user && detailLoading ? (
                                <div className="flex items-center gap-2 text-content-tertiary">
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    <span className="text-xs font-medium">Loading…</span>
                                </div>
                            ) : user ? (
                                <div className="flex items-center gap-3 min-w-0">
                                    <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 overflow-hidden flex items-center justify-center shrink-0">
                                        {user.avatar_url ? (
                                            // eslint-disable-next-line @next/next/no-img-element
                                            <img src={user.avatar_url} alt="" className="w-full h-full object-cover" />
                                        ) : (
                                            <span className="text-content-tertiary text-sm font-bold uppercase">
                                                {(user.email ?? '?').slice(0, 1).toUpperCase()}
                                            </span>
                                        )}
                                    </div>
                                    <div className="min-w-0">
                                        <h2 className="text-base font-bold text-content-primary truncate">{user.email ?? '(no email)'}</h2>
                                        <button onClick={handleCopyId} className="flex items-center gap-1.5 text-[10px] font-mono text-content-tertiary hover:text-content-secondary transition-colors mt-0.5 group">
                                            <span className="truncate max-w-[200px]">{user.id}</span>
                                            {copiedId ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3 opacity-0 group-hover:opacity-100" />}
                                        </button>
                                        <div className="flex flex-wrap items-center gap-1.5 mt-2">
                                            {user.is_admin && (
                                                <span className="px-2 py-0.5 bg-accent-primary/10 border border-accent-primary/20 text-accent-primary text-[9px] font-black uppercase tracking-widest rounded-md inline-flex items-center gap-1">
                                                    <Crown className="w-2.5 h-2.5" /> Admin
                                                </span>
                                            )}
                                            {banned && (
                                                <span className="px-2 py-0.5 bg-red-500/10 border border-red-500/20 text-red-400 text-[9px] font-black uppercase tracking-widest rounded-md inline-flex items-center gap-1">
                                                    <Ban className="w-2.5 h-2.5" /> Banned
                                                </span>
                                            )}
                                            {user.subscription?.plan_id && (
                                                <span className="px-2 py-0.5 bg-white/5 border border-white/10 text-content-tertiary text-[9px] font-black uppercase tracking-widest rounded-md">
                                                    {user.subscription.plan_id}
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="text-xs text-content-tertiary">No user selected</div>
                            )}
                            <RadixDialog.Close asChild>
                                <button className="p-2 text-content-tertiary hover:text-content-primary hover:bg-white/5 rounded-lg transition-colors shrink-0" aria-label="Close">
                                    <X className="w-5 h-5" />
                                </button>
                            </RadixDialog.Close>
                        </header>

                        {error && (
                            <div className="mx-6 mt-4 p-3 rounded-xl bg-red-500/5 border border-red-500/20 text-red-400 flex items-start gap-2">
                                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                                <p className="text-xs font-medium">{error}</p>
                            </div>
                        )}

                        {actionMessage && (
                            <div className={`mx-6 mt-4 p-3 rounded-xl border flex items-start gap-2 text-xs font-medium ${actionMessage.type === 'success' ? 'bg-green-500/5 border-green-500/20 text-green-400' : 'bg-red-500/5 border-red-500/20 text-red-400'}`}>
                                {actionMessage.type === 'success' ? <Check className="w-4 h-4 shrink-0 mt-0.5" /> : <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />}
                                <p>{actionMessage.text}</p>
                            </div>
                        )}

                        {user && (
                            <>
                                <nav className="flex items-center gap-1 px-6 pt-4 border-b border-white/5">
                                    {TABS.map(t => (
                                        <button
                                            key={t.id}
                                            onClick={() => setTab(t.id)}
                                            className={`flex items-center gap-1.5 px-3 py-2 text-[10px] font-black uppercase tracking-widest rounded-t-lg transition-all border-b-2 -mb-px ${tab === t.id ? 'border-accent-primary text-content-primary' : 'border-transparent text-content-tertiary hover:text-content-secondary'}`}
                                        >
                                            {t.icon}
                                            {t.label}
                                        </button>
                                    ))}
                                </nav>

                                <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-5">
                                    {tab === 'overview' && <OverviewTab user={user} banned={banned} />}
                                    {tab === 'tokens' && <TokensTab rows={ledger} loading={ledgerLoading} />}
                                    {tab === 'assets' && <AssetsTab rows={assets} loading={assetsLoading} />}
                                    {tab === 'sessions' && <SessionsTab rows={sessions} loading={sessionsLoading} />}
                                </div>

                                <footer className="border-t border-white/5 px-6 py-4 flex flex-wrap gap-2 bg-surface-primary/30">
                                    <button
                                        onClick={() => setShowAdjust(true)}
                                        disabled={actionBusy}
                                        className="flex items-center gap-2 px-4 py-2 bg-accent-primary text-white rounded-lg text-[10px] font-black uppercase tracking-widest disabled:opacity-40 hover:opacity-90 transition-all"
                                    >
                                        <Coins className="w-3.5 h-3.5" /> Adjust Tokens
                                    </button>
                                    {banned ? (
                                        <button
                                            onClick={() => setConfirmUnban(true)}
                                            disabled={actionBusy || isSelf}
                                            className="flex items-center gap-2 px-4 py-2 bg-green-500/10 text-green-400 border border-green-500/20 rounded-lg text-[10px] font-black uppercase tracking-widest disabled:opacity-40 hover:bg-green-500/15 transition-all"
                                        >
                                            <UserCheck className="w-3.5 h-3.5" /> Unban
                                        </button>
                                    ) : (
                                        <BanMenu disabled={actionBusy || isSelf} onSelect={(d) => setConfirmBan(d)} />
                                    )}
                                    <button
                                        onClick={() => setConfirmToggleAdmin(true)}
                                        disabled={actionBusy || isSelf}
                                        className="flex items-center gap-2 px-4 py-2 bg-white/5 text-content-secondary border border-white/10 rounded-lg text-[10px] font-black uppercase tracking-widest disabled:opacity-40 hover:bg-white/10 transition-all"
                                        title={isSelf ? 'You cannot change your own admin role' : undefined}
                                    >
                                        {user.is_admin ? <UserX className="w-3.5 h-3.5" /> : <Shield className="w-3.5 h-3.5" />}
                                        {user.is_admin ? 'Revoke Admin' : 'Make Admin'}
                                    </button>
                                    <button
                                        onClick={() => setConfirmReset(true)}
                                        disabled={actionBusy || !user.email}
                                        className="flex items-center gap-2 px-4 py-2 bg-white/5 text-content-secondary border border-white/10 rounded-lg text-[10px] font-black uppercase tracking-widest disabled:opacity-40 hover:bg-white/10 transition-all ml-auto"
                                    >
                                        <KeyRound className="w-3.5 h-3.5" /> Reset Password
                                    </button>
                                </footer>
                            </>
                        )}
                    </RadixDialog.Content>
                </RadixDialog.Portal>
            </RadixDialog.Root>

            {user && (
                <AdjustTokensModal
                    isOpen={showAdjust}
                    onClose={() => setShowAdjust(false)}
                    userId={user.id}
                    userEmail={user.email}
                    currentBalance={user.token_balance}
                    onApplied={(newBalance) => {
                        setUser(prev => prev ? { ...prev, token_balance: newBalance } : prev);
                        setActionMessage({ type: 'success', text: `Balance updated to ${newBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}.` });
                        onMutated();
                        if (tab === 'tokens' && userId) {
                            setLedgerLoading(true);
                            adminUsersApi.ledger(userId, 0, 50).then(r => setLedger(r.rows)).finally(() => setLedgerLoading(false));
                        }
                    }}
                />
            )}

            <ConfirmationModal
                isOpen={!!confirmBan}
                onClose={() => setConfirmBan(null)}
                onConfirm={() => { if (confirmBan) doBan(confirmBan); }}
                title="Ban this user?"
                message={`Ban duration: ${confirmBan ?? ''}. They will not be able to sign in until the ban expires.`}
                confirmText="Ban User"
                variant="danger"
            />
            <ConfirmationModal
                isOpen={confirmUnban}
                onClose={() => setConfirmUnban(false)}
                onConfirm={() => doBan('none')}
                title="Unban this user?"
                message="The user will be able to sign in again immediately."
                confirmText="Unban"
                variant="warning"
            />
            <ConfirmationModal
                isOpen={confirmToggleAdmin}
                onClose={() => setConfirmToggleAdmin(false)}
                onConfirm={doToggleAdmin}
                title={user?.is_admin ? 'Revoke admin role?' : 'Grant admin role?'}
                message={user?.is_admin ? 'This user will lose access to the admin panel.' : 'This user will gain full access to the admin panel.'}
                confirmText={user?.is_admin ? 'Revoke' : 'Grant'}
                variant={user?.is_admin ? 'danger' : 'warning'}
            />
            <ConfirmationModal
                isOpen={confirmReset}
                onClose={() => setConfirmReset(false)}
                onConfirm={doResetPassword}
                title="Send password reset email?"
                message={`A recovery link will be emailed to ${user?.email ?? 'this user'}.`}
                confirmText="Send"
                variant="info"
            />
        </>
    );
}

function BanMenu({ disabled, onSelect }: { disabled: boolean; onSelect: (d: BanDuration) => void }) {
    const [open, setOpen] = useState(false);
    return (
        <div className="relative">
            <button
                onClick={() => setOpen(o => !o)}
                disabled={disabled}
                className="flex items-center gap-2 px-4 py-2 bg-red-500/10 text-red-400 border border-red-500/20 rounded-lg text-[10px] font-black uppercase tracking-widest disabled:opacity-40 hover:bg-red-500/15 transition-all"
            >
                <Ban className="w-3.5 h-3.5" /> Ban
            </button>
            {open && (
                <>
                    <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
                    <div className="absolute bottom-full left-0 mb-2 z-[61] w-44 bg-bg-primary/95 backdrop-blur-2xl border border-white/10 rounded-xl shadow-2xl overflow-hidden">
                        {BAN_OPTIONS.map(opt => (
                            <button
                                key={opt.value}
                                onClick={() => { onSelect(opt.value); setOpen(false); }}
                                className="w-full px-3 py-2 text-left text-[10px] font-bold uppercase tracking-widest text-content-secondary hover:bg-red-500/10 hover:text-red-400 transition-all border-b border-white/5 last:border-b-0"
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

function OverviewTab({ user, banned }: { user: AdminUserDetail; banned: boolean }) {
    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
                <Stat icon={<Coins className="w-3.5 h-3.5" />} label="Balance" value={user.token_balance.toLocaleString(undefined, { maximumFractionDigits: 2 })} accent />
                <Stat icon={<Crown className="w-3.5 h-3.5" />} label="Plan" value={user.subscription?.plan_id ?? '—'} />
                <Stat icon={<Calendar className="w-3.5 h-3.5" />} label="Joined" value={formatDateTime(user.created_at)} />
                <Stat icon={<Clock className="w-3.5 h-3.5" />} label="Last sign-in" value={formatDateTime(user.last_sign_in_at)} />
            </div>
            <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-3">
                <h3 className="text-[10px] font-black uppercase tracking-widest text-content-tertiary">Account</h3>
                <Row icon={<Mail className="w-3.5 h-3.5" />} label="Email" value={user.email ?? '—'} />
                <Row icon={<Shield className="w-3.5 h-3.5" />} label="Admin" value={user.is_admin ? 'Yes' : 'No'} />
                <Row icon={<Ban className="w-3.5 h-3.5" />} label="Banned" value={banned ? `Until ${formatDateTime(user.banned_until)}` : 'No'} />
                <Row icon={<Check className="w-3.5 h-3.5" />} label="Email confirmed" value={user.email_confirmed_at ? formatDateTime(user.email_confirmed_at) : 'No'} />
            </div>
            {user.subscription && (
                <div className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-3">
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-content-tertiary">Subscription</h3>
                    <Row label="Plan" value={user.subscription.plan_id ?? '—'} />
                    <Row label="Status" value={user.subscription.status ?? '—'} />
                    <Row label="Next top-up" value={formatDateTime(user.subscription.next_topup_at)} />
                    <Row label="Period ends" value={formatDateTime(user.subscription.current_period_end)} />
                    <Row label="Cancels at period end" value={user.subscription.cancel_at_period_end ? 'Yes' : 'No'} />
                </div>
            )}
        </div>
    );
}

function Stat({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: string; accent?: boolean }) {
    return (
        <div className={`rounded-2xl border p-4 ${accent ? 'bg-accent-primary/5 border-accent-primary/20' : 'bg-white/5 border-white/10'}`}>
            <div className={`flex items-center gap-1.5 text-[9px] font-black uppercase tracking-widest ${accent ? 'text-accent-primary' : 'text-content-tertiary'} opacity-80`}>
                {icon} {label}
            </div>
            <div className={`mt-2 text-base font-bold ${accent ? 'text-content-primary' : 'text-content-primary'} tabular-nums truncate`}>{value}</div>
        </div>
    );
}

function Row({ icon, label, value }: { icon?: React.ReactNode; label: string; value: string }) {
    return (
        <div className="flex items-center gap-3 text-xs">
            {icon && <span className="text-content-tertiary">{icon}</span>}
            <span className="text-content-tertiary uppercase tracking-wider text-[10px] font-bold w-32 shrink-0">{label}</span>
            <span className="text-content-primary font-medium truncate">{value}</span>
        </div>
    );
}

function TokensTab({ rows, loading }: { rows: AdminLedgerRow[]; loading: boolean }) {
    if (loading) return <LoadingBlock />;
    if (rows.length === 0) return <EmptyBlock message="No token activity yet." />;
    return (
        <div className="space-y-2">
            {rows.map(row => (
                <div key={row.id} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-white/5 border border-white/10">
                    <div className="min-w-0">
                        <div className="text-xs font-bold text-content-primary truncate">{humanizeReason(row)}</div>
                        <div className="text-[10px] text-content-tertiary mt-0.5">{formatDateTime(row.created_at)}</div>
                    </div>
                    <div className={`text-sm font-black tabular-nums shrink-0 ${row.amount > 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {row.amount > 0 ? '+' : ''}{Number(row.amount).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </div>
                </div>
            ))}
        </div>
    );
}

function AssetsTab({ rows, loading }: { rows: AdminAssetRow[]; loading: boolean }) {
    if (loading) return <LoadingBlock />;
    if (rows.length === 0) return <EmptyBlock message="No generated assets yet." />;
    return (
        <div className="grid grid-cols-3 gap-2">
            {rows.map(row => {
                const TypeIcon = ASSET_TYPE_ICON[row.result_type] ?? FileText;
                return (
                    <a
                        key={row.id}
                        href={row.result_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group relative aspect-square rounded-xl overflow-hidden bg-white/5 border border-white/10 hover:border-white/20 transition-all"
                        title={`${row.result_type} · ${formatDateTime(row.created_at)}`}
                    >
                        {row.result_type === 'image' ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={row.result_url} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" />
                        ) : row.result_type === 'video' ? (
                            <video
                                src={row.result_url}
                                className="absolute inset-0 w-full h-full object-cover"
                                muted
                                preload="metadata"
                                playsInline
                            />
                        ) : (
                            <div className="absolute inset-0 flex items-center justify-center text-content-tertiary">
                                <TypeIcon className="w-8 h-8" />
                            </div>
                        )}
                        <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 bg-black/70 backdrop-blur rounded-md flex items-center gap-1 text-white text-[8px] font-black uppercase tracking-widest">
                            <TypeIcon className="w-2.5 h-2.5" />
                            {row.result_type}
                        </div>
                        <ExternalLink className="absolute top-1.5 right-1.5 w-3 h-3 text-white/70 opacity-0 group-hover:opacity-100 transition-opacity" />
                        <div className="absolute inset-x-0 bottom-0 p-1.5 bg-gradient-to-t from-black/80 to-transparent">
                            <p className="text-[8px] font-mono text-white/70 truncate">{formatDateTime(row.created_at)}</p>
                        </div>
                    </a>
                );
            })}
        </div>
    );
}

function SessionsTab({ rows, loading }: { rows: AdminSessionRow[]; loading: boolean }) {
    if (loading) return <LoadingBlock />;
    if (rows.length === 0) return <EmptyBlock message="No workflow sessions." />;
    return (
        <div className="space-y-2">
            {rows.map(row => (
                <div key={row.id} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-white/5 border border-white/10">
                    <div className="min-w-0">
                        <div className="text-xs font-bold text-content-primary truncate">{row.title ?? 'Untitled'}</div>
                        <div className="text-[10px] text-content-tertiary mt-0.5 font-mono">{formatDateTime(row.created_at)}</div>
                    </div>
                    {row.is_deleted && (
                        <span className="px-2 py-0.5 bg-red-500/10 border border-red-500/20 text-red-400 text-[8px] font-black uppercase tracking-widest rounded-md shrink-0">Deleted</span>
                    )}
                </div>
            ))}
        </div>
    );
}

function LoadingBlock() {
    return (
        <div className="flex items-center justify-center py-12 text-content-tertiary">
            <Loader2 className="w-5 h-5 animate-spin" />
        </div>
    );
}

function EmptyBlock({ message }: { message: string }) {
    return (
        <div className="text-center py-12 bg-white/5 rounded-2xl border border-dashed border-white/10">
            <p className="text-content-tertiary text-xs font-bold uppercase tracking-widest">{message}</p>
        </div>
    );
}
